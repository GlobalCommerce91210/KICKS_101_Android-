import ExpoModulesCore
import Foundation
import NetworkExtension
import Security

public final class KicksTunnelModule: Module {
    private let controller = KicksTunnelController()

    public func definition() -> ModuleDefinition {
        Name("KicksTunnel")
        AsyncFunction("getDeviceId") { () throws -> String in
            try self.controller.configuration().deviceId
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

// Reads the existing native-only provisioning boundary. This adapter never
// creates a consumer account, rotates credentials, or invents a device binding.
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
        _ = try configuration()
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
