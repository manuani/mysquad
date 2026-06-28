/**
 * Brain Service
 *
 * The eight knowledge domains stored across Postgres (structured), pgvector
 * (semantic), and Neo4j (relationship graph). Ingestion from sessions,
 * documents, integrations. Three query modes: semantic retrieval,
 * structured metric, real-time contradiction check (P95 brain query target
 * < 800ms).
 *
 * Sprint reference: Phase 3, Sprint 3.1 — Brain capture and storage
 * (Deliverable 3.1.1: Brain schema and storage).
 *
 * Scope of this implementation: backend storage + CRUD/search API only.
 * Meeting-transcript extraction needs `services/meeting` (doesn't exist
 * yet) and mobile UI is out of scope here — see README.md for the full
 * breakdown of what's implemented vs. deferred.
 */

import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { buildBrainRouter } from './routes.js';

export { BRAIN_DOMAINS, BRAIN_SOURCES, isBrainDomain, isBrainSource } from './domains.js';
export type { BrainDomain, BrainSource } from './domains.js';
export {
  createBrainContentItem,
  deleteBrainContentItem,
  getBrainContentHistory,
  getBrainContentItem,
  listBrainContentByDomain,
  searchBrainContent,
  updateBrainContentItem,
  type BrainAuditEntry,
  type BrainContentItem,
  type CreateBrainContentInput,
  type UpdateBrainContentInput,
} from './content-store.js';

export const brainModule: ModuleDefinition = {
  name: 'brain',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'brain' });

    // ctx.db.postgres is typed as `unknown` in @voai/types (module.ts
    // intentionally keeps DatabaseClients loosely typed there to avoid a
    // circular dependency on @voai/db); narrow it to the concrete
    // PostgresClient contract this module compiles against.
    const postgres = ctx.db.postgres as PostgresClient;

    const router = buildBrainRouter(postgres);

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'brain', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'brain',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default brainModule;
