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
        LIBRARY_SEARCH_PATHS: ['"$(inherited)"', '"$(CONFIGURATION_BUILD_DIR)"'],
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
    // A separate prerequisite target is required: a shell phase after Sources/
    // Frameworks does not guarantee that Xcode waits before the extension link.
    // Declare both a target edge and the actual archive output dependency.
    const bridgeName = 'KicksWireGuardBridge';
    const bridgeScript = 'set -eu\n' +
        'test "$PLATFORM_NAME" = iphoneos || { echo "KICKS tunnel validation requires iphoneos; simulator unsupported" >&2; exit 1; }\n' +
        'go version | grep -Eq "go1\\.19([. ]|$)" || { echo "Pinned WireGuard bridge requires Go 1.19" >&2; exit 1; }\n' +
        'WG_SOURCE="$SRCROOT/vendor/wireguard-apple/Sources/WireGuardKitGo"\n' +
        'test -f "$WG_SOURCE/Makefile"\n' +
        'make -C "$WG_SOURCE" ARCHS="$ARCHS" PLATFORM_NAME="$PLATFORM_NAME" SDKROOT="$SDKROOT" ' +
        'DESTDIR="$BUILT_PRODUCTS_DIR" BUILDDIR="$PROJECT_TEMP_DIR/wireguard-go-bridge-$CONFIGURATION-$PLATFORM_NAME"\n' +
        'test -s "$BUILT_PRODUCTS_DIR/libwg-go.a"\n' +
        'xcrun lipo -info "$BUILT_PRODUCTS_DIR/libwg-go.a"\n';
    const bridgePhase = addObject('PBXShellScriptBuildPhase', {
      isa: 'PBXShellScriptBuildPhase', buildActionMask: 2147483647,
      files: [], inputPaths: ['"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/Makefile"',
        '"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/go.mod"',
        '"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/go.sum"',
        '"$(SRCROOT)/vendor/wireguard-apple/Sources/WireGuardKitGo/api-apple.go"'],
      outputPaths: ['"$(BUILT_PRODUCTS_DIR)/libwg-go.a"'],
      name: '"Build WireGuard Go bridge"', runOnlyForDeploymentPostprocessing: 0,
      shellPath: '/bin/sh', shellScript: JSON.stringify(bridgeScript),
    }, 'Build WireGuard Go bridge');
    const bridgeConfigs = list.buildConfigurations.map(item => {
      const original = objects.XCBuildConfiguration[item.value];
      const id = addObject('XCBuildConfiguration', {
        isa: 'XCBuildConfiguration', name: original.name,
        buildSettings: { SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: '16.0', ARCHS: '"$(ARCHS_STANDARD)"',
          SUPPORTED_PLATFORMS: 'iphoneos', ENABLE_USER_SCRIPT_SANDBOXING: 'NO' },
      }, original.name);
      return { value: id, comment: original.name };
    });
    const bridgeList = addObject('XCConfigurationList', {
      isa: 'XCConfigurationList', buildConfigurations: bridgeConfigs,
      defaultConfigurationIsVisible: 0, defaultConfigurationName: list.defaultConfigurationName ?? 'Release',
    }, 'Build configuration list for KicksWireGuardBridge');
    const bridgeTarget = addObject('PBXAggregateTarget', {
      isa: 'PBXAggregateTarget', name: bridgeName, productName: bridgeName,
      buildConfigurationList: bridgeList, buildPhases: [{ value: bridgePhase, comment: 'Build WireGuard Go bridge' }],
      dependencies: [],
    }, bridgeName);
    root.targets.push({ value: bridgeTarget, comment: bridgeName });
    const proxy = addObject('PBXContainerItemProxy', {
      isa: 'PBXContainerItemProxy', containerPortal: project.getFirstProject().uuid,
      containerPortal_comment: 'Project object', proxyType: 1,
      remoteGlobalIDString: bridgeTarget, remoteInfo: bridgeName,
    }, 'PBXContainerItemProxy');
    const dependency = addObject('PBXTargetDependency', {
      isa: 'PBXTargetDependency', target: bridgeTarget, target_comment: bridgeName,
      targetProxy: proxy, targetProxy_comment: 'PBXContainerItemProxy',
    }, 'PBXTargetDependency');
    extension.pbxNativeTarget.dependencies.push({ value: dependency, comment: 'PBXTargetDependency' });
    const archiveRef = addObject('PBXFileReference', {
      isa: 'PBXFileReference', explicitFileType: 'archive.ar',
      path: '"libwg-go.a"', sourceTree: 'BUILT_PRODUCTS_DIR',
    }, 'libwg-go.a');
    const archiveBuild = addObject('PBXBuildFile', {
      isa: 'PBXBuildFile', fileRef: archiveRef, fileRef_comment: 'libwg-go.a',
    }, 'libwg-go.a in Frameworks');
    frameworks.buildPhase.files.push({ value: archiveBuild, comment: 'libwg-go.a in Frameworks' });
    return mod;
  });
};
