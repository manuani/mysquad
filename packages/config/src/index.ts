/**
 * Environment-driven configuration loader.
 *
 * One source of truth for environment variables. Modules never read process.env
 * directly — they receive their slice of config through the ModuleContext.
 *
 * Adding a new config key:
 *   1. Add it to PlatformConfigSchema below.
 *   2. Document the required env var in .env.example.
 *   3. Update infra/terraform if it must be set in staging/production.
 */

import { z } from 'zod';

const PlatformConfigSchema = z.object({
  env: z.enum(['development', 'staging', 'production', 'test']),
  region: z.string().min(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  port: z.coerce.number().int().positive().default(3000),

  // Database
  databaseUrl: z.string().url(),
  neo4jUri: z.string().min(1),
  neo4jUser: z.string().min(1),
  neo4jPassword: z.string().min(1),
  redisUrl: z.string().url(),

  // Identity (Sprint 1.2)
  workosApiKey: z.string().optional(),
  workosClientId: z.string().optional(),

  // Routing (Sprint 2.1.2 / 5.1)
  anthropicApiKey: z.string().optional(),

  // Real-time (Sprint 2.2)
  livekitUrl: z.string().optional(),
  livekitApiKey: z.string().optional(),
  livekitApiSecret: z.string().optional(),

  // Marketplace metering (Sprint 6.1)
  stripeSecretKey: z.string().optional(),
});

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const parsed = PlatformConfigSchema.safeParse({
    env: env.NODE_ENV,
    region: env.AWS_REGION ?? env.GCP_REGION ?? 'local',
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    neo4jUri: env.NEO4J_URI,
    neo4jUser: env.NEO4J_USER,
    neo4jPassword: env.NEO4J_PASSWORD,
    redisUrl: env.REDIS_URL,
    workosApiKey: env.WORKOS_API_KEY,
    workosClientId: env.WORKOS_CLIENT_ID,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    livekitUrl: env.LIVEKIT_URL,
    livekitApiKey: env.LIVEKIT_API_KEY,
    livekitApiSecret: env.LIVEKIT_API_SECRET,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
