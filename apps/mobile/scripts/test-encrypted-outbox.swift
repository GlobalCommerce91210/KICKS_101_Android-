import Foundation
import CryptoKit
import Darwin

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
        let pendingHealth = await reopened.diagnostics()
        precondition(pendingHealth.state == "pending" && pendingHealth.queuedBatches == 1)
        let healthJSON = String(decoding: try JSONEncoder().encode(pendingHealth), as: UTF8.self)
        precondition(!healthJSON.contains(scope.deviceId) && !healthJSON.contains(scope.activationId) && !healthJSON.contains("synthetic.example.test"))
        try await rejects { try await reopened.enqueue(batchId: batchId, canonicalPayload: Data("changed".utf8)) }
        try await rejects { _ = try await reopened.pending(now: Date().addingTimeInterval(90_000)) }
        let retainedHealth = await reopened.diagnostics(now: Date().addingTimeInterval(90_000))
        precondition(retainedHealth.state == "expired_or_clock_skew_retained" && retainedHealth.queuedBatches == 1)
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
        let corruptHealth = await reopened.diagnostics()
        precondition(corruptHealth.state == "unreadable_retained" && corruptHealth.queuedBatches == nil)
        precondition(tryData(file) == tampered)

        let parallelFile = directory.appendingPathComponent("parallel.enc")
        let first = try EncryptedObservationOutbox(file: parallelFile, key: key, scope: scope)
        let second = try EncryptedObservationOutbox(file: parallelFile, key: key, scope: scope)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<32 {
                let writer = index.isMultiple(of: 2) ? first : second
                let id = UUID().uuidString
                let data = try JSONSerialization.data(withJSONObject: ["batchId":id,"observations":[["consentId":scope.activationId]]],options:[.sortedKeys])
                group.addTask {
                    for _ in 0..<100 {
                        do { try await writer.enqueue(batchId:id,canonicalPayload:data); return }
                        catch EncryptedObservationOutbox.Failure.storageBusy { try await Task.sleep(nanoseconds:1_000_000) }
                    }
                    throw NSError(domain:"OutboxValidation",code:2)
                }
            }
            try await group.waitForAll()
        }
        let parallelEntries = try await first.pending()
        precondition(parallelEntries.count == 32 && Set(parallelEntries.map { $0.batchId }).count == 32)
        let descriptor = Darwin.open(parallelFile.path + ".lock",O_RDWR | O_EXLOCK | O_NONBLOCK)
        precondition(descriptor >= 0)
        let busy = await second.diagnostics()
        precondition(busy.state == "storage_busy")
        Darwin.close(descriptor)
        for _ in 32..<128 {
            let id=UUID().uuidString
            let data=try JSONSerialization.data(withJSONObject:["batchId":id,"observations":[["consentId":scope.activationId]]],options:[.sortedKeys])
            try await first.enqueue(batchId:id,canonicalPayload:data)
        }
        let atCapacity = tryData(parallelFile)
        let extraId=UUID().uuidString
        let extra=try JSONSerialization.data(withJSONObject:["batchId":extraId,"observations":[["consentId":scope.activationId]]],options:[.sortedKeys])
        try await rejects { try await second.enqueue(batchId:extraId,canonicalPayload:extra) }
        precondition(tryData(parallelFile) == atCapacity)
        let linkedFile=directory.appendingPathComponent("linked.enc")
        let missingTarget=directory.appendingPathComponent("missing.enc").path
        try FileManager.default.createSymbolicLink(atPath:linkedFile.path,withDestinationPath:missingTarget)
        let linked=try EncryptedObservationOutbox(file:linkedFile,key:key,scope:scope)
        try await rejects { _ = try await linked.pending() }
        let preservedLink=try FileManager.default.destinationOfSymbolicLink(atPath:linkedFile.path)
        precondition(preservedLink == missingTarget)
        print("Encrypted outbox: restart, retry, receipt, isolation, retention, tamper, capacity, concurrent writers and safe diagnostics passed.")
    }
    static func tryData(_ file: URL) -> Data { try! Data(contentsOf:file) }
}
