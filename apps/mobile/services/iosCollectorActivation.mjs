export class CollectorActivationError extends Error {}
class CollectorActivationCanceledError extends CollectorActivationError {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isCanonicalUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value); }
export function isCompleteCollectorStatus(status) {
  return !!status && status.unavailableReason == null &&
    typeof status.connected === 'boolean' && typeof status.collecting === 'boolean' &&
    typeof status.consentVerified === 'boolean';
}
export function verifiedCollectorStopped(status) {
  return isCompleteCollectorStatus(status) && status.connected === false && status.collecting === false;
}

export function verifiedCollectorConnection(status, consent, now = Date.now()) {
  const expiry = Date.parse(status?.expiresAt ?? '');
  return !!consent?.activationId && status?.connected === true && status.consentVerified === true &&
    status.deviceId === consent.deviceId && status.permissionId === consent.permissionId &&
    status.activationId === consent.activationId && Number.isFinite(expiry) && expiry > now && expiry <= now + 300_000;
}

// The native adapter must own its device identity and secure enrollment material.
// UI toggles and a saved consent record are never evidence of collection.
export async function activateIosCollector(deps) {
  const subject = deps.subject();
  if (!subject) throw new CollectorActivationError('Sign in to DataStorm before starting monitoring.');
  if (!deps.policy || !['permissionId', 'policyVersion', 'purposeVersion', 'purpose'].every(key =>
    typeof deps.policy[key] === 'string' && deps.policy[key].trim())) {
    throw new CollectorActivationError('The reviewed collection purpose is not configured. Monitoring remains off.');
  }
  if (!await deps.disclose()) return { state: 'off', reason: 'disclosure_canceled' };
  const current = () => {
    if (deps.isCanceled?.()) throw new CollectorActivationCanceledError('Collector start canceled. Monitoring remains off.');
    if (deps.subject() !== subject) throw new CollectorActivationError('Your account changed. Monitoring remains off.');
  };
  current();
  if (!deps.native) throw new CollectorActivationError('This build does not include the iOS collector. Monitoring remains off.');
  let started = false;
  try {
    const capability = await deps.native.getStatus(); current();
    if (!isCompleteCollectorStatus(capability)) {
      throw new CollectorActivationError(capability?.unavailableReason ?? 'Native collector status is unavailable or incomplete. Monitoring remains off.');
    }
    if (deps.provision) { await deps.provision(); current(); }
    const deviceId = await deps.native.getDeviceId();
    current();
    if (!deviceId) throw new CollectorActivationError('Enroll this iPad before starting monitoring.');
    // Prepare checks the embedded extension and enrollment; the lease follows the grant.
    await deps.native.prepare(); current();
    let consent = await deps.readConsent(deviceId); current();
    const matches = value => value?.action === 'grant' && value.deviceId === deviceId &&
      value.subjectId === subject && value.permissionId === deps.policy.permissionId &&
      value.policyVersion === deps.policy.policyVersion && value.purposeVersion === deps.policy.purposeVersion &&
      value.purpose === deps.policy.purpose;
    // Every Start/Restart must submit a fresh, explicit grant. A matching saved
    // record is input for replay detection only; it is never reused as proof.
    const priorActivationId = consent?.activationId ?? null;
    const activationRequestId = deps.newActivationRequestId?.() ?? globalThis.crypto?.randomUUID?.();
    if (!isCanonicalUuid(activationRequestId)) {
      throw new CollectorActivationError('A valid activation request ID is unavailable. Monitoring remains off.');
    }
    await deps.grantConsent(deviceId, activationRequestId); current();
    consent = await deps.readConsent(deviceId); current();
    if (!matches(consent) || !consent.activationId ||
        (priorActivationId && consent.activationId === priorActivationId)) {
      throw new CollectorActivationError('Fresh consent could not be verified. Monitoring remains off.');
    }
    const activationId = consent.activationId;
    if (deps.renewLease) {
      await deps.renewLease(); current();
      consent = await deps.readConsent(deviceId); current();
      if (!matches(consent) || consent.activationId !== activationId) throw new CollectorActivationError('Permission was withdrawn or changed. Monitoring remains off.');
    }
    deps.onState('vpn_authorization');
    const authorization = await deps.native.requestAuthorization(); current();
    if (authorization !== 'authorized') return { state: 'off', reason: 'vpn_not_authorized' };
    // Recheck after the OS prompt: consent could have been revoked meanwhile.
    consent = await deps.readConsent(deviceId); current();
    if (!matches(consent) || consent.activationId !== activationId) throw new CollectorActivationError('Permission was withdrawn or changed. Monitoring remains off.');
    const startedAt = Date.now();
    current();
    started = true;
    await deps.native.start(); current();
    deps.onState('connecting');
    const wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let status;
    const deadline = Date.now() + 15_000;
    for (let attempt = 0; attempt < 16; attempt++) {
      status = await deps.native.getStatus(); current();
      consent = await deps.readConsent(deviceId); current();
      if (!matches(consent) || consent.activationId !== activationId) {
        throw new CollectorActivationError('Permission was withdrawn or changed. Monitoring was stopped.');
      }
      if (!isCompleteCollectorStatus(status)) {
        throw new CollectorActivationError(status?.unavailableReason ?? 'Native collector status is unavailable or incomplete. Monitoring was stopped.');
      }
      if (verifiedCollectorConnection(status, consent)) break;
      if ((status?.deviceId && status.deviceId !== deviceId) ||
          (status?.permissionId && status.permissionId !== deps.policy.permissionId) ||
          (status?.activationId && status.activationId !== activationId) ||
          (status?.expiresAt && Date.parse(status.expiresAt) <= Date.now()) ||
          attempt === 15 || Date.now() >= deadline) {
        throw new CollectorActivationError('The collector connection could not be verified. Monitoring was stopped.');
      }
      await wait(1000); current();
    }
    const acceptedAt = Date.parse(status.lastAcceptedObservationAt ?? '');
    if (status.collecting !== true || !Number.isFinite(acceptedAt) || acceptedAt < startedAt || acceptedAt > Date.now() + 5000) {
      deps.onState('connected_waiting_for_evidence');
      return { state: 'connected_waiting_for_evidence' };
    }
    deps.onState('collecting');
    return { state: 'collecting' };
  } catch (error) {
    const canceled = error instanceof CollectorActivationCanceledError;
    if (started) {
      try {
        await deps.native.stop();
        const stopped = await deps.native.getStatus();
        if (!verifiedCollectorStopped(stopped)) throw new Error('unconfirmed');
      }
      catch { throw new CollectorActivationError('Collector stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.'); }
      if (canceled) return { state: 'off', reason: 'start_canceled_after_cleanup' };
    }
    if (canceled) return { state: 'off', reason: 'start_canceled' };
    throw error;
  }
}

