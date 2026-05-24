import { defineConfig } from '@playwright/test';

/**
 * Kosmos E2E Test Playwright Configuration
 *
 * Uses the Playwright Electron API for end-to-end testing.
 * Test files are located in tests/e2e/ and follow the *.e2e.ts naming convention.
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

  /* Global timeouts */
  timeout: 60_000, // 60s per test (Electron startup is slow)
  expect: {
    timeout: 10_000, // assertion timeout 10s
  },

  /* Retry strategy */
  retries: process.env.CI ? 2 : 0, // retry 2 times in CI

  /* Parallelism — Electron tests should run serially to avoid resource contention */
  workers: 1,
  fullyParallel: false,

  /* Reporters */
  reporter: [
    ['list'], // console output
    [
      'html',
      {
        outputFolder: 'tests/e2e/report',
        open: 'never',
      },
    ],
    // In CI, also output JUnit XML (for CI report integration)
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
