const fs = require('node:fs');
const path = require('node:path');
const { withEntitlementsPlist, withInfoPlist, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');

const TARGET = 'KicksPacketTunnel';
const BUNDLE = 'com.datastorm.kicks.PacketTunnel';
const GROUP = '$(AppIdentifierPrefix)com.datastorm.kicks.collector';
const { prepareWireGuardSource } = require('./prepare-wireguard-source');

// Opt-in while enrollment/gateway/device verification remains open. No remote
// certificate, profile, team membership, or App Store identity is modified here.
module.exports = function withKicksPacketTunnel(config) {
  config = withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.developer.networking.networkextension'] = ['packet-tunnel-provider'];
    mod.modResults['keychain-access-groups'] = [...new Set([
      ...(mod.modResults['keychain-access-groups'] ?? []), GROUP,
    ])];
    return mod;
  });
  config = withInfoPlist(config, mod => {
    mod.modResults.KICKSKeychainAccessGroup = GROUP;
    return mod;
  });
  config = withDangerousMod(config, ['ios', async mod => {
    prepareWireGuardSource(mod.modRequest.platformProjectRoot);
    const destination = path.join(mod.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'native/PacketTunnel/PacketTunnelProvider.swift'),
      path.join(destination, 'PacketTunnelProvider.swift'));
    const plist = require('@expo/plist').default;
    fs.writeFileSync(path.join(destination, `${TARGET}-Info.plist`), plist.build({
      CFBundleDisplayName: 'KICK’S Tunnel', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'XPC!', CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.networkextension.packet-tunnel',
        NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).PacketTunnelProvider' },
    }));
    fs.writeFileSync(path.join(destination, `${TARGET}.entitlements`), plist.build({
      'com.apple.developer.networking.networkextension': ['packet-tunnel-provider'],
      'keychain-access-groups': [GROUP],
    }));
    return mod;
  }]);
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const targets = project.pbxNativeTargetSection();
    // Repeated prebuilds must preserve a single extension and embedded product.
    if (Object.values(targets).some(t => typeof t === 'object' && t.name?.replaceAll('"', '') === TARGET)) return mod;
    const main = project.getFirstTarget();
    const mainList = objects.XCConfigurationList[main.firstTarget.buildConfigurationList];
    const mainSettings = objects.XCBuildConfiguration[mainList.buildConfigurations[0].value].buildSettings;
    const extension = project.addTarget(TARGET, 'app_extension', TARGET, BUNDLE);
    for (const entry of Object.values(objects.PBXBuildFile)) {
      if (entry && typeof entry === 'object' && entry.fileRef === extension.pbxNativeTarget.productReference) {
        entry.settings = { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] };
      }
    }
    // The Go bridge archive must exist before Swift/framework link resolution.
    // Put this phase first on the extension target and declare its archive output
    // so Xcode has an explicit pre-link dependency instead of a best-effort script.
    const wireGuardPhase = project.addBuildPhase([], 'PBXShellScriptBuildPhase', 'Build WireGuard Go bridge', extension.uuid, {
      shellPath: '/bin/sh', shellScript: 'set -eu\\n' +
        'test "$PLATFORM_NAME" = iphoneos || { echo "KICKS tunnel validation requires iphoneos; simulator unsupported" >&2; exit 1; }\\n' +
        'go version | grep -Eq "go1\\\\.19([. ]|$)" || { echo "Pinned WireGuard bridge requires Go 1.19" >&2; exit 1; }\\n' +
        'WG_SOURCE="$SRCROOT/vendor/wireguard-apple/Sources/WireGuardKitGo"\\n' +
        'WG_OUTPUT="$WG_SOURCE/out/libwg-go.a"\\n' +
        'test -f "$WG_SOURCE/Makefile"\\n' +
        'mkdir -p "$WG_SOURCE/out"\\n' +
        'make -C "$WG_SOURCE" DESTDIR="$WG_SOURCE/out" ARCHS=arm64 build\\n' +
        'test -s "$WG_OUTPUT" || { echo "Missing WireGuard bridge archive at $WG_OUTPUT" >&2; exit 1; }\\n',
    });
    if (wireGuardPhase?.buildPhase) {
      wireGuardPhase.buildPhase.outputPaths = ['"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/out/libwg-go.a"'];
    }
    project.addBuildPhase([`${TARGET}/PacketTunnelProvider.swift`], 'PBXSourcesBuildPhase', 'Sources', extension.uuid);
    const frameworks = project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', extension.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', extension.uuid);
    const list = objects.XCConfigurationList[extension.pbxNativeTarget.buildConfigurationList];
    for (const item of list.buildConfigurations) {
      Object.assign(objects.XCBuildConfiguration[item.value].buildSettings, {
        IPHONEOS_DEPLOYMENT_TARGET: '16.0', SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"', APPLICATION_EXTENSION_API_ONLY: 'YES',
        CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
        INFOPLIST_FILE: `"${TARGET}/${TARGET}-Info.plist"`,
        CURRENT_PROJECT_VERSION: mainSettings.CURRENT_PROJECT_VERSION ?? '1',
        MARKETING_VERSION: mainSettings.MARKETING_VERSION ?? '0.2.6',
        DEVELOPMENT_TEAM: mainSettings.DEVELOPMENT_TEAM ?? '""',
        LIBRARY_SEARCH_PATHS: ['"$(inherited)"', '"$(CONFIGURATION_BUILD_DIR)"', '"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/out"'],
        // Xcode 26 does not propagate this pinned package's root-level custom
        // Clang module maps to Swift consumers. Reference the original maps.
        OTHER_SWIFT_FLAGS: ['"$(inherited)"', '"-Xcc"',
          '"-fmodule-map-file=$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitC/module.modulemap"',
          '"-Xcc"',
          '"-fmodule-map-file=$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/module.modulemap"'],
        ENABLE_BITCODE: 'NO', ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
      });
    }
    const addObject = (section, value, comment) => {
      objects[section] ??= {};
      const id = project.generateUuid();
      objects[section][id] = value;
      objects[section][`${id}_comment`] = comment;
      return id;
    };
    const packageId = addObject('XCLocalSwiftPackageReference', {
      isa: 'XCLocalSwiftPackageReference', relativePath: '"vendor/wireguard-apple"',
    }, 'WireGuardKit');
    const root = project.getFirstProject().firstProject;
    root.packageReferences ??= [];
    root.packageReferences.push({ value: packageId, comment: 'WireGuardKit' });
    const productId = addObject('XCSwiftPackageProductDependency', {
      isa: 'XCSwiftPackageProductDependency', package: packageId, productName: 'WireGuardKit',
    }, 'WireGuardKit');
    extension.pbxNativeTarget.packageProductDependencies = [{ value: productId, comment: 'WireGuardKit' }];
    const buildId = addObject('PBXBuildFile', { isa: 'PBXBuildFile', productRef: productId,
      productRef_comment: 'WireGuardKit' }, 'WireGuardKit in Frameworks');
    frameworks.buildPhase.files.push({ value: buildId, comment: 'WireGuardKit in Frameworks' });
    return mod;
  });
};
