import ExpoModulesCore
import Foundation
import NetworkExtension
import Security
import CryptoKit

public final class KicksTunnelModule: Module {
    private let controller = KicksTunnelController()
    private let enrollment = NativeEnrollment()

    public func definition() -> ModuleDefinition {
        Name("KicksTunnel")
        AsyncFunction("provision") { (apiOrigin: String, accountBearer: String, accountSubjectId: String) async throws -> String in
            try await self.enrollment.provision(apiOrigin: apiOrigin, bearer: accountBearer, subject: accountSubjectId)
        }
        AsyncFunction("renewLease") { (accountBearer: String, permissionId: String) async throws in
            try await self.enrollment.renewLease(bearer: accountBearer, permissionId: permissionId)
        }
        AsyncFunction("getDeviceId") { () async throws -> String in
            try await self.enrollment.enrolledDeviceId()
        }
        AsyncFunction("prepare") { () async throws in
            try await self.controller.prepare()
        }
        AsyncFunction("requestAuthorization") { () async throws -> String in
            try await self.controller.authorize()
        }
        AsyncFunction("start") { () async throws in
            try await self.controller.start()
        }
        AsyncFunction("stop") { () async throws in
            try await self.controller.stop()
        }
        AsyncFunction("getStatus") { () async throws -> [String: Any] in
            try await self.controller.status()
        }
    }
}

private struct NativeConfiguration: Decodable {
    let deviceId: String
    let permissionId: String
    let tunnelServerHost: String
    let expiresAt: Date
}

private struct CollectorFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private final class RejectEnrollmentRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private actor NativeEnrollment {
    private struct Record: Codable {
        let schemaVersion: Int
        let requestId: String
        let deviceId: String
        let deviceToken: String
        let privateKey: String
        let publicKey: String
        let accountSubjectId: String
        let apiOrigin: String
        var provisioned: Bool
    }
    private var operationActive = false
    private let stagingOrigin = "https://staging-api.datastorminc.live"

    private func failure(_ message: String) -> CollectorFailure { CollectorFailure(message: message) }

    private func query(_ account: String) -> [String: Any] {
        var result: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.datastorm.kicks.collector", kSecAttrAccount as String: account]
        if let group = Bundle.main.object(forInfoDictionaryKey: "KICKSKeychainAccessGroup") as? String,
           !group.isEmpty { result[kSecAttrAccessGroup as String] = group }
        return result
    }

