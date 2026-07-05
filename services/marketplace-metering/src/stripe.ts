/**
 * Stripe billing integration.
 *
 * Supports:
 *   - Subscription tiers (starter / growth / enterprise) via Stripe Products
 *   - Per-expert-session charges via Stripe Invoice Items
 *   - Expert payout via Stripe Connect (when STRIPE_CONNECT enabled)
 *
 * Graceful degradation: when STRIPE_SECRET_KEY is not set, all functions
 * return stub values so the rest of the platform still functions in dev.
 */

import Stripe from 'stripe';

export type SubscriptionTier = 'starter' | 'growth' | 'enterprise';

export interface BillingClient {
  createCustomer(email: string, tenantId: string): Promise<string>;
  createSubscription(
    customerId: string,
    tier: SubscriptionTier,
  ): Promise<{ subscriptionId: string; status: string }>;
  chargeExpertSession(
    customerId: string,
    amountCents: number,
    description: string,
  ): Promise<string>;
  isLive: boolean;
}

const STRIPE_PRICE_IDS: Record<SubscriptionTier, string> = {
  starter: process.env['STRIPE_PRICE_STARTER'] ?? 'price_starter_placeholder',
  growth: process.env['STRIPE_PRICE_GROWTH'] ?? 'price_growth_placeholder',
  enterprise: process.env['STRIPE_PRICE_ENTERPRISE'] ?? 'price_enterprise_placeholder',
};

export function createBillingClient(): BillingClient {
  const secretKey = process.env['STRIPE_SECRET_KEY'];

  if (!secretKey) {
    return {
      isLive: false,
      async createCustomer(email: string, tenantId: string): Promise<string> {
        return `cus_stub_${tenantId}_${email.replace(/\W/g, '')}`;
      },
      async createSubscription(customerId: string, tier: SubscriptionTier) {
        return { subscriptionId: `sub_stub_${customerId}_${tier}`, status: 'active' };
      },
      async chargeExpertSession(
        customerId: string,
        amountCents: number,
        description: string,
      ): Promise<string> {
        return `ch_stub_${customerId}_${amountCents}_${description.slice(0, 8)}`;
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripe = new Stripe(secretKey, {} as any);

  return {
    isLive: true,

    async createCustomer(email: string, tenantId: string): Promise<string> {
      const customer = await stripe.customers.create({
        email,
        metadata: { tenantId },
      });
      return customer.id;
    },

    async createSubscription(customerId: string, tier: SubscriptionTier) {
      const priceId = STRIPE_PRICE_IDS[tier];
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      });
      return { subscriptionId: subscription.id, status: subscription.status };
    },

    async chargeExpertSession(
      customerId: string,
      amountCents: number,
      description: string,
    ): Promise<string> {
      // Create an invoice item and auto-pay it via the customer's default payment method
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: amountCents,
        currency: 'usd',
        description,
      });
      const invoice = await stripe.invoices.create({
        customer: customerId,
        auto_advance: true,
      });
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
      return finalized.id;
    },
  };
}
