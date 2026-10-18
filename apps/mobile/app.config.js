// Preserve platform metadata and reuse the existing iOS EAS project.
module.exports = ({ config }) => {
  const nativeConfig = {
    ...config,
    plugins: [...new Set([...(config.plugins ?? []), 'expo-secure-store'])],
  };
  if (process.env.EAS_BUILD_PLATFORM !== 'ios' && process.env.KICKS_BUILD_PLATFORM !== 'ios') return nativeConfig;
  if (process.env.KICKS_IOS_NATIVE_TUNNEL === '1') {
    nativeConfig.plugins.push('./plugins/with-kicks-packet-tunnel');
  }
  return {
    ...nativeConfig,
    slug: 'ezekiel-ios',
    owner: 'datastorm-inc',
    extra: {
      ...config.extra,
      eas: {
        projectId: '1d2a0901-41c9-4026-b835-139e785db502',
        build: {
          experimental: {
            ios: {
              appExtensions: [{
                targetName: 'KicksPacketTunnel',
                bundleIdentifier: 'com.datastorm.kicks.PacketTunnel',
                entitlements: {
                  'com.apple.developer.networking.networkextension': ['packet-tunnel-provider'],
                  'keychain-access-groups': ['$(AppIdentifierPrefix)com.datastorm.kicks.collector'],
                },
              }],
            },
          },
        },
      },
    },
  };
};