    private func read(_ account: String, anyAccessibleGroup: Bool = false) throws -> Data? {
        var request = query(account)
        if anyAccessibleGroup { request.removeValue(forKey: kSecAttrAccessGroup as String) }
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw failure("Secure enrollment storage is unavailable. Existing records were preserved.")
        }
        return data
    }

    private func insert(_ data: Data, account: String) throws {
        var attributes = query(account)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw failure("A secure enrollment record already exists or storage is unavailable. Nothing was replaced.")
        }
    }

    private func update(_ data: Data, account: String) throws {
        guard SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess else {
            throw failure("Secure enrollment could not be saved. Monitoring remains off.")
        }
    }

    private func record() throws -> Record {
        guard let data = try read("device-provisioning-v1"),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.schemaVersion == 1, UUID(uuidString: record.requestId) != nil,
              UUID(uuidString: record.deviceId) != nil, UUID(uuidString: record.accountSubjectId) != nil,
              record.deviceToken.count == 43,
              record.apiOrigin == stagingOrigin,
              let privateBytes = Data(base64Encoded: record.privateKey),
              let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateBytes),
              key.publicKey.rawRepresentation.base64EncodedString() == record.publicKey else {
            throw failure("Enroll this iPad securely before starting monitoring. Existing records were preserved.")
        }
        return record
    }

    func enrolledDeviceId() throws -> String {
        let existing = try record()
        guard existing.provisioned else { throw failure("This iPad’s enrollment has not been confirmed by the server.") }
        return existing.deviceId
    }

    private func request(_ path: String, bearer: String, body: [String: Any]) async throws -> [String: Any] {
        guard bearer.count >= 16, bearer.count <= 4096,
              !bearer.contains(where: { $0.isWhitespace }),
              let url = URL(string: stagingOrigin + path) else { throw failure("A current account session is required.") }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        let session = URLSession(configuration: config, delegate: RejectEnrollmentRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        // Standard TLS validation is retained. Neither response body nor errors
        // containing credential material are returned to JavaScript or logs.
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw failure("Secure staging enrollment could not connect. Monitoring remains off.") }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              http.url?.absoluteString == url.absoluteString, data.count <= 32_768,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw failure("Secure staging enrollment was not accepted. Monitoring remains off.")
        }
        return json
    }

    func provision(apiOrigin: String, bearer: String, subject: String) async throws -> String {
        guard !operationActive else { throw failure("A secure enrollment operation is already in progress.") }
        operationActive = true
        defer { operationActive = false }
        guard apiOrigin == stagingOrigin, UUID(uuidString: subject) != nil else {
            throw failure("Native enrollment requires the matching staging DataStorm account.")
        }
        guard let group = Bundle.main.object(forInfoDictionaryKey: "KICKSKeychainAccessGroup") as? String,
              !group.isEmpty, !group.contains("$("),
              let plugins = Bundle.main.builtInPlugInsURL,
              let bundles = try? FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil),
              bundles.contains(where: { Bundle(url: $0)?.bundleIdentifier == "com.datastorm.kicks.PacketTunnel" }) else {
            throw failure("This build is missing the shared secure storage or embedded tunnel. No device enrollment was created.")
        }
        var pending: Record
        if try read("device-provisioning-v1") != nil {
            pending = try record()
            guard pending.accountSubjectId == subject, pending.apiOrigin == apiOrigin else {
                throw failure("This iPad has enrollment for another account or origin. Existing credentials were preserved.")
            }
        } else {
            // Preserve unknown historical configuration instead of replacing its identity.
            guard try read("device-configuration-v1", anyAccessibleGroup: true) == nil,
                  try read("device-provisioning-v1", anyAccessibleGroup: true) == nil else {
                throw failure("An existing collector configuration needs explicit review before enrollment. Nothing was replaced.")
            }
            var random = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
                throw failure("Secure credential generation is unavailable.")
            }
            let token = Data(random).base64EncodedString().replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            let key = Curve25519.KeyAgreement.PrivateKey()
            pending = Record(schemaVersion: 1, requestId: UUID().uuidString.lowercased(),
                deviceId: UUID().uuidString.lowercased(), deviceToken: token,
                privateKey: key.rawRepresentation.base64EncodedString(),
                publicKey: key.publicKey.rawRepresentation.base64EncodedString(), accountSubjectId: subject,
                apiOrigin: apiOrigin, provisioned: false)
            // Persist the prospective proof before issuing it, enabling unchanged retries.
            try insert(JSONEncoder().encode(pending), account: "device-provisioning-v1")
        }
        let response = try await request("/core/consumer/v1/ios-devices/provision", bearer: bearer,
            body: ["requestId": pending.requestId, "deviceId": pending.deviceId,
                   "deviceToken": pending.deviceToken, "publicKey": pending.publicKey])
        guard response["deviceId"] as? String == pending.deviceId,
              response["accountSubjectId"] as? String == pending.accountSubjectId,
              let status = response["status"] as? String, ["provisioned", "replayed"].contains(status) else {
            throw failure("The server enrollment does not match this iPad and account.")
        }
        pending.provisioned = true
        try update(JSONEncoder().encode(pending), account: "device-provisioning-v1")
        return pending.deviceId
    }

    func renewLease(bearer: String, permissionId: String) async throws {
        guard !operationActive else { throw failure("A secure enrollment operation is already in progress.") }
        operationActive = true
        defer { operationActive = false }
        let existing = try record()
        guard existing.provisioned, UUID(uuidString: permissionId) != nil else {
            throw failure("Confirmed device enrollment and consent are required before gateway authorization.")
        }
        var lease = try await request("/core/consumer/v1/devices/\(existing.deviceId)/ios-gateway-lease", bearer: bearer,
            body: ["permissionId": permissionId, "publicKey": existing.publicKey, "deviceToken": existing.deviceToken])
        let expiryString = lease["expiresAt"] as? String ?? ""
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = parser.date(from: expiryString) ?? ISO8601DateFormatter().date(from: expiryString)
        guard lease["deviceId"] as? String == existing.deviceId,
              lease["permissionId"] as? String == permissionId,
              let activation = lease["activationId"] as? String, UUID(uuidString: activation) != nil,
              lease["collectionEnabled"] as? Bool == false,
              let expiry, expiry > Date(), expiry.timeIntervalSinceNow <= 300,
              let host = lease["tunnelServerHost"] as? String, !host.isEmpty,
              var wireguard = lease["wireguard"] as? [String: Any],
              let serverKey = wireguard["serverPublicKey"] as? String,
              Data(base64Encoded: serverKey)?.count == 32,
              let port = wireguard["serverPort"] as? Int, (1...65535).contains(port),
              wireguard["addressIPv4"] is String, wireguard["addressIPv6"] is String,
              let dns = wireguard["dnsServers"] as? [String], !dns.isEmpty else {
            throw failure("The gateway authorization is incomplete or does not match this iPad’s grant.")
        }
        // Never trust an upstream response to supply or replace a device private key.
        wireguard["privateKey"] = existing.privateKey
        lease["wireguard"] = wireguard
        // JSONDecoder.iso8601 in the provider accepts second-precision ISO8601.
        lease["expiresAt"] = ISO8601DateFormatter().string(from: expiry)
        lease["nativeProvisioningSchemaVersion"] = 1
        if let previousData = try read("device-configuration-v1") {
            guard let previous = try? JSONSerialization.jsonObject(with: previousData) as? [String: Any],
                  previous["nativeProvisioningSchemaVersion"] as? Int == 1,
                  previous["deviceId"] as? String == existing.deviceId,
                  (previous["wireguard"] as? [String: Any])?["privateKey"] as? String == existing.privateKey else {
                throw failure("An existing collector configuration was preserved. It cannot be silently replaced.")
            }
            try update(JSONSerialization.data(withJSONObject: lease), account: "device-configuration-v1")
        } else {
            try insert(JSONSerialization.data(withJSONObject: lease), account: "device-configuration-v1")
        }
    }
}

