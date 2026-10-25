import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ComplianceEngine } from './compliance.js';
import type { ConsumerIdentityStore } from './consumer-identity.js';
import type { ConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import type { PermissionsEngine } from './permissions.js';
import type { Store } from './store.js';
import type { WalletEngine } from './wallet.js';

export interface KicksConsumerRouteDependencies {
  identityStore: ConsumerIdentityStore;
  deviceBindingStore: ConsumerDeviceBindingStore;
  store: Store;
  permissionsEngine: PermissionsEngine;
  walletEngine: WalletEngine;
  complianceEngine: ComplianceEngine;
}

const bearer = (authorization?: string) => {
  const [scheme, token] = authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
};

const dollarsToMinor = (value: number) =>
  Math.max(0, Math.round(value * 100));

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const deviceBindInput = z.object({
  device_id: z.string().min(1).max(256),
  device_binding_token: z.string().min(16).max(4096),
  display_name: z.string().max(128).nullable().optional(),
  platform: z.enum(['android', 'ios', 'web', 'other']).default('android'),
  app_version: z.string().max(64).nullable().optional(),
}).strict();

export function registerKicksConsumerRoutes(
  app: FastifyInstance,
  dependencies: KicksConsumerRouteDependencies,
) {
  const {
    identityStore,
    deviceBindingStore,
    store,
    permissionsEngine,
    walletEngine,
    complianceEngine,
  } = dependencies;

  const authenticateConsumer = async (authorization?: string) => {
    const token = bearer(authorization);
    if (!token) return null;

    const session = await identityStore.findSessionByAccessToken(token);
    if (!session) return null;

    const entitlement = await identityStore.getKicksEntitlement(
      session.subject_id,
    );

    if (!entitlement || entitlement.status !== 'active') return null;

    const profile = await identityStore.getKicksProfile(session.subject_id);
    if (!profile || profile.status !== 'active') return null;

    return {
      subjectId: session.subject_id,
      entitlement,
      profile,
    };
  };

  const buildSnapshot = async (subjectId: string) => {
    const generatedAt = new Date().toISOString();

    const bindings = await deviceBindingStore.list(subjectId);
    const collectorResults = await Promise.all(
      bindings.map(async binding => {
        try {
          const snapshot = await store.engineSnapshot(
            binding.device_id,
            binding.collector_subject_id,
            100,
          );
          return { binding, snapshot, available: true as const };
        } catch {
          return { binding, snapshot: null, available: false as const };
        }
      }),
    );

    const availableCollectorResults = collectorResults.filter(
      result => result.available && result.snapshot,
    );

    const observedApps = new Set<string>();
    const observedDestinations = new Set<string>();
    let reviewItems = 0;
    let lastObservationAt: string | null = null;

    for (const result of availableCollectorResults) {
      const snapshot = result.snapshot!;
      for (const observation of snapshot.observations) {
        if (observation.sourceApp) observedApps.add(observation.sourceApp);
        observedDestinations.add(observation.destinationHost);
        if (
          observation.reviewStatus === 'flagged' ||
          observation.classification === 'review'
        ) {
          reviewItems += 1;
        }
      }

      if (
        snapshot.lastObservationAt &&
        (!lastObservationAt ||
          Date.parse(snapshot.lastObservationAt) > Date.parse(lastObservationAt))
      ) {
        lastObservationAt = snapshot.lastObservationAt;
      }
    }

    const collectorStates = availableCollectorResults.map(
      result => result.snapshot!.stability.collectorState,
    );

    const monitoringStatus =
      bindings.length === 0
        ? 'inactive'
        : collectorStates.includes('active')
          ? 'active'
          : collectorStates.includes('paused')
            ? 'paused'
            : availableCollectorResults.length > 0
              ? 'inactive'
              : 'unavailable';

    const healthyDevices = availableCollectorResults.filter(
      result => result.snapshot!.stability.collectorState === 'active',
    ).length;

    const degradedDevices = availableCollectorResults.filter(
      result => result.snapshot!.stability.collectorState === 'paused',
    ).length;

    const offlineDevices = Math.max(
      0,
      bindings.length - healthyDevices - degradedDevices,
    );

    const account = await identityStore.findAccountBySubjectId(subjectId);
    const entitlement = await identityStore.getKicksEntitlement(subjectId);
    const profile = await identityStore.getKicksProfile(subjectId);

    const permissions = permissionsEngine.getEffectivePermissions(subjectId);
    const wallet = walletEngine.getSummary(subjectId);

    const activePermissions =
      permissions.apps.filter(item => item.state === 'allowed').length +
      permissions.metadata_permissions.filter(item => item.state === 'allowed').length +
      permissions.buyers.filter(item => item.state === 'allowed').length;

    const blockedPermissions =
      permissions.apps.filter(item => item.state === 'blocked').length +
      permissions.metadata_permissions.filter(item => item.state === 'blocked').length +
      permissions.buyers.filter(item => item.state === 'blocked').length;

    const complianceDecisions = complianceEngine
      .listDecisions()
      .filter(decision => decision.actor_id === subjectId);

    const unresolvedCompliance = complianceDecisions.filter(
      decision =>
        decision.outcome === 'deny' ||
        decision.outcome === 'allow_with_conditions',
    ).length;

    const attention: Array<{
      type: string;
      count: number;
      severity: 'info' | 'action' | 'important';
      title: string;
      destination: string;
      source: string;
    }> = [];

    if (!account?.email_verified) {
      attention.push({
        type: 'email_verification_required',
        count: 1,
        severity: 'action',
        title: 'Verify your email address',
        destination: '/account',
        source: 'identity',
      });
    }

    if (unresolvedCompliance > 0) {
      attention.push({
        type: 'compliance_action_required',
        count: unresolvedCompliance,
        severity: 'important',
        title: 'Review account requirements',
        destination: '/privacy',
        source: 'compliance',
      });
    }

    return {
      generated_at: generatedAt,
      snapshot_status: 'partial',

      consumer: {
        subject_id: subjectId,
        account_status: account?.account_status ?? 'pending_verification',
        profile_id: profile?.profile_id ?? null,
        product: 'kicks',
        product_access: entitlement?.status ?? 'revoked',
      },

      monitoring: {
        status: monitoringStatus,
        apps_observed: observedApps.size,
        destinations_observed_24h: observedDestinations.size,
        items_needing_review: reviewItems,
        as_of: lastObservationAt,
        source_status:
          bindings.length === 0
            ? 'not_configured'
            : availableCollectorResults.length === bindings.length
              ? 'available'
              : availableCollectorResults.length > 0
                ? 'stale'
                : 'unavailable',
      },

      permissions: {
        active: activePermissions,
        revoked: blockedPermissions,
        expiring_soon: 0,
        as_of: generatedAt,
        source_status: 'available',
      },

      value: {
        estimated_value_minor: null,
        currency: 'USD',
        status: 'unavailable',
        disclaimer: 'Estimated value is not a guaranteed payout.',
        as_of: null,
        source_status: 'not_configured',
      },

      wallet: {
        available_minor: dollarsToMinor(wallet.total_earned),
        pending_minor: dollarsToMinor(wallet.total_pending),
        lifetime_earned_minor: dollarsToMinor(
          wallet.total_earned + wallet.total_settled,
        ),
        currency: 'USD',
        as_of: generatedAt,
        source_status: 'available',
      },

      opportunities: {
        active: 0,
        accepted: 0,
        expiring_soon: 0,
        as_of: null,
        source_status: 'not_configured',
      },

      devices: {
        connected: bindings.length,
        healthy: healthyDevices,
        degraded: degradedDevices,
        offline: offlineDevices,
        as_of: lastObservationAt,
        source_status:
          bindings.length === 0
            ? 'not_configured'
            : availableCollectorResults.length > 0
              ? 'available'
              : 'unavailable',
      },

      compliance: {
        participation_status:
          unresolvedCompliance > 0 ? 'action_required' : 'unknown',
        unresolved_actions: unresolvedCompliance,
        as_of:
          complianceDecisions.at(-1)?.evaluated_at ?? null,
        source_status: 'available',
      },

      attention,

      sources: {
        identity: {
          status: account ? 'available' : 'unavailable',
          as_of: account?.updated_at ?? null,
        },
        permissions: {
          status: 'available',
          as_of: generatedAt,
        },
        wallet: {
          status: 'available',
          as_of: generatedAt,
        },
        compliance: {
          status: 'available',
          as_of: complianceDecisions.at(-1)?.evaluated_at ?? null,
        },
        collector: {
          status:
            bindings.length === 0
              ? 'not_configured'
              : availableCollectorResults.length === bindings.length
                ? 'available'
                : availableCollectorResults.length > 0
                  ? 'stale'
                  : 'unavailable',
          as_of: lastObservationAt,
          message:
            bindings.length === 0
              ? 'No KICK’S device is currently bound to this DataStorm account.'
              : null,
        },
        inverse_growth: {
          status: 'not_configured',
          as_of: null,
        },
        inverse_pricing: {
          status: 'not_configured',
          as_of: null,
        },
        marketplace: {
          status: 'not_configured',
          as_of: null,
        },
      },
    };
  };

  app.get('/core/consumer/v1/devices', async (request, reply) => {
    const consumer = await authenticateConsumer(request.headers.authorization);

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    const bindings = await deviceBindingStore.list(consumer.subjectId);

    const devices = await Promise.all(
      bindings.map(async binding => {
        try {
          const snapshot = await store.engineSnapshot(
            binding.device_id,
            binding.collector_subject_id,
            1,
          );

          return {
            ...binding,
            collector_status:
              snapshot.stability.collectorState === 'active'
                ? 'healthy'
                : snapshot.stability.collectorState === 'paused'
                  ? 'degraded'
                  : 'offline',
            monitoring_status:
              snapshot.stability.collectorState === 'active'
                ? 'active'
                : snapshot.stability.collectorState === 'paused'
                  ? 'paused'
                  : 'inactive',
            last_seen_at: snapshot.lastObservationAt,
          };
        } catch {
          return {
            ...binding,
            collector_status: 'unknown',
            monitoring_status: 'unavailable',
            last_seen_at: null,
          };
        }
      }),
    );

    return reply.code(200).send({ devices });
  });

  app.post('/core/consumer/v1/devices', async (request, reply) => {
    const consumer = await authenticateConsumer(request.headers.authorization);

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    const parsed = deviceBindInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: 'validation_error',
        message: 'Device binding request failed validation.',
        request_id: request.id,
      });
    }

    const collectorDevice = await store.findDeviceByTokenHash(
      sha256(parsed.data.device_binding_token),
    );

    if (!collectorDevice || collectorDevice.id !== parsed.data.device_id) {
      return reply.code(403).send({
        error: 'device_binding_denied',
        message: 'The supplied device proof does not match this device.',
        request_id: request.id,
      });
    }

    const binding = await deviceBindingStore.bind({
      subjectId: consumer.subjectId,
      deviceId: collectorDevice.id,
      collectorSubjectId: collectorDevice.subjectId,
      displayName: parsed.data.display_name,
      platform: parsed.data.platform,
      appVersion: parsed.data.app_version,
    });

    return reply.code(201).send(binding);
  });

  app.delete('/core/consumer/v1/devices/:deviceId', async (request, reply) => {
    const consumer = await authenticateConsumer(request.headers.authorization);

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    const { deviceId } = request.params as { deviceId: string };
    const revoked = await deviceBindingStore.revoke(
      consumer.subjectId,
      deviceId,
    );

    if (!revoked) {
      return reply.code(404).send({
        error: 'device_binding_not_found',
        message: 'The device binding was not found.',
        request_id: request.id,
      });
    }

    return reply.code(204).send();
  });

  app.get('/core/consumer/v1/profile', async (request, reply) => {
    const consumer = await authenticateConsumer(
      request.headers.authorization,
    );

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    const account = await identityStore.findAccountBySubjectId(
      consumer.subjectId,
    );

    return reply.code(200).send({
      account: account
        ? {
            subject_id: account.subject_id,
            email: account.email,
            email_verified: account.email_verified,
            account_status: account.account_status,
            region: account.region,
          }
        : null,
      entitlement: consumer.entitlement,
      profile: consumer.profile,
    });
  });

  app.get('/core/consumer/v1/snapshot', async (request, reply) => {
    const consumer = await authenticateConsumer(
      request.headers.authorization,
    );

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    return reply.code(200).send(
      await buildSnapshot(consumer.subjectId),
    );
  });

  app.post('/core/consumer/v1/snapshot/refresh', async (request, reply) => {
    const consumer = await authenticateConsumer(
      request.headers.authorization,
    );

    if (!consumer) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid DataStorm account with KICK’S access is required.',
        request_id: request.id,
      });
    }

    return reply.code(200).send(
      await buildSnapshot(consumer.subjectId),
    );
  });
}
