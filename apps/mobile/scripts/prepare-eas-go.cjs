const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.env.EAS_BUILD_PLATFORM !== 'ios' || process.env.KICKS_IOS_NATIVE_TUNNEL !== '1') return;
  if (process.platform !== 'darwin') throw new Error('Native iOS Go setup requires macOS');
  const archives = {
    arm64: ['go1.19.13.darwin-arm64.tar.gz', '022b35fa9c79b9457fa4a14fd9c4cf5f8ea315a8f2e3b3cd949fea55e11a7d7b'],
    x64: ['go1.19.13.darwin-amd64.tar.gz', '1b4329dc9e73def7f894ca71fce78bb9f3f5c4c8671b6c7e4f363a3f47e88325'],
  };
  const archive = archives[process.arch];
  if (!archive) throw new Error('Unsupported macOS build architecture');
  const destination = path.resolve(__dirname, '../.eas-tools');
  const go = path.join(destination, 'go/bin/go');
  if (fs.existsSync(go) && execFileSync(go, ['version'], { encoding: 'utf8' }).includes('go1.19.13 ')) return;
  const response = await fetch('https://go.dev/dl/' + archive[0], { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Go toolchain download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== archive[1]) throw new Error('Go archive checksum mismatch');
  fs.mkdirSync(destination, { recursive: true });
  const file = path.join(destination, archive[0]);
  fs.writeFileSync(file, bytes);
  try { execFileSync('tar', ['-xzf', file, '-C', destination], { stdio: 'inherit' }); }
  finally { fs.unlinkSync(file); }
  const version = execFileSync(go, ['version'], { encoding: 'utf8' }).trim();
  if (!version.includes('go1.19.13 ')) throw new Error('Unexpected Go toolchain');
  console.log('Prepared pinned WireGuard toolchain: ' + version);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
