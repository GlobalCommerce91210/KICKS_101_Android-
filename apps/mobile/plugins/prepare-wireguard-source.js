const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REVISION = '2fec12a6e1f6e3460b6ee483aa00ad29cddadab1';
const URL = 'https://git.zx2c4.com/wireguard-apple';
const MANIFEST_SHA256 = '8f8acfa4eed550786b07c372140b2f68fb1543a76a90e309e9208b78b9e258ae';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const toolsPatchedManifest = bytes => bytes.toString('utf8').replace(
  /^\/\/ swift-tools-version:5\.3\n/, '// swift-tools-version:5.5\n');
const patchedManifest = bytes => Buffer.from(toolsPatchedManifest(bytes)
  .replace('import PackageDescription', 'import PackageDescription\nimport Foundation\n\nlet packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path')
  .replace('dependencies: ["WireGuardKitGo", "WireGuardKitC"]',
    'dependencies: ["WireGuardKitGo", "WireGuardKitC"],\n' +
    '            swiftSettings: [.unsafeFlags([\n' +
    '                "-Xcc", "-fmodule-map-file=\\(packageDirectory)/Sources/WireGuardKitC/module.modulemap",\n' +
    '                "-Xcc", "-fmodule-map-file=\\(packageDirectory)/Sources/WireGuardKitGo/module.modulemap"\n' +
    '            ])]'));

function prepareWireGuardSource(iosRoot) {
  const destination = path.join(iosRoot, 'vendor', 'wireguard-apple');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const git = args => execFileSync('git', ['-C', destination, ...args], { encoding: 'utf8' }).trim();
  if (!fs.existsSync(destination)) {
    execFileSync('git', ['clone', '--no-checkout', URL, destination], { stdio: 'inherit' });
    git(['checkout', '--detach', REVISION]);
  }
  if (git(['rev-parse', 'HEAD']) !== REVISION) throw new Error('WireGuard source revision mismatch');
  // Verify the original bytes and all tracked source; only this compatibility
  // patch is allowed. The original license and attribution stay in the checkout.
  const original = execFileSync('git', ['-C', destination, 'show', `${REVISION}:Package.swift`]);
  if (hash(original) !== MANIFEST_SHA256) throw new Error('WireGuard manifest integrity mismatch');
  const patched = patchedManifest(original);
  const file = path.join(destination, 'Package.swift');
  const current = Buffer.from(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
  if (hash(current) !== hash(original) && hash(current) !== hash(patched) &&
      hash(current) !== hash(Buffer.from(toolsPatchedManifest(original)))) {
    throw new Error('Unexpected local WireGuard manifest modification');
  }
  git(['diff', '--exit-code', 'HEAD', '--', '.', ':(exclude)Package.swift']);
  if (git(['ls-files', '--others', '--exclude-standard'])) throw new Error('Unexpected untracked WireGuard source');
  fs.writeFileSync(file, patched);
  fs.writeFileSync(path.join(iosRoot, 'vendor', 'WIREGUARD_PROVENANCE.json'), JSON.stringify({
    repository: URL, revision: REVISION, originalManifestSha256: MANIFEST_SHA256,
    patchedManifestSha256: hash(patched),
    patch: 'Package.swift tools-version 5.5 and explicit existing C/Go module-map compiler flags; no transport source changes',
  }, null, 2) + '\n');
  return destination;
}

module.exports = { prepareWireGuardSource, REVISION };
