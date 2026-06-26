import { describe, expect, it } from 'vitest';
import type { ModuleDefinition } from '@voai/types';

import identityAndTenancyModule from '@voai/identity-and-tenancy';
import meetingModule from '@voai/meeting';
import brainModule from '@voai/brain';
import ledgerModule from '@voai/ledger';
import agentRuntimeModule from '@voai/agent-runtime';
import routingModule from '@voai/routing';
import performanceModule from '@voai/performance';
import marketplaceModule from '@voai/marketplace';
import marketplaceMeteringModule from '@voai/marketplace-metering';
import notificationModule from '@voai/notification';
import adminConsoleApiModule from '@voai/admin-console-api';

const ALL_MODULES: Array<[string, ModuleDefinition]> = [
  ['identity-and-tenancy', identityAndTenancyModule],
  ['meeting', meetingModule],
  ['brain', brainModule],
  ['ledger', ledgerModule],
  ['agent-runtime', agentRuntimeModule],
  ['routing', routingModule],
  ['performance', performanceModule],
  ['marketplace', marketplaceModule],
  ['marketplace-metering', marketplaceMeteringModule],
  ['notification', notificationModule],
  ['admin-console-api', adminConsoleApiModule],
];

describe('platform module registration', () => {
  it('imports all 11 service modules', () => {
    expect(ALL_MODULES).toHaveLength(11);
  });

  it.each(ALL_MODULES)('module %s exposes a valid ModuleDefinition', (name, mod) => {
    expect(mod.name).toBe(name);
    expect(typeof mod.register).toBe('function');
  });

  it('module names are unique', () => {
    const names = ALL_MODULES.map(([, m]) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
