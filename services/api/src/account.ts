import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const accountSchema = z.object({
  account_id: z.string().min(1), consumer_id: z.string().min(1),
  display_name: z.string(), email: z.string().email().nullable(),
  account_status: z.enum(['active', 'restricted', 'pending', 'closed']),
  profile_status: z.string()
}).strict();
export type ConsumerAccount = z.infer<typeof accountSchema>;
export type AccountSession = { token: string; expires_at: string; account: ConsumerAccount };
export type AccountResource = 'consumer-state' | 'snapshot' | 'devices' | 'permissions' | 'consent' | 'monitoring' | 'wallet';
export type ConsumerResource = { consumer_id: string; [key: string]: unknown };

/** Implement in the canonical DataStorm identity service. Never resolve collector tokens here. */
export interface DataStormAccountProvider {
  authenticate(mode: 'login' | 'create', credentials: { email: string; password: string }): Promise<AccountSession>;
  restore(token: string): Promise<AccountSession | null>;
  logout(token: string): Promise<void>;
  recover(email: string): Promise<void>;
  resource(session: AccountSession, resource: AccountResource): Promise<ConsumerResource>;
  controls(session: AccountSession): Promise<Record<string, string>>;
}
export class AccountProviderError extends Error {
  constructor(public status: 401 | 403 | 409 | 429 | 503, public code: string) { super(code); }
}
const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) }).strict();
const sessionSchema = z.object({ token: z.string().min(20).max(8192).regex(/^\S+$/), expires_at: z.string().datetime(), account: accountSchema }).strict();
const COOKIE = '__Host-datastorm_session';
const resourcePaths: Record<AccountResource, string> = {
  'consumer-state': '/v1/me/consumer-state', snapshot: '/core/consumer/v1/snapshot',
  devices: '/core/consumer/v1/devices', permissions: '/v1/me/permissions', consent: '/v1/me/consent',
  monitoring: '/v1/me/monitoring', wallet: '/v1/me/wallet'
};
const consumerResource = z.object({ consumer_id: z.string().min(1) });
const resourceSchemas = {
  'consumer-state': consumerResource.extend({ profile_status: z.string() }).passthrough(),
  snapshot: consumerResource.extend({ membership_status: z.string() }).passthrough(),
  devices: consumerResource.extend({ devices: z.array(z.object({ device_id: z.string(), label: z.string(), status: z.string() })) }).passthrough(),
  permissions: consumerResource.extend({ active_count: z.number().int().nonnegative(), revoked_count: z.number().int().nonnegative() }).passthrough(),
  consent: consumerResource.extend({ active_count: z.number().int().nonnegative(), revoked_count: z.number().int().nonnegative() }).passthrough(),
  monitoring: consumerResource.extend({ status: z.enum(['off', 'active', 'pending', 'unavailable']) }).passthrough(),
  wallet: consumerResource.extend({ currency: z.string(), available_balance: z.number().finite(), pending_balance: z.number().finite() }).passthrough()
};

