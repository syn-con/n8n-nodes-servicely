import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/transport/**', 'src/handlers/**', 'src/methods/**', 'src/errors.ts'],
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
