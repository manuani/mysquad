import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Live Postgres connections take longer than the unit-test default.
    testTimeout: 15000,
  },
});
