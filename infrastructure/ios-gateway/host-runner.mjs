import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { httpsAuthorityReader, reconcile } from './reconcile.mjs';

export const gatewayInterface = 'kicks-staging';
const executeFile = promisify(execFile);
const join = posix.join;
const execute = (file, args) => executeFile(file, args, { timeout: 2000, maxBuffer: 128_000, encoding: 'utf8' });
const emptyPeers = '[Interface]\n';

export function mergeHostInterface(existing, publicPeers) {
  // wg showconf emits WireGuard-only fields, not wg-quick shell hooks. Preserve
  // the actual host key, port and fwmark; authority controls only peer entries.
  const host = existing.split(/^\[Peer\]\s*$/m)[0].trim();
  if (!host.startsWith('[Interface]\n') || !/^PrivateKey = [A-Za-z0-9+/]{43}=$/m.test(host))
    throw new Error('initialized_gateway_interface_required');
  for (const line of host.split('\n').slice(1)) {
    if (line.trim() && !/^(PrivateKey|ListenPort|FwMark) = [A-Za-z0-9+/=x]+$/.test(line))
      throw new Error('unexpected_wireguard_interface_field');
  }
  if (!publicPeers.startsWith('[Interface]\n')) throw new Error('invalid_public_peer_configuration');
  const peerStart = publicPeers.indexOf('[Peer]');
  return host + '\n' + (peerStart < 0 ? '' : '\n' + publicPeers.slice(peerStart));
}

export function wireGuardHost({ run = execute, runtimeDirectory = '/run/kicks-ios-gateway',
  io = { mkdtemp, writeFile, rm } } = {}) {
  return async publicPeers => {
    const { stdout } = await run('/usr/bin/wg', ['showconf', gatewayInterface]);
    const configuration = mergeHostInterface(stdout, publicPeers);
    // RuntimeDirectory is owned by root, mode 0700, on /run. Never put host
    // configuration or keys in arguments, logs, repository files or /tmp.
    const directory = await io.mkdtemp(join(runtimeDirectory, 'sync-'));
    const path = join(directory, 'wireguard.conf');
    try {
      await io.writeFile(path, configuration, { mode: 0o600, flag: 'wx' });
      await run('/usr/bin/wg', ['syncconf', gatewayInterface, path]);
    } finally { await io.rm(directory, { recursive: true, force: true }); }
  };
}

export async function clearHostPeers({ apply, run = execute }) {
  try { await apply(emptyPeers); }
  catch {
    // If peer synchronization itself is unavailable, stop forwarding on this
    // fixed staging interface. Keep its private key/configuration intact.
    await run('/usr/bin/ip', ['link', 'set', 'dev', gatewayInterface, 'down']);
    throw new Error('peer_clear_failed_interface_disabled');
  }
}

export async function runGatewayLoop({ readAuthority, apply, notify = async () => {}, signal,
  pause = ms => delay(ms, undefined, { signal }), now = Date.now }) {
  // Never inherit peers from a previous runner or stale saved configuration.
  await apply(emptyPeers);
  try {
    let ready = false;
    while (!signal?.aborted) {
      const readWithSafetyMargin = async () => {
        const snapshot = await readAuthority();
        // Reserve time for watchdog kill + ExecStopPost bounded host commands.
        // Renew leases before this margin; a frozen runner must not hold peers
        // past their authorization window. Host clocks must be synchronized.
        if (Array.isArray(snapshot.peers) && snapshot.peers.some(peer => Date.parse(peer.expiresAt) <= now() + 30_000))
          throw new Error('lease_renewal_required');
        return snapshot;
      };
      await reconcile({ readAuthority: readWithSafetyMargin, apply, now });
      if (!ready) { await notify('ready'); ready = true; }
      await notify('watchdog'); // only after authority validation and host apply
      await pause(1000);
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    await apply(emptyPeers);
  }
}

async function main() {
  if (process.platform !== 'linux') throw new Error('linux_staging_host_required');
  const apply = wireGuardHost();
  if (process.argv.length === 3 && process.argv[2] === '--clear') { await clearHostPeers({apply}); return; }
  if (process.argv.length !== 2) throw new Error('unsupported_runner_arguments');
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory?.startsWith('/run/credentials/')) throw new Error('systemd_credential_required');
  const authorization = (await readFile(join(credentialDirectory, 'authority-token'), 'utf8')).trim();
  if (!/^Bearer [^\s]+$/.test(authorization)) throw new Error('invalid_authority_credential');
  const url = (await readFile('/etc/kicks-ios-gateway/authority-url', 'utf8')).trim();
  if (new URL(url).pathname !== '/internal/staging/ios-gateway/peers') throw new Error('staging_authority_path_required');
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
  const readAuthority = httpsAuthorityReader({ url, authorization, signal: controller.signal });
  const notify = state => execute('/usr/bin/systemd-notify', [state === 'ready' ? '--ready' : 'WATCHDOG=1']);
  await runGatewayLoop({ readAuthority, apply, notify, signal: controller.signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // No raw child-process diagnostics: showconf may contain host private keys.
    console.error('Staging gateway reconciliation failed; supervisor must clear peers.');
    process.exitCode = 1;
  });
}
