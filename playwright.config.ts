import { defineConfig } from '@playwright/test';

/**
 * Kosmos E2E Test Playwright Configuration
 *
 * Uses Playwright Electron API for end-to-end testing.
 * Test files are in tests/e2e/ directory, named *.e2e.ts.
 *
 * Run commands:
 *   npm run test:e2e          # Run all E2E tests
 *   npm run test:e2e:headed   # Run with UI
 *   npm run test:e2e:debug    # Debug mode
 *   npm run test:e2e:ui       # Playwright UI mode
 *   npm run test:e2e:report   # View test report
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',

  /* Global timeout */
  timeout: 60_000, // 60s per test (Electron startup is slow)
  expect: {
    timeout: 10_000, // 10s assertion timeout
  },

  /* Retry strategy */
  retries: process.env.CI ? 2 : 0, // Retry 2 times in CI environment

  /* Parallelism control — Electron tests should run serially to avoid resource contention */
  workers: 1,
  fullyParallel: false,

  /* Reporter */
  reporter: [
    ['list'], // Console output
    [
      'html',
      {
        outputFolder: 'tests/e2e/report',
        open: 'never',
      },
    ],
    // CI environment additionally outputs JUnit XML (for CI report integration)
    ...(process.env.CI
      ? [
          [
            'junit' as const,
            { outputFile: 'tests/e2e/report/junit.xml' } as any,
          ],
        ]
      : []),
  ],

  /* Screenshots and video */
  use: {
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    trace: 'retain-on-failure',
  },

  /* Output directory */
  outputDir: 'tests/e2e/test-results',

  /* Global Setup/Teardown (reserved) */
  // globalSetup: './tests/e2e/global-setup.ts',
  // globalTeardown: './tests/e2e/global-teardown.ts',
});
