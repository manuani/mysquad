import { describe, expect, it } from 'vitest';
import type { HealthStatus, ModuleDefinition } from '../src/index.js';

describe('module contract', () => {
  it('HealthStatus admits the three documented variants', () => {
    const healthy: HealthStatus = { status: 'healthy' };
    const degraded: HealthStatus = { status: 'degraded', reason: 'slow upstream' };
    const unhealthy: HealthStatus = { status: 'unhealthy', reason: 'db down' };
    expect(healthy.status).toBe('healthy');
    expect(degraded.status).toBe('degraded');
    expect(unhealthy.status).toBe('unhealthy');
  });

  it('ModuleDefinition is structurally what services export', () => {
    // Compile-time check: assigning an object to ModuleDefinition validates the shape.
    const fake: ModuleDefinition = {
      name: 'fake',
      register: async () => ({
        name: 'fake',
        // express.Router not imported here intentionally; cast to satisfy structural type
        router: {} as never,
        health: async () => ({ status: 'healthy' }),
        shutdown: async () => {},
      }),
    };
    expect(fake.name).toBe('fake');
  });
});
