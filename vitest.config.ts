import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['nodes/**/*.test.ts', 'credentials/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'nodes/Servicely/actions/**/*.ts',
        'nodes/Servicely/GenericFunctions.ts',
        'nodes/Servicely/SearchFunctions.ts',
        'nodes/Servicely/Servicely.node.ts',
        'nodes/Servicely/ServicelyTrigger.node.ts',
        'credentials/ServicelyApi.credentials.ts',
      ],
      exclude: ['nodes/Servicely/actions/**/common.descriptions.ts', 'nodes/Servicely/actions/node.type.ts'],
      reporter: ['text', 'html'],
      // Every covered file must clear 80% on all metrics (perFile enforces the
      // floor per file rather than only in aggregate).
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
