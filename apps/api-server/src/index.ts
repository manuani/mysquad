/**
 * API Server — the API server pool (System Architecture §3.7), boot
 * process for the VirtualOffice AI modular monolith.
 *
 * This is not the Edge Gateway from §3.1 (TLS termination, rate limiting,
 * WebRTC signalling negotiation) — that is infrastructure (CDN, load
 * balancer, WAF), populated in `infra/` during Sprint 1.1.3. This app was
 * originally named `api-gateway`, which collided with that term; renamed
 * per verification backlog Issue 2 (see docs/adr/009-rename-api-gateway.md).
 *
 * One Node process runs all service modules. The server:
 *   1. Loads platform config from environment.
 *   2. Initialises shared infrastructure (logger, db clients, event bus).
 *   3. Registers each service module in dependency order.
 *   4. Mounts each module's router at /v1/<module-name>.
 *   5. Exposes /healthz aggregating per-module health.
 *   6. Handles graceful shutdown on SIGTERM/SIGINT.
 *
 * The architecture decision (modular monolith, not microservices) is preserved
 * from System Architecture v1 and confirmed in v2. Phases 1-8 all run inside
 * this single process; deployment scaling happens by running multiple replicas
 * behind a load balancer, not by extracting modules.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { loadConfig } from '@voai/config';
import { createDatabaseClients } from '@voai/db';
import { createLogger } from '@voai/telemetry';
import { createInProcessEventBus } from '@voai/events';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';

import identityAndTenancyModule from '@voai/identity-and-tenancy';
import meetingModule from '@voai/meeting';
import brainModule from '@voai/brain';
import ledgerModule from '@voai/ledger';
import agentRuntimeModule from '@voai/agent-runtime';
import routingModule from '@voai/routing';
import performanceModule from '@voai/performance';
import marketplaceModule from '@voai/marketplace';
import marketplaceMeteringModule from '@voai/marketplace-metering';
import notificationModule from '@voai/notification';
import adminConsoleApiModule from '@voai/admin-console-api';

/**
 * Module boot order. Modules earlier in this list have no upstream dependencies;
 * later modules can call those above them. This is the only place the boot
 * order is defined.
 */
const MODULES: ModuleDefinition[] = [
  // Foundation layer — no module dependencies
  identityAndTenancyModule,
  // Knowledge and decision layer
  brainModule,
  ledgerModule,
  // Routing layer (called by agent-runtime)
  routingModule,
  // Agent layer
  agentRuntimeModule,
  // Real-time meeting layer (depends on agent-runtime)
  meetingModule,
  // Performance layer (subscribes to contribution events)
  performanceModule,
  // Marketplace layer (depends on agent-runtime and performance)
  marketplaceMeteringModule,
  marketplaceModule,
  // Cross-cutting
  notificationModule,
  // Admin (separate authentication, but shares everything else)
  adminConsoleApiModule,
];

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    service: 'api-server',
    bindings: { env: config.env, region: config.region },
  });
  logger.info('platform booting', { moduleCount: MODULES.length });

  const events = createInProcessEventBus();

  const db = createDatabaseClients({
    databaseUrl: config.databaseUrl,
    neo4jUri: config.neo4jUri,
    neo4jUser: config.neo4jUser,
    neo4jPassword: config.neo4jPassword,
    redisUrl: config.redisUrl,
    objectStoreBucket: config.objectStoreBucket,
    objectStoreEndpoint: config.objectStoreEndpoint,
    objectStoreAccessKeyId: config.objectStoreAccessKeyId,
    objectStoreSecretAccessKey: config.objectStoreSecretAccessKey,
    objectStoreRegion: config.objectStoreRegion,
  });

  const ctx: ModuleContext = {
    config,
    logger,
    events,
    db,
  };

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const handles: ModuleHandle[] = [];
  for (const mod of MODULES) {
    const handle = await mod.register(ctx);
    app.use(`/v1/${handle.name}`, handle.router);
    handles.push(handle);
  }

  // Showcase-only demo UI: a thin static page exercising the real
  // identity-and-tenancy/brain/agent-runtime/meeting endpoints from the
  // browser, same-origin (no CORS needed since it's served by this same
  // process). Not the real product UI — Sprint 1.3.1 builds that as
  // React Native. See apps/api-server/public/demo/index.html.
  const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo');
  app.use('/demo', express.static(demoDir));

  app.get('/healthz', async (_req, res) => {
    const results = await Promise.all(
      handles.map(async (h) => ({ module: h.name, ...(await h.health()) })),
    );
    const overall = results.every((r) => r.status === 'healthy') ? 'healthy' : 'degraded';
    res.json({ status: overall, modules: results });
  });

  const server = app.listen(config.port, () => {
    logger.info('platform listening', { port: config.port });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutdown signal received', { signal });
    server.close();
    for (const h of handles.reverse()) {
      try {
        await h.shutdown();
      } catch (err) {
        logger.error('module shutdown failed', { module: h.name, err: String(err) });
      }
    }
    await db.close().catch((err: unknown) => {
      logger.error('database client shutdown failed', { err: String(err) });
    });
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('platform boot failed', err);
  process.exit(1);
});
