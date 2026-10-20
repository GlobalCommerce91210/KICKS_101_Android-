import Foundation
import CryptoKit
import Darwin

// Storage primitive for a reviewed observation producer. This does not enable
// collection or manufacture observations, and never holds account/device tokens.
actor EncryptedObservationOutbox {
    struct Scope: Codable, Equatable {
        let deviceId: String
        let activationId: String
        let recoveryEpoch: String
    }
    struct Entry: Codable {
        let batchId: String
        let payloadDigest: String
        let createdAt: Date
        let payload: Data
    }
    struct Archive: Codable { let scope: Scope; var entries: [Entry] }
    enum Failure: Error { case invalidScope, corruptArchive, capacity, expired, receiptMismatch, identityConflict, storageBusy, storageUnavailable }
    struct Diagnostics: Encodable {
        let state: String
        let queuedBatches: Int?
        let hasUnexpiredBatches: Bool
        let collectionEnabled = false
    }
    private let file: URL
    private let key: SymmetricKey
    private let scope: Scope
    private let maxBytes = 1_048_576
    private let maxEntries = 128
    private let maxAge: TimeInterval = 86_400

    // The caller supplies a ThisDeviceOnly Keychain key and a dedicated app-group
    // path. A missing key must be an error; never replace a key for an existing file.
    init(file: URL, key: SymmetricKey, scope: Scope) throws {
        guard file.isFileURL,
              key.bitCount == 256, UUID(uuidString: scope.deviceId) != nil,
              UUID(uuidString: scope.activationId) != nil, UUID(uuidString: scope.recoveryEpoch) != nil else { throw Failure.invalidScope }
        self.file = file.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(file.lastPathComponent)
        self.key = key; self.scope = scope
    }
    // A Swift actor serializes one instance only. The lock file also serializes
    // separate instances/processes, preventing a stale read from replacing data.
    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        let descriptor = Darwin.open(file.path + ".lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_EXLOCK | O_NONBLOCK, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else {
            if errno == EAGAIN || errno == EWOULDBLOCK { throw Failure.storageBusy }
            throw Failure.storageUnavailable
        }
        defer { Darwin.close(descriptor) }
        return try operation()
    }
    private func context() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(scope)
    }
    private func load() throws -> Archive {
        if (try? FileManager.default.destinationOfSymbolicLink(atPath: file.path)) != nil { throw Failure.corruptArchive }
        if !FileManager.default.fileExists(atPath: file.path) { return Archive(scope: scope, entries: []) }
        let metadata = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard metadata.isRegularFile == true, metadata.isSymbolicLink != true,
              let size = metadata.fileSize, size <= maxBytes + 4096 else { throw Failure.corruptArchive }
        let encrypted = try Data(contentsOf: file)
        do {
            let clear = try AES.GCM.open(AES.GCM.SealedBox(combined: encrypted), using: key, authenticating: context())
            guard clear.count <= maxBytes else { throw Failure.corruptArchive }
            let archive = try JSONDecoder().decode(Archive.self, from: clear)
            guard archive.scope == scope, archive.entries.count <= maxEntries,
                  Set(archive.entries.map { $0.batchId }).count == archive.entries.count,
                  archive.entries.allSatisfy({ entry in
                    UUID(uuidString: entry.batchId) != nil && entry.payloadDigest == SHA256.hash(data: entry.payload).map { String(format: "%02x", $0) }.joined()
                  }) else { throw Failure.corruptArchive }
            return archive
        } catch { throw Failure.corruptArchive }
    }
    private func save(_ archive: Archive) throws {
        let clear = try JSONEncoder().encode(archive)
        guard clear.count <= maxBytes, archive.entries.count <= maxEntries else { throw Failure.capacity }
        let box = try AES.GCM.seal(clear, using: key, authenticating: context())
        guard let encrypted = box.combined else { throw Failure.corruptArchive }
        #if os(iOS)
        try encrypted.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try encrypted.write(to: file, options: [.atomic])
        #endif
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        var protectedFile = file
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protectedFile.setResourceValues(values)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.synchronize()
    }
    func enqueue(batchId: String, canonicalPayload: Data, now: Date = Date()) throws {
      try withLock {
        guard UUID(uuidString: batchId) != nil, canonicalPayload.count <= 128_000 else { throw Failure.capacity }
        guard let batch = try JSONSerialization.jsonObject(with: canonicalPayload) as? [String: Any],
              batch["batchId"] as? String == batchId,
              let observations = batch["observations"] as? [[String: Any]],
              !observations.isEmpty, observations.count <= 250,
              observations.allSatisfy({ $0["consentId"] as? String == scope.activationId }) else { throw Failure.invalidScope }
        let digest = SHA256.hash(data: canonicalPayload).map { String(format: "%02x", $0) }.joined()
        var archive = try load()
        if let existing = archive.entries.first(where: { $0.batchId == batchId }) {
            guard existing.payloadDigest == digest else { throw Failure.identityConflict }
            return
        }
        archive.entries.append(Entry(batchId: batchId, payloadDigest: digest, createdAt: now, payload: canonicalPayload))
        try save(archive)
      }
    }
    // Caller must revalidate current device/consent/epoch before every upload.
    // Expired entries remain protected for explicit disposition; never upload them.
    func pending(now: Date = Date()) throws -> [Entry] {
      try withLock {
        let entries = try load().entries
        guard entries.allSatisfy({ $0.createdAt <= now && now.timeIntervalSince($0.createdAt) <= maxAge }) else { throw Failure.expired }
        return entries
      }
    }
    // Local diagnostic metadata only: never emits identifiers, keys or payloads.
    func diagnostics(now: Date = Date()) -> Diagnostics {
        do {
            return try withLock {
                let entries = try load().entries
                let eligible = entries.allSatisfy { $0.createdAt <= now && now.timeIntervalSince($0.createdAt) <= maxAge }
                return Diagnostics(state: eligible ? (entries.isEmpty ? "empty" : "pending") : "expired_or_clock_skew_retained",
                    queuedBatches: entries.count, hasUnexpiredBatches: eligible && !entries.isEmpty)
            }
        } catch Failure.storageBusy {
            return Diagnostics(state: "storage_busy", queuedBatches: nil, hasUnexpiredBatches: false)
        } catch {
            return Diagnostics(state: "unreadable_retained", queuedBatches: nil, hasUnexpiredBatches: false)
        }
    }
    func acknowledge(batchId: String, payloadDigest: String, receiptId: String, accepted: Int) throws {
      try withLock {
        guard UUID(uuidString: receiptId) != nil, accepted > 0 else { throw Failure.receiptMismatch }
        var archive = try load()
        guard let index = archive.entries.firstIndex(where: { $0.batchId == batchId }),
              archive.entries[index].payloadDigest == payloadDigest,
              let batch = try JSONSerialization.jsonObject(with: archive.entries[index].payload) as? [String: Any],
              let observations = batch["observations"] as? [Any], observations.count == accepted else { throw Failure.receiptMismatch }
        archive.entries.remove(at: index)
        try save(archive)
      }
    }
}
