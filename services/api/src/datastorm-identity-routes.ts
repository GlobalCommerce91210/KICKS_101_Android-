import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  publicAccount,
  type ConsumerIdentityStore,
} from './consumer-identity.js';

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

const bearer = (authorization?: string) => {
  const [scheme, token] = authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
};

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function registerDataStormIdentityRoutes(
  app: FastifyInstance,
  identityStore: ConsumerIdentityStore,
) {
  const idempotency = new Map<string, {
    fingerprint: string;
    response: Record<string, unknown>;
  }>();

  app.post('/core/identity/v1/account', async (request, reply) => {
    const parsed = accountCreate.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: 'validation_error',
        message: 'Account request failed validation.',
        request_id: request.id,
      });
    }

    const idempotencyKey = String(request.headers['idempotency-key'] ?? '').trim();
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return reply.code(400).send({
        error: 'idempotency_key_required',
        message: 'A valid Idempotency-Key header is required.',
        request_id: request.id,
      });
    }

    const bodyFingerprint = fingerprint(parsed.data);
    const prior = idempotency.get(idempotencyKey);

    if (prior) {
      if (prior.fingerprint !== bodyFingerprint) {
        return reply.code(409).send({
          error: 'idempotency_conflict',
          message: 'The Idempotency-Key was already used with a different request.',
          request_id: request.id,
        });
      }
      return reply.code(201).send(prior.response);
    }

    try {
      const bundle = await identityStore.createAccount(parsed.data);

      const response = {
        account: publicAccount(bundle.account),
        product_access: {
          kicks: bundle.entitlement,
        },
        kicks_profile: bundle.profile,
        permissions: {
          monitoring: 'not_authorized',
          commercial_data: 'not_authorized',
          marketplace: 'not_authorized',
          compensated_opportunities: 'not_authorized',
        },
      };

      idempotency.set(idempotencyKey, {
        fingerprint: bodyFingerprint,
        response,
      });

      return reply.code(201).send(response);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'account_creation_failed';

      if (code === 'account_exists') {
        return reply.code(409).send({
          error: 'account_exists',
          message: 'An account already exists for this email address.',
          request_id: request.id,
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: 'account_creation_failed',
        message: 'The account could not be created.',
        request_id: request.id,
      });
    }
  });

  app.post('/core/identity/v1/session', async (request, reply) => {
    const parsed = sessionCreate.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_credentials',
        message: 'Email and password are required.',
        request_id: request.id,
      });
    }

    const result = await identityStore.authenticate(
      parsed.data.email,
      parsed.data.password,
    );

    if (!result) {
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'Authentication failed.',
        request_id: request.id,
      });
    }

    const entitlement = await identityStore.getKicksEntitlement(
      result.session.subject_id,
    );

    return reply.code(200).send({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      token_type: 'Bearer',
      expires_in: Math.max(
        1,
        Math.floor(
          (Date.parse(result.session.access_expires_at) - Date.now()) / 1000,
        ),
      ),
      subject_id: result.session.subject_id,
      product_access: {
        kicks: entitlement?.status === 'active',
      },
    });
  });

  app.post('/core/identity/v1/session/refresh', async (request, reply) => {
    const parsed = sessionRefresh.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_refresh_token',
        message: 'A valid refresh token is required.',
        request_id: request.id,
      });
    }

    const result = await identityStore.refreshSession(parsed.data.refresh_token);
    if (!result) {
      return reply.code(401).send({
        error: 'invalid_refresh_token',
        message: 'The refresh token is invalid or expired.',
        request_id: request.id,
      });
    }

    return reply.code(200).send({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      token_type: 'Bearer',
      expires_in: Math.max(
        1,
        Math.floor(
          (Date.parse(result.session.access_expires_at) - Date.now()) / 1000,
        ),
      ),
    });
  });

  app.delete('/core/identity/v1/session', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication is required.',
        request_id: request.id,
      });
    }

    await identityStore.revokeSession(token);
    return reply.code(204).send();
  });

  app.get('/core/identity/v1/account', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token
      ? await identityStore.findSessionByAccessToken(token)
      : null;

    if (!session) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication is required.',
        request_id: request.id,
      });
    }

    const account = await identityStore.findAccountBySubjectId(
      session.subject_id,
    );

    if (!account) {
      return reply.code(404).send({
        error: 'account_not_found',
        message: 'Consumer account was not found.',
        request_id: request.id,
      });
    }

    return reply.code(200).send(publicAccount(account));
  });

  app.get('/core/identity/v1/products/kicks', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    const session = token
      ? await identityStore.findSessionByAccessToken(token)
      : null;

    if (!session) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication is required.',
        request_id: request.id,
      });
    }

    const [entitlement, profile] = await Promise.all([
      identityStore.getKicksEntitlement(session.subject_id),
      identityStore.getKicksProfile(session.subject_id),
    ]);

    if (!entitlement || !profile) {
      return reply.code(404).send({
        error: 'kicks_access_not_found',
        message: 'KICK’S access has not been established.',
        request_id: request.id,
      });
    }

    return reply.code(200).send({
      entitlement,
      profile,
    });
  });
}
