// A native device's localhost is the device, not the DataStorm service.
exports.requireIosApiOrigin = function requireIosApiOrigin(value) {
  if (!value) throw new Error('ios_api_not_configured');
  let url;
  try { url = new URL(value); } catch { throw new Error('ios_api_invalid'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || host === 'localhost' || host.endsWith('.localhost') ||
      host === '[::1]' || host.startsWith('127.') || host === '0.0.0.0') {
    throw new Error('ios_api_requires_remote_https_origin');
  }
  return url.origin;
};
