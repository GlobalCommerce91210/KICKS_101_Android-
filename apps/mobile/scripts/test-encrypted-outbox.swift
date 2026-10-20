import Foundation
import CryptoKit

@main struct OutboxValidation {
    static func rejects(_ action: () async throws -> Void) async throws {
        do { try await action() } catch { return }
        throw NSError(domain: "OutboxValidation", code: 1)
    }
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("kicks-outbox-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("observations.enc")
        let key = SymmetricKey(size: .bits256)
        let scope = EncryptedObservationOutbox.Scope(deviceId: UUID().uuidString, activationId: UUID().uuidString, recoveryEpoch: UUID().uuidString)
        let outbox = try EncryptedObservationOutbox(file: file, key: key, scope: scope)
        let batchId = UUID().uuidString
        let body = try JSONSerialization.data(withJSONObject: ["batchId": batchId,
            "observations": [["destinationHost":"synthetic.example.test", "consentId":scope.activationId]]], options:[.sortedKeys,.withoutEscapingSlashes])
        try await outbox.enqueue(batchId: batchId, canonicalPayload: body)
        try await outbox.enqueue(batchId: batchId, canonicalPayload: body)
        let encrypted = try Data(contentsOf: file)
        precondition(encrypted.range(of: Data("synthetic.example.test".utf8)) == nil)
        let reopened = try EncryptedObservationOutbox(file: file, key: key, scope: scope)
        let entries = try await reopened.pending()
        precondition(entries.count == 1)
        try await rejects { try await reopened.enqueue(batchId: batchId, canonicalPayload: Data("changed".utf8)) }
        try await rejects { _ = try await reopened.pending(now: Date().addingTimeInterval(90_000)) }
        try await rejects { try await reopened.acknowledge(batchId: batchId, payloadDigest: "wrong", receiptId: UUID().uuidString, accepted: 1) }
        let wrongKey = try EncryptedObservationOutbox(file: file, key: SymmetricKey(size: .bits256), scope: scope)
        try await rejects { _ = try await wrongKey.pending() }
        let wrongScope = try EncryptedObservationOutbox(file: file, key: key,
            scope: .init(deviceId: scope.deviceId, activationId: UUID().uuidString, recoveryEpoch: scope.recoveryEpoch))
        try await rejects { _ = try await wrongScope.pending() }
        let preserved = try Data(contentsOf: file)
        precondition(preserved == encrypted)
        try await reopened.acknowledge(batchId: batchId, payloadDigest: entries[0].payloadDigest, receiptId: UUID().uuidString, accepted: 1)
        let remaining = try await reopened.pending()
        precondition(remaining.isEmpty)
        var tampered = encrypted; tampered[tampered.count - 1] ^= 1
        try tampered.write(to: file)
        try await rejects { _ = try await reopened.pending() }
        print("Encrypted outbox: restart, retry, receipt, isolation, expiry and tamper checks passed.")
    }
}
