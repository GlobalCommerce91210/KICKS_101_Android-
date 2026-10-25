const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication
} = require('@expo/config-plugins');

module.exports = function withKicksVpn(config) {
  config = withMainApplication(config, config => {
    let contents = config.modResults.contents;
    const packageImport = 'import com.datastorm.kicks.vpn.KicksVpnPackage';
    if (!contents.includes(packageImport)) {
      contents = contents.replace(/(package [^\n]+\n)/, `$1\n${packageImport}\n`);
    }
    if (!contents.includes('add(KicksVpnPackage())')) {
      const packageList = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      if (!packageList.test(contents)) throw new Error('Unable to register KicksVpnPackage in MainApplication');
      contents = contents.replace(packageList, '$1\n          add(KicksVpnPackage())');
    }
    config.modResults.contents = contents;
    return config;
  });

  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const permission of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.POST_NOTIFICATIONS'
    ]) {
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === permission)) {
        manifest['uses-permission'].push({ $: { 'android:name': permission } });
      }
    }

    const application = manifest.application?.[0];
    if (!application) throw new Error('Android application element is missing');
    application.service ??= [];
    if (!application.service.some(service => service.$['android:name'] === '.vpn.KicksVpnService')) {
      application.service.push({
        $: {
          'android:name': '.vpn.KicksVpnService',
          'android:permission': 'android.permission.BIND_VPN_SERVICE',
          'android:exported': 'false',
          'android:foregroundServiceType': 'specialUse'
        },
        property: [{
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'User-authorized, metadata-only privacy monitoring VPN'
          }
        }],
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.net.VpnService' } }]
        }]
      });
    }
    return config;
  });

  config = withAppBuildGradle(config, config => {
    if (!config.modResults.contents.includes('COLLECTOR_ENABLED')) {
      const defaultConfig = /(defaultConfig\s*\{)/;
      if (!defaultConfig.test(config.modResults.contents)) throw new Error('Unable to configure KicksVpn BuildConfig');
      config.modResults.contents = config.modResults.contents.replace(
        defaultConfig,
        '$1\n        buildConfigField "boolean", "COLLECTOR_ENABLED", "false"'
      );
    }
    return config;
  });

  return withDangerousMod(config, ['android', async config => {
    const projectRoot = config.modRequest.projectRoot;
    const androidRoot = config.modRequest.platformProjectRoot;
    const sourceRoot = path.join(projectRoot, 'native/android/src/main/java/com/datastorm/kicks/vpn');
    const targetRoot = path.join(androidRoot, 'app/src/main/java/com/datastorm/kicks/vpn');
    await fs.mkdir(targetRoot, { recursive: true });
    for (const file of ['KicksVpnModule.kt', 'KicksVpnPackage.kt', 'KicksVpnService.kt']) {
      await fs.copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
    }
    return config;
  }]);
};
