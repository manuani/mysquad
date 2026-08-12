/**
 * The admin surface is cross-tenant — it lists every tenant, provisions new
 * ones, and manages users. It previously fell back to a hardcoded
 * `dev-admin-key` whenever ADMIN_API_KEY was unset, in every environment. This
 * repository is public, so that default is world-readable: any deploy that
 * forgot the variable handed full cross-tenant access to anyone who read the
 * source.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import adminConsoleModule from '../src/index.js';
import type { ModuleContext } from '@voai/types';

const noopLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(() => noopLogger),
};

function ctxFor(env: string): ModuleContext {
  return {
    config: { env },
    logger: noopLogger,
    db: { postgres: { withTenant: vi.fn(), adminQuery: vi.fn(), ping: vi.fn() } },
    events: { publish: vi.fn(), subscribe: vi.fn() },
  } as unknown as ModuleContext;
}

describe('admin-console-api key handling', () => {
  const original = process.env['ADMIN_API_KEY'];

  beforeEach(() => {
    delete process.env['ADMIN_API_KEY'];
  });

  afterEach(() => {
    if (original === undefined) delete process.env['ADMIN_API_KEY'];
    else process.env['ADMIN_API_KEY'] = original;
    vi.clearAllMocks();
  });

  it.each(['staging', 'production'])(
    'refuses to start in %s without ADMIN_API_KEY',
    async (env) => {
      // Failing to boot is recoverable in minutes and names the missing
      // variable. An open admin console might never be noticed.
      await expect(adminConsoleModule.register(ctxFor(env))).rejects.toThrow(/ADMIN_API_KEY must be set/);
    },
  );

  it('names the environment in the failure so the fix is obvious', async () => {
    await expect(adminConsoleModule.register(ctxFor('production'))).rejects.toThrow(/NODE_ENV=production/);
  });

  it('starts in development without one, but warns', async () => {
    const handle = await adminConsoleModule.register(ctxFor('development'));
    expect(handle.name).toBe('admin-console-api');
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_API_KEY not set'),
      expect.anything(),
    );
    await handle.shutdown();
  });

  it('starts in any environment once a key is configured', async () => {
    process.env['ADMIN_API_KEY'] = 'a-real-secret';
    const handle = await adminConsoleModule.register(ctxFor('production'));
    expect(handle.name).toBe('admin-console-api');
    expect(noopLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_API_KEY not set'),
      expect.anything(),
    );
    await handle.shutdown();
  });
});
