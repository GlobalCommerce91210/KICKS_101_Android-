const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Android collector remains unavailable unless forwarding is implemented and explicitly enabled', () => {
  const service = read('native/android/src/main/java/com/datastorm/kicks/vpn/KicksVpnService.kt');
  const module = read('native/android/src/main/java/com/datastorm/kicks/vpn/KicksVpnModule.kt');
  const plugin = read('plugins/withKicksVpn.js');

  assert.match(service, /FORWARDING_IMPLEMENTED:\s*Boolean\s*=\s*false/);
  assert.match(module, /BuildConfig\.COLLECTOR_ENABLED\s*&&\s*KicksVpnService\.FORWARDING_IMPLEMENTED/);
  assert.match(plugin, /buildConfigField "boolean", "COLLECTOR_ENABLED", "false"/);
});

test('Android VPN service does not establish a TUN or inspect traffic', () => {
  const service = read('native/android/src/main/java/com/datastorm/kicks/vpn/KicksVpnService.kt');

  assert.doesNotMatch(service, /\.establish\s*\(/);
  assert.doesNotMatch(service, /protect\s*\(/);
  assert.doesNotMatch(service, /read\s*\(|FileInputStream|DatagramChannel|SocketChannel/);
});

test('unavailable collector does not add foreground-service or notification permissions', () => {
  const plugin = read('plugins/withKicksVpn.js');

  assert.doesNotMatch(plugin, /android\.permission\.(?:FOREGROUND_SERVICE|POST_NOTIFICATIONS)/);
  assert.doesNotMatch(plugin, /foregroundServiceType|PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
});
