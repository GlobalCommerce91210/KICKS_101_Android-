import Foundation
import Network
import NetworkExtension
import Security
import WireGuardKit

// Transport only. A handshake or packet count is never research-ingestion evidence.
final class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter = WireGuardAdapter(with: self) { _, _ in
        // WireGuard diagnostics may contain network or credential material.
    }
    private var expiryTimer: DispatchSourceTimer?
    private var lease: Lease?
    private let stateQueue = DispatchQueue(label: "com.datastorm.kicks.tunnel-state")

    private struct Lease: Decodable {
        struct WireGuard: Decodable {
            let privateKey: String
            let serverPublicKey: String
            let serverPort: UInt16
            let addressIPv4: String
            let addressIPv6: String
            let dnsServers: [String]
        }
        let deviceId: String
        let permissionId: String
        let tunnelServerHost: String
        let expiresAt: Date
        let wireguard: WireGuard
    }

    private enum Failure: Error { case invalidEnrollment, missingCredential }

    private func readLease() throws -> Lease {
        guard let settings = protocolConfiguration as? NETunnelProviderProtocol,
              let reference = settings.passwordReference else { throw Failure.missingCredential }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecValuePersistentRef as String: reference, kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { throw Failure.missingCredential }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let lease = try decoder.decode(Lease.self, from: data)
        guard UUID(uuidString: lease.deviceId) != nil, UUID(uuidString: lease.permissionId) != nil,
              settings.providerConfiguration?["deviceId"] as? String == lease.deviceId,
              settings.providerConfiguration?["permissionId"] as? String == lease.permissionId,
              settings.serverAddress == lease.tunnelServerHost,
              lease.expiresAt > Date(), lease.expiresAt.timeIntervalSinceNow <= 300 else {
            throw Failure.invalidEnrollment
        }
        return lease
    }

    private func configuration(_ lease: Lease) throws -> TunnelConfiguration {
        let input = lease.wireguard
        guard let privateKey = PrivateKey(base64Key: input.privateKey),
              let publicKey = PublicKey(base64Key: input.serverPublicKey),
              let ipv4 = IPAddressRange(from: input.addressIPv4), ipv4.address is IPv4Address,
              let ipv6 = IPAddressRange(from: input.addressIPv6), ipv6.address is IPv6Address,
              input.serverPort > 0,
              !lease.tunnelServerHost.isEmpty,
              !lease.tunnelServerHost.contains(where: { $0.isWhitespace || $0 == "/" }),
              !input.dnsServers.isEmpty else { throw Failure.invalidEnrollment }
        let dns = input.dnsServers.compactMap { DNSServer(from: $0) }
        guard dns.count == input.dnsServers.count else { throw Failure.invalidEnrollment }
        let endpointHost = lease.tunnelServerHost.contains(":") ? "[\(lease.tunnelServerHost)]" : lease.tunnelServerHost
        guard let endpoint = Endpoint(from: "\(endpointHost):\(input.serverPort)"),
              let allIPv4 = IPAddressRange(from: "0.0.0.0/0"),
              let allIPv6 = IPAddressRange(from: "::/0") else { throw Failure.invalidEnrollment }
        var interface = InterfaceConfiguration(privateKey: privateKey)
        interface.addresses = [ipv4, ipv6]
        interface.dns = dns
        interface.mtu = 1280
        var peer = PeerConfiguration(publicKey: publicKey)
        peer.endpoint = endpoint
        peer.allowedIPs = [allIPv4, allIPv6]
        peer.persistentKeepAlive = 25
        return TunnelConfiguration(name: "KICK’S", interface: interface, peers: [peer])
    }

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        do {
            let verifiedLease = try readLease()
            let config = try configuration(verifiedLease)
            // Routing policy must already be persisted by the native controller.
            guard let settings = protocolConfiguration as? NETunnelProviderProtocol,
                  settings.includeAllNetworks, settings.enforceRoutes,
                  !settings.excludeLocalNetworks else { throw Failure.invalidEnrollment }
            adapter.start(tunnelConfiguration: config) { error in
                if let error { completionHandler(error); return }
                self.stateQueue.async {
                    guard verifiedLease.expiresAt > Date() else {
                        self.adapter.stop { _ in }
                        completionHandler(Failure.invalidEnrollment)
                        return
                    }
                    self.lease = verifiedLease
                    let timer = DispatchSource.makeTimerSource(queue: self.stateQueue)
                    timer.schedule(deadline: .now() + verifiedLease.expiresAt.timeIntervalSinceNow)
                    timer.setEventHandler { [weak self] in
                        guard let self else { return }
                        self.lease = nil
                        self.adapter.stop { _ in self.cancelTunnelWithError(Failure.invalidEnrollment) }
                    }
                    self.expiryTimer = timer
                    timer.resume()
                    completionHandler(nil)
                }
            }
        } catch { completionHandler(error) }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        stateQueue.async {
            self.expiryTimer?.cancel()
            self.expiryTimer = nil
            self.lease = nil
            self.adapter.stop { _ in completionHandler() }
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        stateQueue.async {
            // Never return a key, raw WireGuard configuration, or a false collecting claim.
            let status: [String: Any] = ["deviceId": self.lease?.deviceId ?? "",
                "permissionId": self.lease?.permissionId ?? "", "collecting": false,
                "consentVerified": false, "transportConfigured": self.lease != nil]
            completionHandler?(try? JSONSerialization.data(withJSONObject: status))
        }
    }
}