// Existing account credentials are never persisted here. Device provisioning is
// explicit and separate from account identity, grant authorization, and routing.
private final class KicksTunnelController {
    private let extensionId = "com.datastorm.kicks.PacketTunnel"

    private func keychainQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.datastorm.kicks.collector",
            kSecAttrAccount as String: "device-configuration-v1",
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        if let group = Bundle.main.object(forInfoDictionaryKey: "KICKSKeychainAccessGroup") as? String,
           !group.isEmpty { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    private func readKeychain(reference: Bool = false) throws -> Data {
        var query = keychainQuery()
        query[(reference ? kSecReturnPersistentRef : kSecReturnData) as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            throw CollectorFailure(message: "Secure iPad collector enrollment is unavailable. Monitoring remains off.")
        }
        return data
    }

    fileprivate func configuration() throws -> NativeConfiguration {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let config: NativeConfiguration
        do { config = try decoder.decode(NativeConfiguration.self, from: readKeychain()) }
        catch { throw CollectorFailure(message: "The native enrollment must include a device binding and expiring authorization. Existing credentials were preserved.") }
        guard UUID(uuidString: config.deviceId) != nil, UUID(uuidString: config.permissionId) != nil,
              !config.tunnelServerHost.isEmpty,
              config.expiresAt > Date(), config.expiresAt.timeIntervalSinceNow <= 300 else {
            throw CollectorFailure(message: "The collector enrollment is incomplete or expired. Monitoring remains off.")
        }
        return config
    }

    private func managers() async throws -> [NETunnelProviderManager] {
        try await withCheckedThrowingContinuation { continuation in
            NETunnelProviderManager.loadAllFromPreferences { managers, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (managers ?? []).filter {
                    ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == self.extensionId
                })
            }
        }
    }

