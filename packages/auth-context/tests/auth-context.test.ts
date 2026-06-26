import { describe, expect, it } from 'vitest';
import { buildTenantContext, MissingTenantContextError, type TenantContext } from '../src/index.js';

const sampleFields = {
  tenantId: 'tenant_123',
  userId: 'user_456',
  userType: 'founder',
  sessionId: 'session_789',
};

describe('auth-context', () => {
  it('builds a TenantContext from valid fields', () => {
    const ctx: TenantContext = buildTenantContext(sampleFields);
    expect(ctx).toEqual(sampleFields);
  });

  it('throws MissingTenantContextError when tenantId is missing', () => {
    expect(() => buildTenantContext({ ...sampleFields, tenantId: null })).toThrow(
      MissingTenantContextError,
    );
  });

  it('throws MissingTenantContextError when userId is missing', () => {
    expect(() => buildTenantContext({ ...sampleFields, userId: undefined })).toThrow(
      /userId/,
    );
  });

  it('throws MissingTenantContextError when sessionId is missing', () => {
    expect(() => buildTenantContext({ ...sampleFields, sessionId: null })).toThrow(
      /sessionId/,
    );
  });

  it('throws MissingTenantContextError when userType is invalid', () => {
    expect(() => buildTenantContext({ ...sampleFields, userType: 'superadmin' })).toThrow(
      /userType/,
    );
  });

  it('is a plain explicit value — no ambient state between calls', () => {
    const ctxA = buildTenantContext(sampleFields);
    const ctxB = buildTenantContext({ ...sampleFields, tenantId: 'tenant_other' });
    expect(ctxA.tenantId).toBe('tenant_123');
    expect(ctxB.tenantId).toBe('tenant_other');
  });
});
