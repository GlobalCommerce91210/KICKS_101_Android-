// Keep Android metadata unchanged; reuse the existing iOS EAS project.
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PLATFORM !== 'ios' && process.env.KICKS_BUILD_PLATFORM !== 'ios') return config;
  return {
    ...config,
    slug: 'kicks-ios',
    owner: 'datastorm_inc',
    extra: {
      ...config.extra,
      eas: { projectId: 'f6728f6f-0a01-4b9c-951e-d09d547b7f9f' },
    },
  };
};
