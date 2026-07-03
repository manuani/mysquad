import { describe, expect, it } from 'vitest';
import { createExpert, updateExpert } from '../src/experts.js';
import type { TenantContext } from '@voai/auth-context';

const TC: TenantContext = {
  tenantId: 'tenant-1', userId: 'user-1', userType: 'founder', sessionId: 'sess-1',
};

const BASE_ROW = {
  id: 'exp-uuid',
  tenant_id: 'tenant-1',
  name: 'Alice Expert',
  email: 'alice@example.com',
  bio: null,
  linkedin_url: null,
  status: 'pending',
  hourly_rate_usd_cents: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

function makeClient(row: Record<string, unknown>) {
  return {
    async query(_sql: string, _params: unknown[]) {
      return { rows: [row] };
    },
  };
}

describe('createExpert', () => {
  it('returns an ExpertWithTags on success', async () => {
    const client = makeClient(BASE_ROW);
    const result = await createExpert(TC, client as never, { name: 'Alice Expert', email: 'alice@example.com' });
    expect(result.id).toBe('exp-uuid');
    expect(result.name).toBe('Alice Expert');
    expect(result.domainTags).toEqual([]);
  });

  it('throws ValidationError when name is blank', async () => {
    const client = makeClient(BASE_ROW);
    await expect(createExpert(TC, client as never, { name: '  ', email: 'x@y.com' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('throws ValidationError when email is blank', async () => {
    const client = makeClient(BASE_ROW);
    await expect(createExpert(TC, client as never, { name: 'Alice', email: '' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lowercases and trims the email', async () => {
    let capturedParams: unknown[] = [];
    const client = {
      async query(_sql: string, params: unknown[]) {
        capturedParams = params;
        return { rows: [BASE_ROW] };
      },
    };
    await createExpert(TC, client as never, { name: 'Bob', email: '  Bob@Example.COM  ' });
    expect(capturedParams[2]).toBe('bob@example.com');
  });
});

describe('updateExpert', () => {
  it('throws ValidationError when no fields are provided', async () => {
    const client = makeClient(BASE_ROW);
    await expect(updateExpert(TC, client as never, 'exp-uuid', {}))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('returns updated profile on success', async () => {
    const client = makeClient({ ...BASE_ROW, status: 'active', name: 'Alice Updated' });
    const result = await updateExpert(TC, client as never, 'exp-uuid', { name: 'Alice Updated', status: 'active' });
    expect(result.name).toBe('Alice Updated');
    expect(result.status).toBe('active');
  });
});
