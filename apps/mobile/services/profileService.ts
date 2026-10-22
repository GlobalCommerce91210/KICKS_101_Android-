import { parseResponse, isObject, validWallet, ApiError, type RequestState } from './requestState.mjs';
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
  sources: Record<string, { state: RequestState; message?: string }>;
}

async function readJson(response: Response, label: string): Promise<JsonObject> {
  return parseResponse(response, isObject);
}

async function optionalJson(manager: SessionManager, path: string, label: string, unavailable: string[],
  sources: ConsumerProfileView['sources'], validate: (value: any) => boolean = isObject,
  empty: (value: any) => boolean = () => false): Promise<JsonObject | null> {
  try {
    const value = await parseResponse(await manager.request(path), validate);
    sources[label] = { state: empty(value) ? 'EMPTY' : 'SUCCESS' };
    return value;
  } catch (error) {
    if (!manager.user) throw error;
    unavailable.push(label);
    sources[label] = { state: error instanceof ApiError ? error.state : 'UNAVAILABLE',
      message: error instanceof ApiError ? error.message : 'Service unavailable. Refresh to retry.' };
    return null;
  }
}
const list = (key: string) => (value: any) => {
  const items = Array.isArray(value) ? value : isObject(value) ? value[key] : null;
  return Array.isArray(items) && items.every(item => isObject(item) && typeof item[key === 'devices' ? 'device_id' : 'log_id'] === 'string');
};
const emptyList = (key: string) => (value: any) => (Array.isArray(value) ? value : value[key]).length === 0;

async function hydrateConsumerProfile(manager: SessionManager): Promise<ConsumerProfileView> {
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
  const sources: ConsumerProfileView['sources'] = {};
  const [consumerState, snapshot, devicesView, permissions, consent, wallet] = await Promise.all([
    optionalJson(manager, '/v1/me/consumer-state', 'consumer state', unavailable, sources),
    optionalJson(manager, '/core/consumer/v1/snapshot', 'consumer snapshot', unavailable, sources),
    optionalJson(manager, '/core/consumer/v1/devices', 'connected devices', unavailable, sources, list('devices'), emptyList('devices')),
    optionalJson(manager, '/core/consumer/v1/permissions/effective', 'permissions', unavailable, sources, value => isObject(value) && Array.isArray(value.apps), value => value.apps.length === 0),
    optionalJson(manager, '/core/consumer/v1/permissions/consent-log?page=1&page_size=25', 'consent history', unavailable, sources, list('items'), emptyList('items')),
    optionalJson(manager, '/core/consumer/v1/wallet', 'wallet', unavailable, sources, validWallet)
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
    sources,
    unavailable: [...new Set(unavailable)]
  };
}

// Share only in-flight reads for this exact verified session; never cache authorization.
const flights = new WeakMap<SessionManager, { user: object | null; generation: number; promise: Promise<ConsumerProfileView> }>();
export function loadConsumerProfile(manager: SessionManager): Promise<ConsumerProfileView> {
  const existing = flights.get(manager);
  if (existing && existing.user === manager.user && existing.generation === manager.sessionGeneration) return existing.promise;
  const promise = hydrateConsumerProfile(manager);
  const entry = { user: manager.user, generation: manager.sessionGeneration, promise };
  flights.set(manager, entry);
  void promise.finally(() => { if (flights.get(manager) === entry) flights.delete(manager); }).catch(() => {});
  return promise;
}
