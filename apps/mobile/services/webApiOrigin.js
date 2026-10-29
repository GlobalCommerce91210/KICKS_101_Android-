// Web may use the current HTTPS app origin when no explicit API origin is configured.
exports.selectWebApiOrigin = function selectWebApiOrigin(explicitOrigin, locationOrigin) {
  const candidate = explicitOrigin ?? locationOrigin;
  if (!candidate) throw new Error('web_api_origin_unavailable');
  return candidate;
};
