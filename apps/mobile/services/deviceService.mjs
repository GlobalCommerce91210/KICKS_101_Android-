// Account authorization stays in SessionManager; native proof never enters UI state.
export async function enrollCurrentDevice(manager, native) {
  const account = manager.user;
  if (!account) throw new Error('Sign in to enroll this device.');
  if (!native?.provision) throw new Error('Secure enrollment is unavailable in this build. Install a verified staging build with the native extension.');
  const deviceId = await manager.provisionIosCollector({ provision: native.provision.bind(native) });
  if (manager.user !== account) throw new Error('Your session changed. Refresh My Devices.');
  return deviceId;
}

export async function revokeAndUnlinkDevice(manager, deviceId, policy, native, requestId) {
  const account = manager.user;
  if (!account) throw new Error('Sign in to manage devices.');
  const current = () => {
    if (manager.user !== account) throw new Error('Your session changed. Refresh My Devices.');
  };
  if (!policy.permissionId) throw new Error('The collection permission is not configured. Contact staging support before unlinking.');
  // Stop locally first when this is the current native device. Never erase credentials.
  if (native) {
    let localId;
    try { localId = await native.getDeviceId(); }
    catch {
      const status = await native.getStatus(); current();
      if (status.connected || status.collecting) throw new Error('Current collector identity could not be confirmed. Turn off KICK'S in iOS VPN Settings, then retry.');
    }
    current();
    if (localId === deviceId) {
      await native.stop(); current();
      const status = await native.getStatus(); current();
      if (status.connected || status.collecting) throw new Error('Stop could not be confirmed. Turn off KICK'S in iOS VPN Settings, then retry.');
    }
  }
  const path = '/core/consumer/v1/devices/' + encodeURIComponent(deviceId);
  const response = await manager.request(path + '/consent?permissionId=' + encodeURIComponent(policy.permissionId));
  current();
  if (!response.ok) throw new Error('Consent could not be checked. The device remains linked; retry.');
  const { consent } = await response.json(); current();
  if (consent?.action === 'grant') {
    const revoked = await manager.request(path + '/consent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissionId: consent.permissionId, policyVersion: consent.policyVersion,
        purposeVersion: consent.purposeVersion, purpose: consent.purpose,
        action: 'revoke', activationRequestId: requestId }),
    });
    current();
    if (!revoked.ok) throw new Error('Collection permission could not be revoked. The device remains linked; retry.');
    const check = await manager.request(path + '/consent?permissionId=' + encodeURIComponent(policy.permissionId));
    current();
    if (!check.ok || (await check.json()).consent?.action !== 'revoke') throw new Error('Revocation could not be verified. Refresh and retry unlinking.');
    current();
  }
  const unlinked = await manager.request(path, { method: 'DELETE' }); current();
  if (!unlinked.ok) throw new Error('Unlink could not be confirmed. Collection permission may already be revoked; refresh and retry.');
}
