/**
 * HTTP routes for the ledger module. Mounted by the gateway at
 * `/v1/ledger/...` (module mount-path convention, see root CLAUDE.md
 * "Conventions").
 *
 * Per ADR 007, `TenantContext` is constructed once per request from
 * already-authenticated headers the API gateway attaches after resolving
 * the caller's session token via identity-and-tenancy (`x-tenant-id`,
 * `x-user-id`, `x-user-type`, `x-session-id`). This module does not
 * authenticate the caller itself — that is identity-and-tenancy's
 * responsibility — it only requires the context to already be present.
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { isPlatformError, ValidationError } from '@voai/errors';
import {
  createAction,
  transitionActionState,
  type ActionState,
  type AssignedTo,
} from './actions.js';
import {
  createDecision,
  recordDecisionOutcome,
  supersedeDecision,
  type DecisionState,
  type StakesLevel,
  type SupersessionMode,
} from './decisions.js';
import { createConflict, resolveConflict, type ConflictSeverity } from './conflicts.js';
import { getCurrentlyActive } from './currently-active.js';

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new ValidationError(`${name} path parameter is required`);
  return value;
}

function tenantContextFromHeaders(req: Request) {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function handleError(err: unknown, res: Response): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

const STAKES_LEVELS: readonly StakesLevel[] = ['low', 'medium', 'high'];
const DECISION_STATES: readonly DecisionState[] = ['active', 'superseded', 'abandoned', 'draft'];
const ASSIGNED_TO_VALUES: readonly AssignedTo[] = ['founder', 'agent', 'expert'];
const ACTION_STATES: readonly ActionState[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'blocked',
  'snoozed',
  'delegated_to_expert',
];
const SUPERSESSION_MODES: readonly SupersessionMode[] = ['refines', 'replaces', 'parallel', 'abandons'];
const CONFLICT_SEVERITIES: readonly ConflictSeverity[] = ['low', 'medium', 'high'];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function buildLedgerRouter(postgres: PostgresClient): Router {
  const router = Router();

  router.post('/decisions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.decisionType !== 'string') throw new ValidationError('decisionType is required');
      if (typeof body.summary !== 'string') throw new ValidationError('summary is required');
      if (!isOneOf(STAKES_LEVELS, body.stakesLevel)) {
        throw new ValidationError(`stakesLevel must be one of ${STAKES_LEVELS.join(', ')}`);
      }
      if (body.state !== undefined && !isOneOf(DECISION_STATES, body.state)) {
        throw new ValidationError(`state must be one of ${DECISION_STATES.join(', ')}`);
      }

      const decision = await createDecision(tenantContext, postgres, {
        decisionType: body.decisionType,
        summary: body.summary,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
        stakesLevel: body.stakesLevel,
        meetingId: typeof body.meetingId === 'string' ? body.meetingId : null,
        confirmedBy: typeof body.confirmedBy === 'string' ? body.confirmedBy : null,
        state: isOneOf(DECISION_STATES, body.state) ? body.state : undefined,
      });
      res.status(201).json(decision);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.patch('/decisions/:id/supersede', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!isOneOf(SUPERSESSION_MODES, body.mode)) {
        throw new ValidationError(`mode must be one of ${SUPERSESSION_MODES.join(', ')}`);
      }

      const decision = await supersedeDecision(tenantContext, postgres, {
        priorDecisionId: requireParam(req, 'id'),
        newDecisionId: typeof body.newDecisionId === 'string' ? body.newDecisionId : undefined,
        mode: body.mode,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      res.status(200).json(decision);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.patch('/decisions/:id/outcome', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.outcome !== 'string') throw new ValidationError('outcome is required');

      const decision = await recordDecisionOutcome(tenantContext, postgres, {
        decisionId: requireParam(req, 'id'),
        outcome: body.outcome,
      });
      res.status(200).json(decision);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/actions', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!isOneOf(ASSIGNED_TO_VALUES, body.assignedTo)) {
        throw new ValidationError(`assignedTo must be one of ${ASSIGNED_TO_VALUES.join(', ')}`);
      }

      const action = await createAction(tenantContext, postgres, {
        assignedTo: body.assignedTo,
        decisionId: typeof body.decisionId === 'string' ? body.decisionId : null,
        dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
      });
      res.status(201).json(action);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.patch('/actions/:id/state', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!isOneOf(ACTION_STATES, body.state)) {
        throw new ValidationError(`state must be one of ${ACTION_STATES.join(', ')}`);
      }

      const action = await transitionActionState(tenantContext, postgres, {
        actionId: requireParam(req, 'id'),
        state: body.state,
        blockedReason: typeof body.blockedReason === 'string' ? body.blockedReason : null,
        snoozedUntil: typeof body.snoozedUntil === 'string' ? body.snoozedUntil : null,
        delegatedToExpertId: typeof body.delegatedToExpertId === 'string' ? body.delegatedToExpertId : null,
        outcome: typeof body.outcome === 'string' ? body.outcome : null,
      });
      res.status(200).json(action);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/conflicts', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.conflictType !== 'string') throw new ValidationError('conflictType is required');
      if (typeof body.sourceAType !== 'string' || typeof body.sourceAId !== 'string') {
        throw new ValidationError('sourceAType and sourceAId are required');
      }
      if (typeof body.sourceBType !== 'string' || typeof body.sourceBId !== 'string') {
        throw new ValidationError('sourceBType and sourceBId are required');
      }
      if (!isOneOf(CONFLICT_SEVERITIES, body.severity)) {
        throw new ValidationError(`severity must be one of ${CONFLICT_SEVERITIES.join(', ')}`);
      }

      const conflict = await createConflict(tenantContext, postgres, {
        conflictType: body.conflictType,
        sourceAType: body.sourceAType,
        sourceAId: body.sourceAId,
        sourceBType: body.sourceBType,
        sourceBId: body.sourceBId,
        severity: body.severity,
      });
      res.status(201).json(conflict);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/conflicts/:id/resolve', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.resolutionNote !== 'string') throw new ValidationError('resolutionNote is required');

      const conflict = await resolveConflict(tenantContext, postgres, {
        conflictId: requireParam(req, 'id'),
        resolvedBy: tenantContext.userId,
        resolutionNote: body.resolutionNote,
      });
      res.status(200).json(conflict);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/currently-active', async (req: Request, res: Response) => {
    try {
      const tenantContext = tenantContextFromHeaders(req);
      const view = await getCurrentlyActive(tenantContext, postgres);
      res.status(200).json(view);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
