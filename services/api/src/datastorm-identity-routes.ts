import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  publicAccount,
  type ConsumerIdentityStore,
  type IdentityTokenKind,
  type SessionBundle,
} from './consumer-identity.js';
import { createAccountIdempotencyStore } from './identity-idempotency.js';

const accountCreate = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(128),
  region: z.string().max(64).nullable().optional(),
  marketing_opt_in: z.boolean().default(false),
  terms_version: z.string().min(1).max(64),
  privacy_version: z.string().min(1).max(64),
  metadata: z.object({
    locale: z.string().max(32).optional(),
    timezone: z.string().max(64).optional(),
    referral_code: z.string().max(64).optional(),
  }).strict().optional(),
}).strict();

const sessionCreate = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
}).strict();

const sessionRefresh = z.object({
  refresh_token: z.string().min(16).max(4096),
}).strict();

const tokenConfirm = z.object({ token: z.string().min(16).max(4096) }).strict();
const resetRequest = z.object({ email: z.string().email().max(320) }).strict();
const resetConfirm = z.object({
  token: z.string().min(16).max(4096),
  new_password: z.string().min(12).max(128),
}).strict();
const mfaChange = z.object({ enabled: z.boolean() }).strict();

export interface IdentityTokenDelivery {
  subject_id: string;
  email: string;
  kind: IdentityTokenKind;
  token: string;
}

export type IdentityTokenNotifier = (delivery: IdentityTokenDelivery) => Promise<void> | void;

const bearer = (authorization?: string) => {
  const [scheme, token] = authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
};

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const sessionResponse = async (identityStore: ConsumerIdentityStore, result: SessionBundle) => {
  const entitlement = await identityStore.getKicksEntitlement(result.session.subject_id);
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((Date.parse(result.session.access_expires_at) - Date.now()) / 1000)),
    subject_id: result.session.subject_id,
    product_access: { kicks: entitlement?.status === 'active' },
  };
};

