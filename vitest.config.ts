import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/__tests__/**/*.{ts,tsx}',
      'tests/e2e/fixtures/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx}',
    ],
    setupFiles: ['./tests/setup.ts'],
    css: false,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Emit the per-file JSON summary consumed by scripts/check-coverage.js,
      // plus human-readable text/html for local inspection.
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      // Measure only first-party source. Tests, type declarations, and generated
      // output are excluded so they never dilute or pollute per-file numbers.
      all: false,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
      ],
    },
  },
});
