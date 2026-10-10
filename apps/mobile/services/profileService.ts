import { SessionError, SessionManager } from './sessionCore.ts';

type JsonObject = Record<string, any>;

export interface ConsumerProfileView {
  account: {
    subjectId: string;
    email: string;
    displayName: string | null;
    status: string;
  };
  product: {
    status: string;
  };
  consumerState: JsonObject | null;
  snapshot: JsonObject | null;
  devices: JsonObject[];
  permissions: JsonObject | null;
  consentLog: JsonObject[];
  wallet: JsonObject | null;
  monitoring: JsonObject | null;
  unavailable: string[];
}

async function readJson(response: Response, label: string): Promise<JsonObject> {
  if (!response.ok) throw new SessionError(`${label} is unavailable (HTTP ${response.status}).`);
  try { return await response.json(); }
  catch { throw new SessionError(`${label} returned an invalid response.`); }
}

async function optionalJson(
  manager: SessionManager,
  path: string,
  label: string,
  unavailable: string[]
): Promise<JsonObject | null> {
  try {
    const response = await manager.request(path);
    if (!response.ok) {
      unavailable.push(label);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (!manager.user) throw error;
    unavailable.push(label);
    return null;
  }
}

export async function loadConsumerProfile(manager: SessionManager): Promise<ConsumerProfileView> {
  const user = manager.user;
  if (!user) throw new SessionError('Sign in to continue.');

  const [accountResponse, productResponse] = await Promise.all([
    manager.request('/core/identity/v1/account'),
    manager.request('/core/identity/v1/products/kicks')
  ]);
  const account = await readJson(accountResponse, 'Account');
  const product = await readJson(productResponse, 'KICK’S profile');

  if (account.subject_id !== user.subjectId || product.profile?.subject_id !== user.subjectId ||
      product.entitlement?.subject_id !== user.subjectId) {
    throw new SessionError('Account identity mismatch. Sign in again.');
  }

  if (!['active', 'pending_verification'].includes(account.account_status) ||
      product.entitlement?.status !== 'active' || product.profile?.status !== 'active') {
    throw new SessionError('KICK’S access is unavailable for this account.');
  }
  if (manager.user !== user) throw new SessionError('Your session changed. Sign in again.');

  const unavailable: string[] = [];
  const encodedSubject = encodeURIComponent(user.subjectId);
  const [consumerState, snapshot, devicesView, permissions, consent, wallet] = await Promise.all([
    optionalJson(manager, '/v1/me/consumer-state', 'consumer state', unavailable),
    optionalJson(manager, '/core/consumer/v1/snapshot', 'consumer snapshot', unavailable),
    optionalJson(manager, '/core/consumer/v1/devices', 'connected devices', unavailable),
    optionalJson(manager, `/v1/permissions/users/${encodedSubject}/effective`, 'permissions', unavailable),
    optionalJson(manager, `/v1/permissions/users/${encodedSubject}/consent-log?page=1&page_size=25`, 'consent history', unavailable),
    optionalJson(manager, `/v1/wallet/${encodedSubject}`, 'wallet', unavailable)
  ]);

  const devices = Array.isArray(devicesView) ? devicesView : Array.isArray(devicesView?.devices) ? devicesView.devices : [];
  const consentLog = Array.isArray(consent) ? consent : Array.isArray(consent?.items) ? consent.items : [];
  const monitoring = snapshot?.monitoring && typeof snapshot.monitoring === 'object' ? snapshot.monitoring : null;

  if (manager.user !== user) throw new SessionError('Your session changed. Sign in again.');

  return {
    account: {
      subjectId: user.subjectId,
      email: typeof account.email === 'string' ? account.email : user.email,
      displayName: typeof account.display_name === 'string' ? account.display_name : null,
      status: typeof account.account_status === 'string' ? account.account_status : 'unknown'
    },
    product: {
      status: typeof product.profile?.status === 'string' ? product.profile.status : 'unknown'
    },
    consumerState,
    snapshot,
    devices,
    permissions,
    consentLog,
    wallet,
    monitoring,
    unavailable: [...new Set(unavailable)]
  };
}
