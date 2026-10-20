import { renderGateway } from './render-config.mjs';

const empty = () => renderGateway({ environment: 'staging', collectionEnabled: false, peers: [] });

// apply must replace the complete peer set, rather than append peers. The host
// supervisor must clear peers if this process dies; WireGuard has no lease timer.
export async function reconcile({ readAuthority, apply, acknowledge, now = Date.now }) {
  try {
    const snapshot = await readAuthority();
    const configuration = renderGateway(snapshot, now());
    await apply(configuration);
    // Do not leave a lease active if a slow host update crossed its expiration.
    if (snapshot.peers.some(peer => Date.parse(peer.expiresAt) <= now())) {
      await apply(empty());
      throw new Error('lease_expired_during_apply');
    }
    if (acknowledge) await acknowledge(snapshot.snapshotId);
    return { status: 'applied', peers: snapshot.peers.length };
  } catch (error) {
    // Includes TLS, HTTP/authentication, malformed snapshot, and expiry failure.
    // A failed clear is fatal and must be surfaced to the host supervisor.
    try { await apply(empty()); } catch { throw new Error('gateway_peer_clear_failed'); }
    throw new Error('gateway_authority_unavailable', { cause: error });
  }
}

export function httpsAuthorityAcknowledger({ url, authorization, fetchImpl = fetch, signal }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !authorization ||
      endpoint.pathname !== '/internal/staging/ios-gateway/peers') throw new Error('authenticated_https_authority_required');
  endpoint.pathname = '/internal/staging/ios-gateway/applied';
  endpoint.search = ''; endpoint.hash = '';
  return async snapshotId => {
    if (!/^[a-f0-9]{64}$/.test(snapshotId ?? '')) throw new Error('snapshot_id_required');
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ snapshotId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error('authority_acknowledgment_failed');
  };
}

export function httpsAuthorityReader({ url, authorization, fetchImpl = fetch, signal }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !authorization)
    throw new Error('authenticated_https_authority_required');
  return async () => {
    const response = await fetchImpl(endpoint, {
      headers: { authorization, accept: 'application/json' }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('authority_request_failed');
    // Bound streamed responses too; Content-Length is not authoritative.
    if (!response.body) throw new Error('authority_body_required');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 128_000) throw new Error('authority_response_too_large'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}
