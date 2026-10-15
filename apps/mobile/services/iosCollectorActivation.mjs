export class CollectorActivationError extends Error {}

// The native adapter must own its device identity and secure enrollment material.
// UI toggles and a saved consent record are never evidence of collection.
export async function activateIosCollector(deps) {
  const subject = deps.subject();
  if (!subject) throw new CollectorActivationError('Sign in to DataStorm before starting monitoring.');
  if (!await deps.disclose()) return { state: 'off', reason: 'disclosure_canceled' };
  const current = () => {
    if (deps.subject() !== subject) throw new CollectorActivationError('Your account changed. Monitoring remains off.');
  };
  current();
  if (!deps.native) throw new CollectorActivationError('This build does not include the iOS collector. Monitoring remains off.');
  let started = false;
  try {
    if (deps.provision) { await deps.provision(); current(); }
    const deviceId = await deps.native.getDeviceId();
    current();
    if (!deviceId) throw new CollectorActivationError('Enroll this iPad before starting monitoring.');
    // Prepare checks this device's enrollment and gateway before saving a grant.
    await deps.native.prepare(); current();
    let consent = await deps.readConsent(deviceId); current();
    const matches = value => value?.action === 'grant' && value.deviceId === deviceId &&
      value.subjectId === subject && value.permissionId === deps.policy.permissionId &&
      value.policyVersion === deps.policy.policyVersion && value.purposeVersion === deps.policy.purposeVersion &&
      value.purpose === deps.policy.purpose;
    if (!matches(consent)) {
      await deps.grantConsent(deviceId); current();
      consent = await deps.readConsent(deviceId); current();
    }
    if (!matches(consent)) throw new CollectorActivationError('Saved consent could not be verified. Monitoring remains off.');
    if (deps.renewLease) {
      await deps.renewLease(); current();
      consent = await deps.readConsent(deviceId); current();
      if (!matches(consent)) throw new CollectorActivationError('Permission was withdrawn. Monitoring remains off.');
    }
    deps.onState('vpn_authorization');
    const authorization = await deps.native.requestAuthorization(); current();
    if (authorization !== 'authorized') return { state: 'off', reason: 'vpn_not_authorized' };
    // Recheck after the OS prompt: consent could have been revoked meanwhile.
    consent = await deps.readConsent(deviceId); current();
    if (!matches(consent)) throw new CollectorActivationError('Permission was withdrawn. Monitoring remains off.');
    const startedAt = Date.now();
    started = true;
    await deps.native.start(); current();
    const status = await deps.native.getStatus(); current();
    if (!status || status.deviceId !== deviceId || status.permissionId !== deps.policy.permissionId ||
        status.connected !== true || status.consentVerified !== true) {
      throw new CollectorActivationError('The collector connection could not be verified. Monitoring was stopped.');
    }
    const acceptedAt = Date.parse(status.lastAcceptedObservationAt ?? '');
    if (status.collecting !== true || !Number.isFinite(acceptedAt) || acceptedAt < startedAt || acceptedAt > Date.now() + 5000) {
      deps.onState('connected_waiting_for_evidence');
      return { state: 'connected_waiting_for_evidence' };
    }
    deps.onState('collecting');
    return { state: 'collecting' };
  } catch (error) {
    if (started) {
      try { await deps.native.stop(); }
      catch { throw new CollectorActivationError('Collector stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.'); }
    }
    throw error;
  }
}