    private func manager() async throws -> NETunnelProviderManager {
        let profiles = try await managers()
        guard profiles.count == 1, let profile = profiles.first else {
            throw CollectorFailure(message: "A unique KICK’S VPN profile could not be confirmed. Existing profiles were preserved.")
        }
        return profile
    }

    func prepare() async throws {
        _ = try await NativeEnrollment().enrolledDeviceId()
        guard let plugins = Bundle.main.builtInPlugInsURL,
              let bundles = try? FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil),
              bundles.contains(where: { Bundle(url: $0)?.bundleIdentifier == extensionId }) else {
            throw CollectorFailure(message: "This build does not include the signed KICK’S tunnel extension. Monitoring remains off.")
        }
        // Do not silently replace duplicate profiles or a profile from another app.
        guard try await managers().count <= 1 else {
            throw CollectorFailure(message: "Multiple KICK’S VPN profiles require review. Existing profiles were preserved.")
        }
    }

    func authorize() async throws -> String {
        try await prepare()
        let config = try configuration()
        let profiles = try await managers()
        let profile = profiles.first ?? NETunnelProviderManager()
        let settings = NETunnelProviderProtocol()
        settings.providerBundleIdentifier = extensionId
        settings.serverAddress = config.tunnelServerHost
        settings.includeAllNetworks = true
        settings.excludeLocalNetworks = false
        settings.enforceRoutes = true
        // Only a Keychain reference crosses into the OS profile, never a token.
        settings.passwordReference = try readKeychain(reference: true)
        settings.providerConfiguration = ["schemaVersion": 1, "deviceId": config.deviceId,
                                          "permissionId": config.permissionId]
        profile.protocolConfiguration = settings
        profile.localizedDescription = "KICK’S"
        profile.isEnabled = true
        profile.isOnDemandEnabled = false
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            profile.saveToPreferences { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
        return "authorized"
    }

    func start() async throws {
        try await prepare()
        let config = try configuration()
        let profile = try await manager()
        guard profile.isEnabled,
              let settings = profile.protocolConfiguration as? NETunnelProviderProtocol,
              settings.providerConfiguration?["deviceId"] as? String == config.deviceId,
              settings.providerConfiguration?["permissionId"] as? String == config.permissionId,
              settings.passwordReference == (try readKeychain(reference: true)),
              let session = profile.connection as? NETunnelProviderSession else {
            throw CollectorFailure(message: "The VPN profile does not match this iPad’s current enrollment.")
        }
        try session.startVPNTunnel()
    }

    func stop() async throws {
        let profiles = try await managers()
        for profile in profiles { profile.connection.stopVPNTunnel() }
        for _ in 0..<50 {
            if profiles.allSatisfy({ [.disconnected, .invalid].contains($0.connection.status) }) { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw CollectorFailure(message: "Collector stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.")
    }

    func status() async throws -> [String: Any] {
        let profiles = try await managers()
        let connected = profiles.contains { [.connected, .connecting, .reasserting, .disconnecting].contains($0.connection.status) }
        // OS connectivity is insufficient to assert verified consent or ingestion.
        // The extension evidence protocol must be implemented before enabling this.
        return ["deviceId": (try? configuration().deviceId) ?? "",
                "permissionId": (try? configuration().permissionId) ?? "",
                "connected": connected, "consentVerified": false, "collecting": false]
    }
}
