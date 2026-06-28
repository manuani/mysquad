/**
 * Ledger Service
 *
 * Decisions, actions, conflicts — backend storage and CRUD/state-transition
 * API. Seven action lifecycle states (Pending, In Progress, Completed,
 * Cancelled, Blocked, Snoozed, Delegated_to_expert); four decision states
 * (Active, Superseded, Abandoned, Draft); four-button conflict resolution
 * (Refines, Replaces, Parallel, Abandons).
 *
 * Sprint reference: Phase 3, Sprint 3.2, Deliverable 3.2.1 (Ledger schema
 * and lifecycle).
 *
 * Scope of this module: backend storage + CRUD/state-transition API only.
 * End-of-meeting extraction (the three confirmation tiers — routine,
 * substantive, high-stakes) requires `services/meeting`, which does not
 * exist yet, and is deferred to the session that builds it. There is no
 * mobile ledger UI in this module — that is a client-surface concern.
 */

import express from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient } from '@voai/db';
import { buildLedgerRouter } from './routes.js';

export type { ActionRow, ActionState, AssignedTo, CreateActionInput, TransitionActionStateInput } from './actions.js';
export {
  createAction,
  getAction,
  listActions,
  listPendingOrInProgressActions,
  transitionActionState,
} from './actions.js';

export type {
  CreateDecisionInput,
  DecisionRow,
  DecisionState,
  RecordOutcomeInput,
  StakesLevel,
  SupersedeDecisionInput,
  SupersessionMode,
} from './decisions.js';
export {
  abandonDecision,
  confirmDecision,
  createDecision,
  getDecision,
  listDecisions,
  listOutcomeDueDecisions,
  recordDecisionOutcome,
  supersedeDecision,
} from './decisions.js';

export type {
  ConflictResolutionState,
  ConflictRow,
  ConflictSeverity,
  CreateConflictInput,
  ResolveConflictInput,
} from './conflicts.js';
export { acknowledgeConflict, createConflict, getConflict, listUnresolvedConflicts, resolveConflict } from './conflicts.js';

export type { CurrentlyActiveView } from './currently-active.js';
export { getCurrentlyActive } from './currently-active.js';

export { buildLedgerRouter } from './routes.js';

export const ledgerModule: ModuleDefinition = {
  name: 'ledger',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'ledger' });

    // ctx.db.postgres is typed as `unknown` in @voai/types (module.ts
    // intentionally keeps DatabaseClients loosely typed there to avoid a
    // circular dependency on @voai/db); narrow it to the concrete
    // PostgresClient contract this module compiles against.
    const postgres = ctx.db.postgres as PostgresClient;

    const router = express.Router();
    router.use(buildLedgerRouter(postgres));

    router.get('/healthz', (_req, res) => {
      res.json({ module: 'ledger', status: 'healthy' });
    });

    log.info('module registered');

    return {
      name: 'ledger',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default ledgerModule;