export function registerDataStormIdentityRoutes(
  app: FastifyInstance,
  identityStore: ConsumerIdentityStore,
  notifyToken?: IdentityTokenNotifier,
) {
  const idempotency = createAccountIdempotencyStore();
  app.addHook('onClose', async () => idempotency.close());

  const deliver = async (subjectId: string, email: string, kind: IdentityTokenKind, ttlMs: number) => {
    const raw = await identityStore.issueIdentityToken(subjectId, kind, ttlMs);
    if (raw && notifyToken) await notifyToken({ subject_id: subjectId, email, kind, token: raw });
    return raw;
  };

  const testToken = (raw: string | null) => process.env.NODE_ENV === 'test' && raw ? { debug_token: raw } : {};

  const accountResponse = async (subjectId: string, verificationToken: string | null = null) => {
    const [account, entitlement, profile] = await Promise.all([
      identityStore.findAccountBySubjectId(subjectId),
      identityStore.getKicksEntitlement(subjectId),
      identityStore.getKicksProfile(subjectId),
    ]);
    if (!account || !entitlement || !profile) return null;
    return {
      account: publicAccount(account),
      product_access: { kicks: entitlement },
      kicks_profile: profile,
      permissions: {
        monitoring: 'not_authorized',
        commercial_data: 'not_authorized',
        marketplace: 'not_authorized',
        compensated_opportunities: 'not_authorized',
      },
      email_verification: {
        required: !account.email_verified,
        delivery: 'email',
        ...testToken(verificationToken),
      },
    };
  };

  app.post('/core/identity/v1/account', async (request, reply) => {
    const parsed = accountCreate.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: 'validation_error', message: 'Account request failed validation.', request_id: request.id });
    }

    const idempotencyKey = String(request.headers['idempotency-key'] ?? '').trim();
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: 'idempotency_key_required', message: 'A valid Idempotency-Key header is required.', request_id: request.id });
    }

    const bodyFingerprint = fingerprint(parsed.data);
    const prior = await idempotency.find(idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== bodyFingerprint) {
        return reply.code(409).send({ error: 'idempotency_conflict', message: 'The Idempotency-Key was already used with a different request.', request_id: request.id });
      }
      const response = await accountResponse(prior.subject_id);
      if (!response) {
        return reply.code(409).send({ error: 'idempotency_state_invalid', message: 'The prior account result is unavailable.', request_id: request.id });
      }
      return reply.code(201).send(response);
    }

    try {
      const bundle = await identityStore.createAccount(parsed.data);
      const verificationToken = await deliver(bundle.account.subject_id, bundle.account.email, 'email_verification', 24 * 60 * 60 * 1000);
      await idempotency.save(idempotencyKey, { fingerprint: bodyFingerprint, subject_id: bundle.account.subject_id });
      const response = await accountResponse(bundle.account.subject_id, verificationToken);
      if (!response) throw new Error('account_creation_failed');
      return reply.code(201).send(response);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'account_creation_failed';
      if (code === 'account_exists') {
        return reply.code(409).send({ error: 'account_exists', message: 'An account already exists for this email address.', request_id: request.id });
      }
      if (code === 'idempotency_conflict') {
        return reply.code(409).send({ error: 'idempotency_conflict', message: 'The Idempotency-Key conflicts with a prior request.', request_id: request.id });
      }
      request.log.error(error);
      return reply.code(500).send({ error: 'account_creation_failed', message: 'The account could not be created.', request_id: request.id });
    }
  });

  app.post('/core/identity/v1/email-verification/request', async (request, reply) => {
    const parsed = resetRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const account = await identityStore.findAccountByEmail(parsed.data.email);
    const raw = account && account.account_status !== 'closed'
      ? await deliver(account.subject_id, account.email, 'email_verification', 24 * 60 * 60 * 1000)
      : null;
    return reply.code(202).send({ accepted: true, ...testToken(raw) });
  });

  app.post('/core/identity/v1/email-verification/confirm', async (request, reply) => {
    const parsed = tokenConfirm.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const record = await identityStore.consumeIdentityToken(parsed.data.token, 'email_verification');
    if (!record) return reply.code(400).send({ error: 'invalid_or_expired_token', request_id: request.id });
    const account = await identityStore.verifyEmail(record.subject_id);
    if (!account) return reply.code(400).send({ error: 'invalid_or_expired_token', request_id: request.id });
    return reply.code(200).send({ account: publicAccount(account) });
  });

  app.post('/core/identity/v1/password-reset/request', async (request, reply) => {
    const parsed = resetRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const account = await identityStore.findAccountByEmail(parsed.data.email);
    const raw = account && account.account_status !== 'closed'
      ? await deliver(account.subject_id, account.email, 'password_reset', 30 * 60 * 1000)
      : null;
    return reply.code(202).send({ accepted: true, ...testToken(raw) });
  });

  app.post('/core/identity/v1/password-reset/confirm', async (request, reply) => {
    const parsed = resetConfirm.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const record = await identityStore.consumeIdentityToken(parsed.data.token, 'password_reset');
    if (!record) return reply.code(400).send({ error: 'invalid_or_expired_token', request_id: request.id });
    const updated = await identityStore.updatePassword(record.subject_id, parsed.data.new_password);
    if (!updated) return reply.code(400).send({ error: 'password_reset_failed', request_id: request.id });
    return reply.code(204).send();
  });

  app.post('/core/identity/v1/session', async (request, reply) => {
    const parsed = sessionCreate.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_credentials', message: 'Email and password are required.', request_id: request.id });
    }

    const result = await identityStore.authenticate(parsed.data.email, parsed.data.password);
    if (!result) return reply.code(401).send({ error: 'invalid_credentials', message: 'Authentication failed.', request_id: request.id });

    const account = await identityStore.findAccountBySubjectId(result.session.subject_id);
    if (account?.mfa_enabled) {
      await identityStore.revokeSession(result.access_token);
      const challenge = await deliver(account.subject_id, account.email, 'mfa_challenge', 10 * 60 * 1000);
      if (!challenge) return reply.code(503).send({ error: 'mfa_unavailable', request_id: request.id });
      return reply.code(202).send({ mfa_required: true, delivery: 'email', ...testToken(challenge) });
    }

    return reply.code(200).send(await sessionResponse(identityStore, result));
  });

  app.post('/core/identity/v1/session/mfa', async (request, reply) => {
    const parsed = tokenConfirm.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const record = await identityStore.consumeIdentityToken(parsed.data.token, 'mfa_challenge');
    if (!record) return reply.code(401).send({ error: 'invalid_or_expired_mfa', request_id: request.id });
    const result = await identityStore.issueSessionForSubject(record.subject_id);
    if (!result) return reply.code(401).send({ error: 'account_unavailable', request_id: request.id });
    return reply.code(200).send(await sessionResponse(identityStore, result));
  });

  app.post('/core/identity/v1/session/refresh', async (request, reply) => {
    const parsed = sessionRefresh.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_refresh_token', message: 'A valid refresh token is required.', request_id: request.id });
    const result = await identityStore.refreshSession(parsed.data.refresh_token);
    if (!result) return reply.code(401).send({ error: 'invalid_refresh_token', message: 'The refresh token is invalid, expired, or the account is unavailable.', request_id: request.id });
    return reply.code(200).send(await sessionResponse(identityStore, result));
  });

  app.delete('/core/identity/v1/session', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: 'unauthorized', message: 'Authentication is required.', request_id: request.id });
    await identityStore.revokeSession(token);
    return reply.code(204).send();
  });

  app.put('/core/identity/v1/mfa', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? await identityStore.findSessionByAccessToken(token) : null;
    if (!session) return reply.code(401).send({ error: 'unauthorized', request_id: request.id });
    const parsed = mfaChange.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation_error', request_id: request.id });
    const updated = await identityStore.setMfaEnabled(session.subject_id, parsed.data.enabled);
    if (!updated) return reply.code(409).send({ error: 'mfa_update_failed', request_id: request.id });
    return reply.code(200).send({ mfa_enabled: parsed.data.enabled, strategy: 'email_one_time_challenge' });
  });

  app.get('/core/identity/v1/account', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? await identityStore.findSessionByAccessToken(token) : null;
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Authentication is required.', request_id: request.id });
    const account = await identityStore.findAccountBySubjectId(session.subject_id);
    if (!account) return reply.code(404).send({ error: 'account_not_found', message: 'Consumer account was not found.', request_id: request.id });
    return reply.code(200).send(publicAccount(account));
  });

  app.delete('/core/identity/v1/account', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? await identityStore.findSessionByAccessToken(token) : null;
    if (!session) return reply.code(401).send({ error: 'unauthorized', request_id: request.id });
    const closed = await identityStore.closeAccount(session.subject_id);
    if (!closed) return reply.code(404).send({ error: 'account_not_found', request_id: request.id });
    return reply.code(200).send({
      account_status: 'closed',
      data_consequences: {
        identity_pii: 'anonymized',
        active_sessions: 'revoked',
        kicks_entitlement: 'revoked',
        kicks_profile: 'suspended',
        collector_history: 'preserved',
        collector_subject_identity: 'unchanged',
        monitoring_consent: 'not_inferred_or_deleted',
      },
    });
  });

  app.get('/core/identity/v1/products/kicks', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token ? await identityStore.findSessionByAccessToken(token) : null;
    if (!session) return reply.code(401).send({ error: 'unauthorized', message: 'Authentication is required.', request_id: request.id });
    const [entitlement, profile] = await Promise.all([
      identityStore.getKicksEntitlement(session.subject_id),
      identityStore.getKicksProfile(session.subject_id),
    ]);
    if (!entitlement || !profile) return reply.code(404).send({ error: 'kicks_access_not_found', message: 'KICK’S access has not been established.', request_id: request.id });
    return reply.code(200).send({ entitlement, profile });
  });
}
