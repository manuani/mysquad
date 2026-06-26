/**
 * API Gateway — boot process for the VirtualOffice AI modular monolith.
 *
 * One Node process runs all service modules. The gateway:
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

import express from 'express';
import { loadConfig } from '@voai/config';
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
    service: 'api-gateway',
    bindings: { env: config.env, region: config.region },
  });
  logger.info('platform booting', { moduleCount: MODULES.length });

  const events = createInProcessEventBus();

  // Database clients are wired in Sprint 1.1.2; pass undefined-shaped placeholder
  // so modules can compile and CI can verify the registration pipeline.
  const ctx: ModuleContext = {
    config,
    logger,
    events,
    db: {
      postgres: null,
      neo4j: null,
      redis: null,
    },
  };

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const handles: ModuleHandle[] = [];
  for (const mod of MODULES) {
    const handle = await mod.register(ctx);
    app.use(`/v1/${handle.name}`, handle.router);
    handles.push(handle);
  }

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
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('platform boot failed', err);
  process.exit(1);
});
