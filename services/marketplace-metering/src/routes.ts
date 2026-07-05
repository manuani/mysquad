/**
 * HTTP routes for the marketplace-metering module. Mounted at `/v1/metering/...`.
 *
 * Endpoints:
 *   POST /events                 — record a metering event
 *   GET  /usage?from=&to=        — get tenant usage summary for date range
 *   GET  /entitlement?dim=       — check plan quota for a dimension
 *   POST /billing/customer       — create Stripe customer for tenant
 *   POST /billing/subscribe      — subscribe tenant to a tier
 *   POST /billing/expert-charge  — charge tenant for an expert session
 */

import { Router, type Request, type Response } from 'express';
import { buildTenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import type { Logger } from '@voai/types';
import { isPlatformError, ValidationError } from '@voai/errors';
import { recordMeteringEvent, getTenantUsageSummary, type MeteringEventType } from './metering.js';
import { createBillingClient, type SubscriptionTier } from './stripe.js';
import { checkEntitlement, type EntitlementDimension } from './entitlement.js';

const VALID_DIMENSIONS: EntitlementDimension[] = [
  'roster_calls_per_month',
  'expert_sessions_per_month',
  'seats',
];

const VALID_EVENT_TYPES: MeteringEventType[] = ['llm_tokens', 'expert_minutes', 'ai_roster_call'];
const VALID_TIERS: SubscriptionTier[] = ['starter', 'growth', 'enterprise'];

function tenantContextFromHeaders(req: Request) {
  return buildTenantContext({
    tenantId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    userType: req.header('x-user-type'),
    sessionId: req.header('x-session-id'),
  });
}

function handleError(err: unknown, res: Response, log: Logger): void {
  if (isPlatformError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  log.error('unexpected metering error', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL', message: 'unexpected error' });
}

export function buildMeteringRouter(postgres: PostgresClient, log: Logger): Router {
  const router = Router();
  const billing = createBillingClient();

  log.info('billing client initialised', { live: billing.isLive });

  router.post('/events', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!VALID_EVENT_TYPES.includes(body.eventType as MeteringEventType)) {
        throw new ValidationError(`eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
      }
      if (typeof body.quantity !== 'number' || body.quantity < 0) {
        throw new ValidationError('quantity must be a non-negative number');
      }
      const event = await postgres.withTenant(tc.tenantId, async (client) =>
        recordMeteringEvent(tc, client, {
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          eventType: body.eventType as MeteringEventType,
          quantity: body.quantity as number,
          model: typeof body.model === 'string' ? body.model : undefined,
          unitCostMicro: typeof body.unitCostMicro === 'number' ? body.unitCostMicro : undefined,
          metadata:
            typeof body.metadata === 'object' && body.metadata !== null
              ? (body.metadata as Record<string, unknown>)
              : undefined,
        }),
      );
      res.status(201).json(event);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/usage', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const q = req.query as Record<string, string>;
      const from = q['from']
        ? new Date(q['from'])
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const to = q['to'] ? new Date(q['to']) : new Date();
      if (isNaN(from.getTime())) throw new ValidationError('invalid from date');
      if (isNaN(to.getTime())) throw new ValidationError('invalid to date');
      const summary = await postgres.withTenant(tc.tenantId, async (client) =>
        getTenantUsageSummary(tc, client, from, to),
      );
      res.status(200).json(summary);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.get('/entitlement', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const dim = (req.query as Record<string, string>)['dim'] as EntitlementDimension;
      if (!VALID_DIMENSIONS.includes(dim)) {
        throw new ValidationError(`dim must be one of: ${VALID_DIMENSIONS.join(', ')}`);
      }
      const status = await postgres.withTenant(tc.tenantId, async (client) =>
        checkEntitlement(tc, client, dim),
      );
      res.status(200).json(status);
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/billing/customer', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.email !== 'string') throw new ValidationError('email required');
      const customerId = await billing.createCustomer(body.email as string, tc.tenantId);
      log.info('stripe customer created', {
        customerId,
        tenantId: tc.tenantId,
        live: billing.isLive,
      });
      res.status(201).json({ customerId, live: billing.isLive });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/billing/checkout', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!VALID_TIERS.includes(body.tier as SubscriptionTier)) {
        throw new ValidationError(`tier must be one of: ${VALID_TIERS.join(', ')}`);
      }
      if (typeof body.customerId !== 'string') throw new ValidationError('customerId required');
      if (typeof body.successUrl !== 'string') throw new ValidationError('successUrl required');
      if (typeof body.cancelUrl !== 'string') throw new ValidationError('cancelUrl required');
      const result = await billing.createCheckoutSession(
        body.customerId as string,
        body.tier as SubscriptionTier,
        body.successUrl as string,
        body.cancelUrl as string,
      );
      log.info('stripe checkout session created', {
        sessionId: result.sessionId,
        tenantId: tc.tenantId,
        tier: body.tier,
        live: billing.isLive,
      });
      res.status(201).json({ ...result, live: billing.isLive });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/billing/subscribe', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (!VALID_TIERS.includes(body.tier as SubscriptionTier)) {
        throw new ValidationError(`tier must be one of: ${VALID_TIERS.join(', ')}`);
      }
      if (typeof body.customerId !== 'string') throw new ValidationError('customerId required');
      const result = await billing.createSubscription(
        body.customerId as string,
        body.tier as SubscriptionTier,
      );
      log.info('subscription created', { ...result, tenantId: tc.tenantId, tier: body.tier });
      res.status(201).json({ ...result, live: billing.isLive });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  router.post('/billing/expert-charge', async (req: Request, res: Response) => {
    try {
      const tc = tenantContextFromHeaders(req);
      const body = req.body as Record<string, unknown>;
      if (typeof body.customerId !== 'string') throw new ValidationError('customerId required');
      if (typeof body.amountCents !== 'number' || body.amountCents <= 0)
        throw new ValidationError('amountCents must be positive');
      if (typeof body.description !== 'string') throw new ValidationError('description required');
      const chargeId = await billing.chargeExpertSession(
        body.customerId as string,
        body.amountCents as number,
        body.description as string,
      );
      log.info('expert session charged', {
        chargeId,
        tenantId: tc.tenantId,
        amountCents: body.amountCents,
      });
      res.status(201).json({ chargeId, live: billing.isLive });
    } catch (err) {
      handleError(err, res, log);
    }
  });

  return router;
}
