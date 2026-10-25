import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import type { IosDeviceProvisioner } from './ios-device-provisioning.js';
import type { ConsentRepository } from './consent-repository.js';

// This adapter requires a server-verified consumer session. Never accept an
// account subject from the request body or use a collector token as an account token.
export interface IosAccountSessionResolver {
  resolve(authorization: string | undefined): Promise<string | null>;
}
const enrollment = z.object({
  requestId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(32),
  publicKey: z.string().min(16)
}).strict();
const consentDecision = z.object({
  permissionId: z.string().uuid(),
  requestId: z.string().uuid(),
  expectedEventSequence: z.number().int().nonnegative().optional(),
  action: z.enum(['grant', 'deny', 'revoke']),
  policyVersion: z.string().min(1),
  purposeVersion: z.string().min(1),
  purpose: z.string().min(3)
}).strict();

export function registerIosAccountCompatibilityRoutes(app: FastifyInstance, deps: {
  sessions: IosAccountSessionResolver;
  bindings: ConsumerDeviceBindingStore;
  provisioner: IosDeviceProvisioner;
  consent: ConsentRepository;
}) {
  const subject = async (authorization: string | undefined) => deps.sessions.resolve(authorization);
  app.get('/core/consumer/v1/devices', async (request, reply) => {
    let account: string | null;
    try { account = await subject(request.headers.authorization); }
    catch { return reply.code(503).send({ error: 'identity_unavailable' }); }
    if (!account) return reply.code(401).send({ error: 'unauthorized' });
    try { return { devices: await deps.bindings.list(account) }; }
    catch { return reply.code(503).send({ error: 'device_bindings_unavailable' }); }
  });
  app.post('/core/consumer/v1/ios/devices/provision', async (request, reply) => {
    let account: string | null;
    try { account = await subject(request.headers.authorization); }
    catch { return reply.code(503).send({ error: 'identity_unavailable' }); }
    if (!account) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = enrollment.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await deps.provisioner.provision({ ...parsed.data, accountSubjectId: account });
      return reply.code(result.status === 'replayed' ? 200 : 201).send({ ...result, monitoringDefaultOn: false });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'provisioning_conflict' || code === 'device_already_linked') return reply.code(409).send({ error: 'device_conflict' });
      if (code === 'ios_device_limit') return reply.code(409).send({ error: 'ios_device_limit' });
      request.log.error({ err: error }, 'iOS provisioning unavailable');
      return reply.code(503).send({ error: 'provisioning_unavailable' });
    }
  });
  app.get('/core/consumer/v1/consent/:permissionId', async (request, reply) => {
    let account: string | null;
    try { account = await subject(request.headers.authorization); }
    catch { return reply.code(503).send({ error: 'identity_unavailable' }); }
    if (!account) return reply.code(401).send({ error: 'unauthorized' });
    const params = z.object({ permissionId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const history = await deps.consent.getHistory(params.data.permissionId, account);
      return { events: history };
    } catch { return reply.code(503).send({ error: 'consent_unavailable' }); }
  });
  app.post('/core/consumer/v1/consent', async (request, reply) => {
    let account: string | null;
    try { account = await subject(request.headers.authorization); }
    catch { return reply.code(503).send({ error: 'identity_unavailable' }); }
    if (!account) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = consentDecision.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try { return reply.code(201).send({ event: await deps.consent.recordDecision({ ...parsed.data, subjectId: account }) }); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'CONSENT_OWNER_MISMATCH' || code === 'CONSENT_STALE_DECISION' || code === 'IDEMPOTENCY_CONFLICT') return reply.code(409).send({ error: 'consent_conflict' });
      return reply.code(503).send({ error: 'consent_unavailable' });
    }
  });
}
