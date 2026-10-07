// Keep Android metadata unchanged; reuse the existing iOS EAS project.
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PLATFORM !== 'ios' && process.env.KICKS_BUILD_PLATFORM !== 'ios') return config;
  return {
    ...config,
    slug: 'ezekiel-ios',
    owner: 'datastorm-inc',
    extra: {
      ...config.extra,
      eas: { projectId: '1d2a0901-41c9-4026-b835-139e785db502' },
    },
  };
};
