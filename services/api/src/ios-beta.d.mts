import type { FastifyInstance } from 'fastify';
export const IOS_BETA_STATUS: Readonly<{ platform: 'ios'; enrollment: 'closed'; collection: 'unverified'; blockers: readonly string[] }>;
export function renderIosBeta(): string;
export function registerIosBetaRoutes(app: FastifyInstance): void;
