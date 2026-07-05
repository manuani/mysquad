import { describe, expect, it } from 'vitest';
import { createBillingClient } from '../src/stripe.js';

describe('createCheckoutSession (stub mode)', () => {
  it('returns a checkoutUrl and sessionId when Stripe is not configured', async () => {
    delete process.env['STRIPE_SECRET_KEY'];
    const billing = createBillingClient();
    expect(billing.isLive).toBe(false);

    const result = await billing.createCheckoutSession(
      'cus_test',
      'growth',
      'https://example.com/success',
      'https://example.com/cancel',
    );

    expect(result.checkoutUrl).toContain('https://example.com/success');
    expect(result.checkoutUrl).toContain('growth');
    expect(result.sessionId).toMatch(/^cs_stub_/);
  });

  it('stub checkout preserves customerId in sessionId', async () => {
    delete process.env['STRIPE_SECRET_KEY'];
    const billing = createBillingClient();

    const result = await billing.createCheckoutSession(
      'cus_mycompany',
      'starter',
      'https://app.example.com/billing/success',
      'https://app.example.com/billing/cancel',
    );

    expect(result.sessionId).toContain('cus_mycompany');
    expect(result.sessionId).toContain('starter');
  });
});
