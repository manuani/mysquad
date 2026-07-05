/**
 * Stripe webhook handler.
 *
 * Listens for subscription lifecycle events from Stripe and updates the
 * tenant's plan tier in the database.
 *
 * Events handled:
 *   customer.subscription.created   — set plan tier from price ID
 *   customer.subscription.updated   — update plan tier
 *   customer.subscription.deleted   — downgrade to starter / mark cancelled
 *
 * Requires STRIPE_WEBHOOK_SECRET env var to verify signatures. Without it,
 * the endpoint still accepts events but skips signature verification (dev only).
 */

import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import type { PostgresClient } from '@voai/db';
import type { Logger } from '@voai/types';
import type { SubscriptionTier } from './stripe.js';

const PRICE_TO_TIER: Record<string, SubscriptionTier> = {
  [process.env['STRIPE_PRICE_STARTER'] ?? 'price_starter_placeholder']: 'starter',
  [process.env['STRIPE_PRICE_GROWTH'] ?? 'price_growth_placeholder']: 'growth',
  [process.env['STRIPE_PRICE_ENTERPRISE'] ?? 'price_enterprise_placeholder']: 'enterprise',
};

function tierFromSubscription(subscription: Stripe.Subscription): SubscriptionTier {
  const priceId = subscription.items.data[0]?.price.id ?? '';
  return PRICE_TO_TIER[priceId] ?? 'starter';
}

async function updateTenantPlan(
  postgres: PostgresClient,
  stripeCustomerId: string,
  plan: SubscriptionTier | 'cancelled',
  log: Logger,
): Promise<void> {
  // adminQuery bypasses RLS — we need to find the tenant by stripe_customer_id
  // across all tenants (cross-tenant admin operation).
  const rows = await postgres.adminQuery<{ id: string }>(
    `UPDATE identity_tenants
     SET plan = $1, status = $2, updated_at = now()
     WHERE stripe_customer_id = $3
     RETURNING id`,
    [
      plan === 'cancelled' ? 'starter' : plan,
      plan === 'cancelled' ? 'cancelled' : 'active',
      stripeCustomerId,
    ],
  );
  if (rows.length === 0) {
    log.warn('webhook: no tenant found for stripe customer', {
      stripeCustomerId,
    });
  } else {
    log.info('webhook: tenant plan updated', {
      tenantId: rows[0]?.id,
      plan,
    });
  }
}

export function buildWebhookRouter(postgres: PostgresClient, log: Logger): Router {
  const router = Router();

  // Raw body needed for Stripe signature verification
  router.post(
    '/billing/webhook',
    // express.raw is applied per-route here so the rest of the router keeps express.json()
    (req: Request, res: Response) => {
      const secretKey = process.env['STRIPE_SECRET_KEY'];
      const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

      if (!secretKey) {
        // No Stripe configured — accept stub events in dev
        res.json({ received: true, mode: 'stub' });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stripe = new Stripe(secretKey, {} as any);

      let event: Stripe.Event;
      try {
        if (webhookSecret) {
          const sig = req.headers['stripe-signature'] as string;
          event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
        } else {
          // Dev: parse the raw body directly without signature check
          event = JSON.parse((req.body as Buffer).toString('utf8')) as Stripe.Event;
          log.warn(
            'stripe webhook: signature verification skipped (STRIPE_WEBHOOK_SECRET not set)',
          );
        }
      } catch (err) {
        log.warn('stripe webhook signature verification failed', {
          err: String(err),
        });
        res.status(400).json({ error: 'invalid signature' });
        return;
      }

      // Handle async without blocking response — Stripe wants 200 fast
      void (async () => {
        try {
          if (
            event.type === 'customer.subscription.created' ||
            event.type === 'customer.subscription.updated'
          ) {
            const sub = event.data.object as Stripe.Subscription;
            const tier = tierFromSubscription(sub);
            await updateTenantPlan(postgres, sub.customer as string, tier, log);
          } else if (event.type === 'customer.subscription.deleted') {
            const sub = event.data.object as Stripe.Subscription;
            await updateTenantPlan(postgres, sub.customer as string, 'cancelled', log);
          }
        } catch (err) {
          log.error('stripe webhook processing error', { err: String(err) });
        }
      })();

      res.json({ received: true });
    },
  );

  return router;
}
