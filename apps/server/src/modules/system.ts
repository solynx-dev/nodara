import type { FastifyInstance } from 'fastify';
import type { PublicConfig } from '@nodara/shared';
import type { Ctx } from '../context.js';
import { userCount } from './auth.js';
import { VERSION } from '../version.js';

export default async function systemRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await ctx.sql`SELECT 1`;
      return { status: 'ok', version: VERSION, time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'error', database: 'unreachable' });
    }
  });

  app.get('/api/version', async () => ({ version: VERSION, name: 'Nodara', license: 'AGPL-3.0-only' }));

  app.get('/api/config', async (): Promise<PublicConfig> => {
    const s = await ctx.settings.get();
    return {
      instanceName: ctx.config.INSTANCE_NAME,
      version: VERSION,
      registrationPolicy: s.registrationPolicy,
      needsSetup: (await userCount(ctx)) === 0,
      mapStyles: ctx.config.mapStyles,
      geocoding: await ctx.geocoder.enabled(),
      webPushPublicKey: ctx.push.publicKey,
      passkeys: true,
      emailEnabled: ctx.mailer.enabled,
      defaultRetentionDays: s.defaultRetentionDays || null,
      driving: { speedingKmh: ctx.config.DRIVING_SPEEDING_KMH },
    };
  });
}