export function registerAccountRoutes(app: FastifyInstance, provider?: DataStormAccountProvider) {
  const requireProvider = () => {
    if (!provider) throw new AccountProviderError(503, 'datastorm_account_provider_required');
    return provider;
  };
  const validate = (session: AccountSession) => {
    const parsed = sessionSchema.safeParse(session);
    if (!parsed.success) throw new AccountProviderError(503, 'invalid_account_provider_response');
    if (Date.parse(parsed.data.expires_at) <= Date.now()) throw new AccountProviderError(401, 'session_expired');
    if (parsed.data.account.account_status === 'closed') throw new AccountProviderError(403, 'account_closed');
    return parsed.data;
  };
  const tokenFor = (req: FastifyRequest) => {
    if (req.headers.authorization) return /^Bearer (\S+)$/.exec(req.headers.authorization)?.[1];
    const raw = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    try { return raw ? decodeURIComponent(raw) : undefined; } catch { return undefined; }
  };
  const resolveSession = async (req: FastifyRequest) => {
    const p = requireProvider(), token = tokenFor(req);
    if (!token) throw new AccountProviderError(401, 'authentication_required');
    const restored = await p.restore(token);
    if (!restored) throw new AccountProviderError(401, 'session_expired');
    return validate(restored);
  };
  app.register(async scoped => {
    const attempts = new Map<string, { count: number; until: number }>();
    scoped.setErrorHandler((error, _req, reply) => {
      if (error instanceof AccountProviderError) return reply.code(error.status).send({ error: error.code });
      return reply.code(503).send({ error: 'account_service_unavailable' });
    });
    scoped.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/core/identity/v1/session/') && req.method === 'POST') {
        const now = Date.now();
        for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
        const entry = attempts.get(req.ip) ?? { count: 0, until: now + 60_000 };
        if (entry.count >= 10 || (!attempts.has(req.ip) && attempts.size >= 5000)) return reply.code(429).send({ error: 'try_again_later' });
        entry.count++; attempts.set(req.ip, entry);
      }
      // Browser mutations must be same-origin. Native requests carry a bearer token and no Origin.
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        const configured = process.env.DATASTORM_ACCOUNT_WEB_ORIGIN;
        const expected = configured || `https://${req.headers.host}`;
        if (req.headers.origin !== expected) return reply.code(403).send({ error: 'invalid_origin' });
      }
    });
    for (const mode of ['login', 'create'] as const) {
      scoped.post(`/core/identity/v1/session/${mode}`, async (req, reply) => {
        const parsed = credentials.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
        const session = validate(await requireProvider().authenticate(mode, parsed.data));
        const cookieClient = req.headers['x-datastorm-client'] === 'web';
        if (cookieClient) reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(session.token)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000))}`);
        return { account: session.account, expires_at: session.expires_at, ...(cookieClient ? {} : { token: session.token }) };
      });
    }
    scoped.post('/core/identity/v1/session/recovery', async (req, reply) => {
      const parsed = z.object({ email: z.string().email().max(254) }).strict().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try { await requireProvider().recover(parsed.data.email); }
      catch (error) { if (!(error instanceof AccountProviderError) || error.status === 429 || error.status === 503) throw error; }
      return reply.code(202).send({ message: 'If this address is eligible, recovery instructions will be sent.' });
    });
    scoped.get('/core/identity/v1/account', async req => {
      const session = await resolveSession(req);
      return { account: session.account, expires_at: session.expires_at };
    });
    scoped.post('/core/identity/v1/session/logout', async (req, reply) => {
      reply.header('set-cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      const p = requireProvider(), token = tokenFor(req);
      if (token) await p.logout(token);
      return reply.code(204).send();
    });
    for (const [resource, path] of Object.entries(resourcePaths)) {
      scoped.get(path, async req => {
        if (Object.keys(req.query as object).length) throw new AccountProviderError(403, 'client_identity_override_forbidden');
        const session = await resolveSession(req);
        const result = await requireProvider().resource(session, resource as AccountResource);
        if (!result || result.consumer_id !== session.account.consumer_id) throw new AccountProviderError(503, 'consumer_identity_mismatch');
        const parsed = resourceSchemas[resource as AccountResource].safeParse(result);
        if (!parsed.success) throw new AccountProviderError(503, 'invalid_consumer_resource');
        return parsed.data;
      });
    }
    scoped.get('/core/identity/v1/controls', async req => {
      const session = await resolveSession(req);
      const controls = await requireProvider().controls(session);
      const allowed = ['security', 'devices', 'consent', 'export', 'close', 'privacy', 'terms'];
      const safe: Record<string, string> = {};
      for (const key of allowed) {
        if (!controls[key]) continue;
        const url = new URL(controls[key]);
        if (url.protocol !== 'https:' || url.username || url.password) throw new AccountProviderError(503, 'invalid_account_control_url');
        safe[key] = url.href;
      }
      return { consumer_id: session.account.consumer_id, controls: safe };
    });
  });
}
