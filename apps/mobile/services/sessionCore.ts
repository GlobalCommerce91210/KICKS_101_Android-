export interface AccountUser { subjectId: string; email: string; }
export interface SessionStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void>; }
export class SessionError extends Error {}
export class SessionManager {
  user: AccountUser | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private epoch = 0;
  private refreshFlight: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private storage: SessionStorage;
  private baseUrl: () => string;
  private transport: typeof fetch;
  constructor(storage: SessionStorage, baseUrl: () => string, transport: typeof fetch = fetch) {
    this.storage = storage; this.baseUrl = baseUrl; this.transport = transport;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  private persist(work: () => Promise<void>) {
    const pending = this.writes.then(work);
    this.writes = pending.catch(() => {});
    return pending;
  }
  private async send(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try { return await this.transport(this.baseUrl() + path, { ...init, redirect: 'error', signal: controller.signal }); }
    catch { throw new SessionError('Unable to connect. Check your connection and try again.'); }
    finally { clearTimeout(timer); }
  }
  private async verify(accessToken: string): Promise<AccountUser> {
    const headers = { authorization: 'Bearer ' + accessToken };
    const [accountResponse, accessResponse] = await Promise.all([
      this.send('/core/identity/v1/account', { headers }),
      this.send('/core/identity/v1/products/kicks', { headers })
    ]);
    if (!accountResponse.ok || !accessResponse.ok) throw new SessionError('Your account access could not be verified. Sign in again.');
    const account = await accountResponse.json();
    const access = await accessResponse.json();
    if (typeof account.subject_id !== 'string' || typeof account.email !== 'string' ||
        !['active', 'pending_verification'].includes(account.account_status) ||
        access.entitlement?.subject_id !== account.subject_id ||
        access.entitlement?.status !== 'active' || access.profile?.status !== 'active' ||
        access.profile?.subject_id !== account.subject_id) {
      throw new SessionError('KICK’S access is unavailable for this account.');
    }
    return { subjectId: account.subject_id, email: account.email };
  }
  private async accept(data: any, epoch: number) {
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' ||
        data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new SessionError('The sign-in response could not be verified.');
    }
    const user = await this.verify(data.access_token);
    if (epoch !== this.epoch) throw new SessionError('Sign-in was canceled.');
    const origin = this.baseUrl();
    await this.persist(async () => {
      if (epoch !== this.epoch) return;
      await this.storage.write(JSON.stringify({ origin, refreshToken: data.refresh_token }));
    });
    if (epoch !== this.epoch) throw new SessionError('Sign-in was canceled.');
    this.user = user; this.accessToken = data.access_token; this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.emit();
  }
  async login(email: string, password: string) {
    const epoch = ++this.epoch;
    this.refreshFlight = null;
    this.user = null; this.accessToken = null; this.refreshToken = null; this.emit();
    await this.persist(() => this.storage.clear());
    const response = await this.send('/core/identity/v1/session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password })
    });
    if (!response.ok) throw new SessionError(response.status === 401 ? 'Email or password was not accepted.' : 'Sign-in is unavailable. Try again later.');
    await this.accept(await response.json(), epoch);
  }
  async restore() {
    const epoch = this.epoch;
    const saved = await this.storage.read();
    if (!saved || epoch !== this.epoch) return;
    let data: any;
    try { data = JSON.parse(saved); } catch { await this.persist(() => this.storage.clear()); return; }
    if (data.origin !== this.baseUrl() || typeof data.refreshToken !== 'string') {
      await this.persist(() => this.storage.clear()); return;
    }
    this.refreshToken = data.refreshToken;
    try { await this.refresh(epoch); }
    catch (error) {
      if (epoch !== this.epoch) throw error;
      this.user = null; this.accessToken = null; this.refreshToken = null; this.emit();
      // Rotation can succeed remotely even if its response is lost: require fresh sign-in.
      await this.persist(() => this.storage.clear());
      throw error;
    }
  }
  private async refresh(epoch = this.epoch) {
    if (this.refreshFlight) return this.refreshFlight;
    const token = this.refreshToken;
    if (!token) throw new SessionError('Sign in to continue.');
    const flight = (async () => {
      const response = await this.send('/core/identity/v1/session/refresh', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: token })
      });
      if (!response.ok) throw new SessionError('Your session expired. Sign in again.');
      await this.accept(await response.json(), epoch);
    })();
    this.refreshFlight = flight;
    try { await flight; } finally { if (this.refreshFlight === flight) this.refreshFlight = null; }
  }
  async request(path: string, init: RequestInit = {}) {
    if (!path.startsWith('/core/') || path.startsWith('//')) throw new SessionError('Unsupported account request.');
    if (!this.user) throw new SessionError('Sign in to continue.');
    const epoch = this.epoch;
    try {
      if (Date.now() >= this.expiresAt - 30000) await this.refresh(epoch);
      const token = this.accessToken;
      const headers = new Headers(init.headers);
      headers.set('authorization', 'Bearer ' + token);
      const response = await this.send(path, { ...init, headers });
      if (epoch !== this.epoch) throw new SessionError('Your session changed. Try again.');
      if (response.status === 401) {
        await this.logout(); throw new SessionError('Your session expired. Sign in again.');
      }
      return response;
    } catch (error) {
      if (Date.now() >= this.expiresAt && epoch === this.epoch) await this.logout();
      throw error;
    }
  }
  async logout() {
    ++this.epoch;
    this.refreshFlight = null;
    const token = this.accessToken;
    this.user = null; this.accessToken = null; this.refreshToken = null; this.expiresAt = 0; this.emit();
    const clear = this.persist(() => this.storage.clear());
    const revoke = token ? this.send('/core/identity/v1/session', {
      method: 'DELETE', headers: { authorization: 'Bearer ' + token }
    }).then(response => {
      if (!response.ok) throw new SessionError('Signed out on this device. Server sign-out could not be confirmed.');
    }).catch(() => { throw new SessionError('Signed out on this device. Server sign-out could not be confirmed.'); }) : Promise.resolve();
    const results = await Promise.allSettled([clear, revoke]);
    if (results[0]?.status === 'rejected') throw new SessionError('Secure storage could not be cleared. Try signing out again.');
    if (results[1]?.status === 'rejected') throw results[1].reason;
  }
}
