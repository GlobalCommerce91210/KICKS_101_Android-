import { isIP } from 'node:net';

// Render public peer configuration only. Private keys remain on the gateway.
export function renderGateway(config, now = Date.now()) {
  if (config.environment !== 'staging' || config.collectionEnabled !== false)
    throw new Error('staging_only_collection_disabled');
  if (!Array.isArray(config.peers)) throw new Error('peers_required');
  const seenKeys = new Set();
  const seenAddresses = new Set();
  const sections = ['[Interface]', 'ListenPort = 51820'];
  for (const peer of config.peers) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(peer.publicKey ?? '') || Buffer.from(peer.publicKey, 'base64').length !== 32)
      throw new Error('invalid_public_key');
    if (isIP(peer.address) !== 4 || !/^10\.88\.0\./.test(peer.address) || [0, 1, 255].includes(Number(peer.address.split('.')[3])))
      throw new Error('invalid_peer_address');
    if (!peer.deviceId || !peer.consentId || !peer.purposeVersion || peer.authorization !== 'active')
      throw new Error('active_device_bound_consent_required');
    const expires = Date.parse(peer.expiresAt);
    if (!Number.isFinite(expires) || expires <= now || expires > now + 300_000)
      throw new Error('authorization_lease_required');
    if (seenKeys.has(peer.publicKey) || seenAddresses.has(peer.address)) throw new Error('duplicate_peer');
    seenKeys.add(peer.publicKey); seenAddresses.add(peer.address);
    sections.push('', '[Peer]', `PublicKey = ${peer.publicKey}`, `AllowedIPs = ${peer.address}/32`);
  }
  return sections.join('\n') + '\n';
}
