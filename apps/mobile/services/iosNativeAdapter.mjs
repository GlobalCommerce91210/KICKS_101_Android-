const methods = ['getDeviceId', 'prepare', 'requestAuthorization', 'start', 'stop', 'getStatus'];

// Expo modules use the JSI registry; older signed builds may use the RN bridge.
// Never substitute the Android VPN module for the iOS collector.
export function selectIosNativeAdapter(platform, expoModule, legacyModule) {
  if (platform !== 'ios') return undefined;
  return [expoModule, legacyModule].find(module => module &&
    methods.every(method => typeof module[method] === 'function') &&
    ((!module.provision && !module.renewLease) ||
      (typeof module.provision === 'function' && typeof module.renewLease === 'function')));
}
