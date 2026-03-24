# OpenKosmos E2E Testing Technical Proposal — Based on Playwright

> **Version**: 1.0
> **Last Updated**: 2026-02-24
> **Author**: Claude Code
> **Status**: Technical Feasibility Analysis & Implementation Plan

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feasibility Analysis](#2-feasibility-analysis)
3. [Technical Architecture Design](#3-technical-architecture-design)
4. [Directory Structure Planning](#4-directory-structure-planning)
5. [Environment Configuration](#5-environment-configuration)
6. [Core Fixture Design](#6-core-fixture-design)
7. [Authentication Strategy](#7-authentication-strategy)
8. [Test Case Planning](#8-test-case-planning)
9. [CI/CD Integration Plan](#9-cicd-integration-plan)
10. [Best Practices & Considerations](#10-best-practices--considerations)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Appendix](#appendix)

---

## 1. Overview

### 1.1 Background

OpenKosmos is an AI assistant desktop application built on Electron + React. The project currently has only **6 unit test files** (all located in the `__tests__` directory under `src/main/lib/`), with no end-to-end (E2E) tests at all. As feature iterations accelerate, there is an urgent need to establish an E2E testing framework to ensure the stability of core user flows.

### 1.2 Goals

- Establish an E2E testing framework based on the Playwright Electron API
- Cover core user flows: Startup → Authentication → Chat → Settings → Agent Management
- Support both local development and CI/CD execution modes
- Coexist with the existing Jest unit testing framework without interference

### 1.3 Why Playwright

| Comparison | Playwright | Spectron (Deprecated) | WebDriverIO | Cypress |
|---------|------------|-------------------|-------------|---------|
| Native Electron Support | ✅ `_electron.launch()` | ❌ Discontinued | ⚠️ Complex configuration required | ❌ No Electron support |
| Multi-Window Support | ✅ `app.windows()` | ✅ | ⚠️ Limited | ❌ |
| Main Process Access | ✅ `app.evaluate()` | ✅ | ❌ | ❌ |
| TypeScript Support | ✅ First-class citizen | ⚠️ | ✅ | ✅ |
| Community Activity | ⭐⭐⭐⭐⭐ | ❌ Deprecated | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Already Installed | ✅ `^1.58.0` | — | — | — |

**Conclusion**: Playwright is currently the best choice for Electron E2E testing, and the dependency is already installed in the project.

---

## 2. Feasibility Analysis

### 2.1 ✅ Favorable Conditions

| Condition | Details |
|------|------|
| **Playwright Already Installed** | `"playwright": "^1.58.0"` is already in `devDependencies` |
| **Webpack Externalized** | `webpack.main.config.js` already treats `playwright` / `playwright-core` as external modules |
| **electron-builder Excludes Browsers** | `!**/node_modules/playwright*/.local-browsers/**` is already excluded from packaging |
| **BrowserWindow Sandbox Disabled** | `sandbox: false` — a hard requirement for the Playwright Electron API |
| **contextIsolation Enabled** | Secure preload bridge pattern, fully compatible with Playwright |
| **Build Output Available** | `dist/main/main.js` can be used directly as the Electron entry point |

### 2.2 ⚠️ Issues to Address

#### A. App Readiness Gate

The App component displays a loading page until backend services are ready:

```tsx
// src/renderer/App.tsx
if (!isAppReady) {
  return <div>Initializing Core Services...</div>;
}
```

**Solution**: In E2E tests, use `waitForSelector` to wait for loading to complete before interacting.

#### B. GitHub OAuth Device Code Authentication Flow

Authentication uses the GitHub Copilot OAuth Device Flow, which requires user confirmation in a browser:

```
User → App requests device code → GitHub returns device code → User confirms in browser → App obtains Token
```

**Solution**: Three authentication strategies are provided (see Section 7 for details).

#### C. HashRouter Routing

All routes use `HashRouter`, with URLs formatted as `/#/path`:

```tsx
<HashRouter>
  <AppRoutes />
</HashRouter>
```

**Solution**: URL assertions use regex to match the `/#/` prefix.

#### D. Multi-Window Architecture

The application may have multiple windows open simultaneously:

| Window | HTML Entry | Purpose |
|------|----------|------|
| Main | `index.html` | Main Application |
| Screenshot | `screenshot.html` | Screenshot Overlay |

**Solution**: Use `electronApp.windows()` to get the window list, and filter target windows by URL or title.

#### E. userData Path Isolation

`bootstrap.ts` sets a brand-specific `userData` path on startup:

```ts
app.setPath('userData', path.join(app.getPath('appData'), userDataName));
```

**Solution**: E2E tests inject an isolated test data directory via environment variables to avoid contaminating real user data.

#### F. Feature Flag Control

Some pages are restricted by Feature Flags (e.g., Memory, Voice Input, etc. are only available in dev mode):

| Feature Flag | Default Condition |
|-------------|---------|
| `kosmosFeatureMemory` | Dev mode (excluding win32-arm64) |
| `kosmosFeatureVoiceInput` | Dev mode |
| `kosmosFeatureTextToSpeech` | Dev mode |
| `browserControl` | dev + win32 |

**Solution**: Set `NODE_ENV=development` at E2E startup or use the `--enable-features` CLI argument.

### 2.3 Feasibility Conclusion

| Dimension | Assessment |
|------|------|
| Playwright Compatibility | ✅ Fully compatible |
| Infrastructure Readiness | ✅ Dependencies installed, build configuration ready |
| Authentication Complexity | ⚠️ Requires Token pre-seeding or IPC Mock |
| Multi-Window Handling | ⚠️ Requires window selection logic |
| Existing Test Infrastructure | ⚠️ `tests/` directory and `tests/setup.ts` missing |
| **Overall Feasibility** | **✅ Highly feasible, low refactoring cost** |

---

## 3. Technical Architecture Design

### 3.1 Test Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          E2E Test Layer                             │
│                     tests/e2e/*.e2e.ts                           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │  Startup   │ │   Auth     │ │   Chat     │ │  Settings   │  │
│  │  startup   │ │   auth     │ │    chat    │ │  settings    │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────┬───────┘  │
│        └───────────────┴──────────────┴───────────────┘          │
│                              │                                   │
│                    ┌─────────┴──────────┐                        │
│                    │  Test Fixtures     │                        │
│                    │  electronApp.ts    │                        │
│                    │  authHelper.ts     │                        │
│                    └─────────┬──────────┘                        │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                    Playwright _electron.launch()
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Kosmos Electron App                         │
│  ┌──────────────────┐    IPC    ┌────────────────────────────┐   │
│  │   Main Process   │ ◄──────► │    Renderer Process        │   │
│  │  dist/main/      │          │    dist/renderer/           │   │
│  │  main.js         │          │    index.html               │   │
│  └──────────────────┘          └────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Test Layer Classification

```
┌─────────────────────────────────────────────────────┐
│            E2E Tests (Playwright + Electron)         │  ← This proposal
│         Full user flows, real Electron environment     │
├─────────────────────────────────────────────────────┤
│          Integration Tests (Jest + jsdom)            │  ← Future expansion
│         Component interaction tests, Mock IPC          │
├─────────────────────────────────────────────────────┤
│            Unit Tests (Jest + ts-jest)               │  ← Existing
│         Pure logic tests, no Electron dependency       │
└─────────────────────────────────────────────────────┘
```

### 3.3 Isolation Strategy from Existing Jest Tests

| Dimension | Jest Unit Tests | Playwright E2E |
|------|-------------|----------------|
| Config File | `jest.config.js` | `playwright.config.ts` |
| Test Directory | `src/**/__tests__/` | `tests/e2e/` |
| File Naming | `*.test.ts` | `*.e2e.ts` |
| Run Command | `npm test` | `npm run test:e2e` |
| Runtime Environment | Node.js | Electron Application |
| Parallelism Strategy | Jest Worker Pool | Playwright Worker |

The two testing frameworks are fully isolated through separate configuration files and commands.

---

## 4. Directory Structure Planning

```
tests/
├── setup.ts                        # Jest setup (fixes existing jest.config.js reference)
├── e2e/
│   ├── fixtures/
│   │   ├── electronApp.ts          # Electron Launch Fixture (core)
│   │   ├── authHelper.ts           # Authentication helper utilities
│   │   └── testDataManager.ts      # Test data management (create/cleanup)
│   ├── helpers/
│   │   ├── selectors.ts            # Common selector constants
│   │   ├── waitUtils.ts            # Wait utility functions
│   │   └── navigation.ts           # Navigation helper functions
│   ├── startup.e2e.ts              # Startup flow tests
│   ├── auth.e2e.ts                 # Authentication flow tests
│   ├── chat.e2e.ts                 # Chat functionality tests
│   ├── agent.e2e.ts                # Agent management tests
│   ├── settings.e2e.ts             # Settings page tests
│   ├── mcp.e2e.ts                  # MCP server management tests
│   ├── skills.e2e.ts               # Skills management tests
│   └── report/                     # Test report output directory (.gitignore)
├── __mocks__/                      # Jest mock files (optional)
└── README.md                       # Test documentation (optional)
```

---

## 5. Environment Configuration

### 5.1 Playwright Configuration File

```ts
// playwright.config.ts (project root)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',

  /* Global timeouts */
  timeout: 60_000,           // Single test 60s
  expect: {
    timeout: 10_000,         // Assertion timeout 10s
  },

  /* Retry strategy */
  retries: process.env.CI ? 2 : 0,    // Retry 2 times in CI environment

  /* Parallel control */
  workers: 1,                // Serial execution recommended for Electron tests to avoid resource contention
  fullyParallel: false,

  /* Reporter */
  reporter: [
    ['list'],                // Console output
    ['html', {
      outputFolder: 'tests/e2e/report',
      open: 'never',
    }],
    ...(process.env.CI ? [['junit' as const, {
      outputFile: 'tests/e2e/report/junit.xml'
    }]] : []),
  ],

  /* Screenshots & Video */
  use: {
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    trace: 'retain-on-failure',
  },

  /* Output directory */
  outputDir: 'tests/e2e/test-results',

  /* Global Setup/Teardown */
  globalSetup: undefined,     // Reserved: can add global auth token retrieval later
  globalTeardown: undefined,  // Reserved: can add cleanup logic later
});
```

### 5.2 New package.json Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:report": "playwright show-report tests/e2e/report",
    "pretest:e2e": "cross-env DOTENV_CONFIG_PATH=.env.test npm run build"
  }
}
```

> **Note**: `pretest:e2e` automatically builds the application using `.env.test` (`NODE_ENV=production`) before each E2E test run, ensuring that `isDev` in the build output is a runtime check rather than hardcoded to `true`.

### 5.3 TypeScript Configuration

Create `tests/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../../src/shared/*"]
    }
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist", "report", "test-results"]
}
```

### 5.4 .gitignore Additions

```gitignore
# E2E Test Artifacts
tests/e2e/report/
tests/e2e/test-results/
```

---

## 6. Core Fixture Design

### 6.1 Electron App Fixture

This is the core of the entire E2E testing framework, encapsulating Electron application launch and cleanup.

```ts
// tests/e2e/fixtures/electronApp.ts
import { test as base, _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * E2E Test Fixture Type Definitions
 */
type ElectronFixtures = {
  /** Electron application instance */
  electronApp: ElectronApplication;
  /** Main window Page object */
  mainWindow: Page;
  /** Test userData directory */
  testUserDataDir: string;
};

/**
 * Create an isolated test userData directory
 */
function createTestUserDataDir(): string {
  const dirName = `openkosmos-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dirPath = path.join(os.tmpdir(), dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Clean up test userData directory
 */
function cleanupTestUserDataDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    console.warn(`Failed to cleanup test userData: ${dirPath}`, e);
  }
}

export const test = base.extend<ElectronFixtures>({
  testUserDataDir: async ({}, use) => {
    const dir = createTestUserDataDir();
    await use(dir);
    cleanupTestUserDataDir(dir);
  },

  electronApp: async ({ testUserDataDir }, use) => {
    const mainJsPath = path.resolve(__dirname, '../../../dist/main/main.js');

    // Verify build output exists
    if (!fs.existsSync(mainJsPath)) {
      throw new Error(
        `Build output not found at ${mainJsPath}. Run "npm run build" first.`
      );
    }

    const app = await electron.launch({
      args: [
        mainJsPath,
        '--disable-gpu-sandbox',
        '--no-sandbox',
        // Optional: enable specific Feature Flags
        // '--enable-features=kosmosFeatureMemory',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Use isolated userData directory
        KOSMOS_E2E_USER_DATA: testUserDataDir,
      },
    });

    await use(app);
    await app.close();
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the first window to appear
    const window = await electronApp.firstWindow();

    // Wait for the app to be ready (after loading page)
    // In App.tsx, when isAppReady=false, "Initializing Core Services..." is displayed
    await window.waitForFunction(() => {
      // Wait until loading text disappears, indicating isAppReady=true
      const loadingEl = document.querySelector('body');
      return loadingEl && !loadingEl.textContent?.includes('Initializing Core Services');
    }, { timeout: 30_000 });

    await use(window);
  },
});

export { expect };
```

### 6.2 Authentication Helper Fixture

```ts
// tests/e2e/fixtures/authHelper.ts
import * as path from 'path';
import * as fs from 'fs';

/**
 * Pre-seed authentication data into the test userData directory.
 * Used to skip the OAuth Device Flow and directly enter an authenticated state.
 */
export function seedAuthData(userDataDir: string, options?: {
  alias?: string;
  githubToken?: string;
  copilotToken?: string;
}): void {
  const alias = options?.alias || 'e2e-test-user';
  const profileDir = path.join(userDataDir, 'profiles', alias);
  fs.mkdirSync(profileDir, { recursive: true });

  // Write auth.json
  const authData = {
    alias,
    authType: 'github-copilot',
    githubToken: options?.githubToken || process.env.E2E_GITHUB_TOKEN || '',
    copilotToken: options?.copilotToken || process.env.E2E_COPILOT_TOKEN || '',
    tokenExpiry: Date.now() + 3600_000, // Expires in 1 hour
  };

  fs.writeFileSync(
    path.join(profileDir, 'auth.json'),
    JSON.stringify(authData, null, 2)
  );

  // Write basic profile.json
  const profileData = {
    version: 2,
    alias,
    chatConfigs: [],
    agents: [],
    mcpServers: [],
    skills: [],
  };

  fs.writeFileSync(
    path.join(profileDir, 'profile.json'),
    JSON.stringify(profileData, null, 2)
  );
}

/**
 * Bypass authentication via IPC Mock.
 * Inject mock handlers into the Electron main process.
 */
export async function mockAuthInMainProcess(
  electronApp: import('@playwright/test').ElectronApplication
): Promise<void> {
  await electronApp.evaluate(async ({ ipcMain }) => {
    // Remove real auth handler, inject mock
    const mockUser = {
      success: true,
      data: {
        alias: 'mock-e2e-user',
        isAuthenticated: true,
        githubToken: 'mock-github-token',
        copilotToken: 'mock-copilot-token',
      },
    };

    // Override auth-related IPC handlers
    try { ipcMain.removeHandler('signin:getValidUsersForSignin'); } catch {}
    ipcMain.handle('signin:getValidUsersForSignin', () => ({
      success: true,
      data: [{ alias: 'mock-e2e-user', displayName: 'E2E Test User' }],
    }));

    try { ipcMain.removeHandler('auth:getCurrentSession'); } catch {}
    ipcMain.handle('auth:getCurrentSession', () => mockUser);
  });
}
```

### 6.3 Selector Constants

```ts
// tests/e2e/helpers/selectors.ts

/**
 * Global page selectors.
 * Note: If a component does not have a data-testid, use CSS/XPath selectors.
 * It is recommended to gradually add data-testid attributes to key components.
 */
export const Selectors = {
  // Loading state
  LOADING_SCREEN: 'text=Initializing Core Services',

  // Startup page
  STARTUP_PAGE: '[data-testid="startup-page"]',

  // Sign-in page
  SIGN_IN_PAGE: '[data-testid="sign-in-page"]',
  SIGN_IN_BUTTON: 'button:has-text("Sign In")',
  DEVICE_CODE_INPUT: '[data-testid="device-code"]',

  // Agent page
  AGENT_PAGE: '[data-testid="agent-page"]',
  CHAT_INPUT: '[data-testid="chat-input"], textarea[placeholder*="message"]',
  SEND_BUTTON: '[data-testid="send-button"], button[aria-label*="send"]',

  // Navigation
  NAV_SETTINGS: '[data-testid="nav-settings"], a[href*="settings"]',
  NAV_AGENT: '[data-testid="nav-agent"], a[href*="agent"]',

  // Settings page
  SETTINGS_MCP: 'a[href*="settings/mcp"]',
  SETTINGS_RUNTIME: 'a[href*="settings/runtime"]',
  SETTINGS_SKILLS: 'a[href*="settings/skills"]',
  SETTINGS_ABOUT: 'a[href*="settings/about"]',

  // MCP management
  MCP_ADD_SERVER: 'button:has-text("Add")',
  MCP_SERVER_LIST: '[data-testid="mcp-server-list"]',

  // Common
  TOAST_MESSAGE: '[data-testid="toast"]',
  DIALOG_OVERLAY: '[role="dialog"]',
  DIALOG_CONFIRM: 'button:has-text("Confirm")',
  DIALOG_CANCEL: 'button:has-text("Cancel")',
} as const;
```

### 6.4 Navigation Helper Functions

```ts
// tests/e2e/helpers/navigation.ts
import type { Page } from '@playwright/test';

/**
 * Navigate to a specified route (HashRouter)
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  const currentUrl = page.url();
  const baseUrl = currentUrl.split('#')[0];
  await page.goto(`${baseUrl}#${route}`);
  // Wait for route change to take effect
  await page.waitForTimeout(500);
}

/**
 * Wait for route change to the target path
 */
export async function waitForRoute(
  page: Page,
  routePattern: RegExp,
  timeout = 15_000
): Promise<void> {
  await page.waitForURL(routePattern, { timeout });
}

/**
 * Get current HashRouter path
 */
export async function getCurrentRoute(page: Page): Promise<string> {
  const url = page.url();
  const hash = url.split('#')[1] || '/';
  return hash;
}
```

### 6.5 Wait Utility Functions

```ts
// tests/e2e/helpers/waitUtils.ts
import type { Page, ElectronApplication } from '@playwright/test';

/**
 * Wait for the app to fully load (through loading gate)
 */
export async function waitForAppReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => !document.body.textContent?.includes('Initializing Core Services'),
    { timeout }
  );
}

/**
 * Wait for a specific IPC call to complete (via main process evaluate)
 */
export async function waitForIpcReady(
  electronApp: ElectronApplication,
  checkFn: () => Promise<boolean>,
  timeout = 10_000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const ready = await checkFn();
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`IPC readiness check timed out after ${timeout}ms`);
}

/**
 * Wait for network requests to complete (for CDN resource loading)
 */
export async function waitForNetworkIdle(page: Page, timeout = 5_000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    // networkidle may be unstable in Electron, fall back gracefully
    console.warn('Network idle timeout, continuing...');
  });
}
```

---

## 7. Authentication Strategy

Authentication is the biggest challenge in E2E testing. The GitHub Copilot OAuth Device Flow requires manual confirmation in a browser, making it unsuitable for automated testing. Three strategies are provided below:

### Strategy A: Token Pre-Seeding (Recommended for CI)

**Principle**: Pre-write valid authentication tokens into the test userData directory.

```
┌──────────────┐     Pre-seed Token      ┌──────────────┐
│   CI Secret  │ ──────────────────► │  auth.json   │
│  (GitHub)    │                     │  (test dir)   │
└──────────────┘                     └──────────────┘
                                            │
                                     Read by app on startup
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │  Auth passed  │
                                     │  → /loading  │
                                     │  → /agent    │
                                     └──────────────┘
```

**Pros**: Closest to real-world scenarios, all IPC channels work normally
**Cons**: Requires maintaining valid tokens, tokens may expire
**Use Case**: CI/CD environments, using Service Account Tokens

### Strategy B: IPC Mock (Recommended for Local Development)

**Principle**: Replace authentication-related IPC handlers in the main process via `electronApp.evaluate()`.

```
┌──────────────┐    evaluate()     ┌──────────────┐
│  Playwright  │ ────────────────► │  Main Process │
│  Test Code   │                   │  ipcMain      │
└──────────────┘                   └──────┬───────┘
                                          │
                                   Replace auth handler
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  Mock Auth    │
                                   │  Return fake  │
                                   └──────────────┘
```

**Pros**: No real tokens needed, convenient for local development
**Cons**: Does not test the real authentication chain
**Use Case**: Local development, non-authentication feature testing

### Strategy C: Test Only Flows That Do Not Require Authentication

**Principle**: Only test parts that do not require authentication, such as the startup page, login page UI, and error messages.

**Pros**: Simplest approach, no dependencies
**Cons**: Limited coverage
**Use Case**: Quick start, initial phase

### Recommended Approach

| Phase | Strategy | Description |
|------|------|------|
| Phase 1 | C + B | Cover unauthenticated flows first + local Mock |
| Phase 2 | A + B | CI uses pre-seeded tokens, local uses Mock |
| Phase 3 | A | CI uses real tokens exclusively |

---

## 8. Test Case Planning

### 8.1 Startup Flow Tests

```ts
// tests/e2e/startup.e2e.ts
import { test, expect } from '../fixtures/electronApp';

test.describe('Application Startup Flow', () => {
  test('Application window is created successfully', async ({ electronApp }) => {
    const windows = await electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  test('Application title contains OpenKosmos', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const title = await window.title();
    expect(title).toMatch(/OpenKosmos/i);
  });

  test('Redirects to sign-in page when no account exists', async ({ mainWindow }) => {
    // Empty userData directory, should navigate to sign-in page
    await mainWindow.waitForURL(/#\/(login|$)/, { timeout: 20_000 });
  });

  test('Loading page renders correctly then disappears', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    // Verify loading screen eventually disappears
    await window.waitForFunction(
      () => !document.body.textContent?.includes('Initializing Core Services'),
      { timeout: 30_000 }
    );
  });
});
```

### 8.2 Login Page Tests

```ts
// tests/e2e/auth.e2e.ts
import { test, expect } from '../fixtures/electronApp';

test.describe('Sign-in Page', () => {
  test('Sign-in page renders correctly', async ({ mainWindow }) => {
    await mainWindow.waitForURL(/#\/login/, { timeout: 20_000 });

    // Verify sign-in button exists
    const signInButton = mainWindow.locator('button').filter({ hasText: /sign\s*in/i });
    await expect(signInButton).toBeVisible({ timeout: 10_000 });
  });

  test('Clicking sign-in triggers GitHub Device Flow', async ({ mainWindow }) => {
    await mainWindow.waitForURL(/#\/login/, { timeout: 20_000 });

    const signInButton = mainWindow.locator('button').filter({ hasText: /sign\s*in/i });
    await signInButton.click();

    // Verify device code is displayed (OAuth Device Flow UI feedback)
    // Specific selectors need to be adjusted based on actual UI
    await expect(
      mainWindow.locator('text=/[A-Z0-9]{4}-[A-Z0-9]{4}|device|code/i')
    ).toBeVisible({ timeout: 15_000 });
  });
});
```

### 8.3 Authenticated State Tests (Using IPC Mock)

```ts
// tests/e2e/chat.e2e.ts
import { test, expect } from '../fixtures/electronApp';
import { mockAuthInMainProcess } from '../fixtures/authHelper';
import { navigateTo } from '../helpers/navigation';

test.describe('Chat Functionality (Mock Auth)', () => {
  test.beforeEach(async ({ electronApp, mainWindow }) => {
    // Mock authentication, skip sign-in flow
    await mockAuthInMainProcess(electronApp);
  });

  test('Agent page loads correctly', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/agent');

    // Wait for Agent page core elements to load
    await expect(
      mainWindow.locator('textarea, [contenteditable]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Can select an Agent for conversation', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/agent/chat/creation');

    // Verify Agent creation/selection interface
    await expect(
      mainWindow.locator('text=/custom|library|create/i').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

### 8.4 Settings Page Tests

```ts
// tests/e2e/settings.e2e.ts
import { test, expect } from '../fixtures/electronApp';
import { mockAuthInMainProcess } from '../fixtures/authHelper';
import { navigateTo } from '../helpers/navigation';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ electronApp }) => {
    await mockAuthInMainProcess(electronApp);
  });

  test('MCP settings page renders correctly', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/mcp');

    await expect(
      mainWindow.locator('text=/MCP|Server/i').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Runtime settings page renders correctly', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/runtime');

    await expect(
      mainWindow.locator('text=/Runtime/i').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('About page displays version number', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/about');

    // Verify version number format
    await expect(
      mainWindow.locator('text=/\\d+\\.\\d+\\.\\d+/')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Skills settings page renders correctly', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/skills');

    await expect(
      mainWindow.locator('text=/Skill/i').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
```

### 8.5 MCP Server Management Tests

```ts
// tests/e2e/mcp.e2e.ts
import { test, expect } from '../fixtures/electronApp';
import { mockAuthInMainProcess } from '../fixtures/authHelper';
import { navigateTo } from '../helpers/navigation';

test.describe('MCP Server Management', () => {
  test.beforeEach(async ({ electronApp }) => {
    await mockAuthInMainProcess(electronApp);
  });

  test('Can navigate to add MCP server page', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/mcp/new');

    // Verify form elements exist
    await expect(
      mainWindow.locator('input, select, [role="combobox"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('MCP library page loads server list', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/settings/mcp/mcp-library');

    // Verify library page loads
    await expect(
      mainWindow.locator('text=/library|marketplace/i').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
```

### 8.6 Test Coverage Matrix

| Test Module | Estimated Count | Completed | Auth Required | Priority |
|---------|----------------|---------|---------|-------|
| Startup Flow (startup) | 4-6 | ✅ 10 | None | P0 |
| Login Page (auth) | 3-5 | ✅ 10 | None | P0 |
| Mock Auth Flow (device-flow/preseeded/post-auth) | 5-10 | ✅ 9 | Mock | P1 |
| Chat Feature (chat) | 5-8 | ✅ 4 | Mock | P1 |
| Settings Page | 6-10 | — | Mock | P1 |
| MCP Management | 5-8 | — | Mock | P1 |
| Skills Management | 3-5 | — | Mock | P2 |
| Agent Create/Edit | 4-6 | — | Mock | P2 |
| Keyboard Shortcuts | 2-4 | — | Mock | P3 |
| **Total** | **37-60** | **33** | — | — |

---

## 9. CI/CD Integration Plan

### 9.1 GitHub Actions Workflow

```yaml
# .github/workflows/pr-e2e-test.yml
name: PR E2E Tests

# Run Playwright E2E tests for every pull request to catch regressions early.
# Tests launch the Electron app in a headless environment and validate core user flows.

on:
  pull_request:
    branches: ['**']

permissions:
  contents: read

# Only one E2E run allowed per PR at a time (cancel previous)
concurrency:
  group: e2e-test-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  e2e-test:
    name: E2E Tests
    # Use ubuntu for fast CI; Electron runs headless via xvfb
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Electron tests use the bundled Electron binary — no Playwright browsers needed.
      # Only install system dependencies required by Electron on headless Linux.
      - name: Install system dependencies for Electron
        run: npx playwright install-deps

      # pretest:e2e builds with DOTENV_CONFIG_PATH=.env.test
      - name: Run E2E Tests
        run: npm run test:e2e
        env:
          BRAND: openkosmos

      # Upload test report & artifacts (screenshots, video, trace) on failure for debugging
      - name: Upload E2E test report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-test-report
          path: |
            tests/e2e/test-results/
            tests/e2e/report/
          retention-days: 7
```

### 9.2 CI Environment Considerations

| Platform | Notes |
|------|---------|
| **Linux** | Requires `xvfb-run` to provide a virtual display |
| **macOS** | Requires screen recording permissions (for screenshot tests) |
| **Windows** | May require setting the `--disable-gpu` flag |

### 9.3 Performance Optimization Recommendations

- **Build Cache**: Use `actions/cache` to cache `node_modules` and `dist/` directories
- **Phased Testing**: P0 tests run on PR, P2/P3 tests run after merging to main
- **Parallel Matrix**: Run in parallel across platforms, serial execution within each platform

---

## 10. Best Practices & Considerations

### 10.1 data-testid Conventions

To support stable E2E selectors, it is recommended to gradually add `data-testid` attributes to key components:

```tsx
// Naming convention: {module}-{component}-{element}
<div data-testid="chat-input-container">
  <textarea data-testid="chat-input-textarea" />
  <button data-testid="chat-send-button" />
</div>

<nav data-testid="settings-nav">
  <a data-testid="settings-nav-mcp" />
  <a data-testid="settings-nav-runtime" />
</nav>
```

**Naming Rules**:
- Use `kebab-case`
- Format: `{page/area}-{component}-{element}`
- Examples: `agent-chat-input`, `settings-mcp-list`, `auth-signin-button`

### 10.2 Test Stability Principles

1. **Avoid Hardcoded Waits**: Use `waitForSelector` / `waitForURL` instead of `waitForTimeout`
2. **Retry Mechanism**: Configure `retries: 2` in the CI environment
3. **Isolation**: Each test uses an independent userData directory
4. **Idempotency**: Tests do not depend on the results of other tests
5. **Cleanup Strategy**: Clean up test data in `afterEach`

### 10.3 Debugging Tips

```bash
# Run with UI debugger
npm run test:e2e:debug

# Run only a specific test file
npx playwright test tests/e2e/startup.e2e.ts

# View HTML report
npm run test:e2e:report

# Use trace viewer to analyze failures
npx playwright show-trace tests/e2e/test-results/*/trace.zip
```

### 10.4 Performance Considerations

| Strategy | Description |
|------|------|
| Serial Execution | `workers: 1`, avoid multiple Electron instances competing for system resources |
| Timeout Configuration | Electron startup is slow, set individual test timeout to 60s |
| Skip Cold Start | Reuse Electron instances within the same `test.describe` (controlled via Fixture scope) |
| Minimize I/O | Video recording is only retained on failure |

### 10.5 Fixing Existing Jest Configuration

The current `jest.config.js` references non-existent files/directories:

```js
roots: ['<rootDir>/src', '<rootDir>/tests'],           // tests/ does not exist
setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],      // File does not exist
```

**Fix**: Create `tests/setup.ts`:

```ts
// tests/setup.ts
// Jest global test setup
// This file is referenced by setupFilesAfterEnv in jest.config.js

// Extend Jest timeout (some tests may be slow)
jest.setTimeout(30_000);

// Global mock: prevent accidental Electron API calls in tests
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test'),
    setPath: jest.fn(),
    getName: jest.fn(() => 'openkosmos-test'),
    getVersion: jest.fn(() => '0.0.0-test'),
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
  },
  BrowserWindow: jest.fn(),
}), { virtual: true });
```

---

## 11. Implementation Roadmap

### Phase 1: Infrastructure Setup (1-2 days) ✅ Completed (2026-02-24)

```
✅ Completed:
├── [x] Create tests/ directory structure
├── [x] Create tests/setup.ts (fix Jest configuration)
├── [x] Create playwright.config.ts
├── [x] Create core Fixture (electronApp.ts)
├── [x] Create authentication helper (authHelper.ts)
├── [x] Create helper utilities (selectors.ts, navigation.ts, waitUtils.ts)
├── [x] Update package.json with E2E scripts
├── [x] Update .gitignore
├── [x] Create tests/e2e/tsconfig.json
├── [x] Create .env.test (E2E build-specific env config, NODE_ENV=production)
├── [x] Fix webpack.main.config.js — dotenv path supports DOTENV_CONFIG_PATH, argv.mode takes priority over .env.local
├── [x] Fix webpack.renderer.config.js — same as above + DefinePlugin NODE_ENV no longer polluted by .env.local
├── [x] Write startup.e2e.ts and auth.e2e.ts smoke tests (all passing)
└── [x] Verify `npm run test:e2e` is executable ✅
```

### Phase 2: Unauthenticated Test Cases (2-3 days) ✅ Completed (2026-02-24)

```
✅ Completed:
├── [x] startup.e2e.ts — Startup flow tests (10 tests)
├── [x] auth.e2e.ts — Login page UI tests (10 tests)
├── [x] Verify all P0 tests pass — 20/20 passed
└── [x] Add first batch of data-testid to key components
```

### Phase 3: Mock Auth + Chat Test Cases (3-5 days) ✅ Completed (2026-02-25)

```
✅ Completed:
├── [x] Implement authHelper.ts Mock strategy (V3 AuthData + IPC mock)
├── [x] Create mockedApp.ts — 4 fixture variants (Empty/Authenticated/MultiUser/ChatReady)
├── [x] mock-auth-device-flow.e2e.ts — Device flow tests (4 tests)
├── [x] mock-auth-preseeded.e2e.ts — Pre-seeded auth tests (3 tests)
├── [x] mock-auth-post-auth.e2e.ts — Post-auth navigation tests (2 tests)
├── [x] chat.e2e.ts — Chat functionality tests (4 tests): UI validation, send message, AI response, Enter key send
├── [x] Add mockedChatReadyTest fixture (pre-seeded auth + chat-ready environment, mock agentChat IPC)
├── [x] Update selectors.ts — Add chat-related selectors like chat-textarea/send-button/message
└── [x] Verify all Mock tests pass — 13/13 passed, total 33/33 passed
```

### Phase 4: CI/CD Integration (1-2 days) ✅ Completed (2026-02-25)

```
✅ Completed:
├── [x] Create .github/workflows/pr-e2e-test.yml — Auto-run E2E tests on all PRs
├── [x] Ubuntu + xvfb headless Electron environment
├── [x] Concurrency control (auto-cancel previous runs for the same PR)
├── [x] Upload test reports and screenshots/video/trace on failure
└── [x] Remove smoke.e2e.ts, merge test cases into startup/auth
```

### Phase 5: Real Authentication + Advanced Tests (Ongoing Iteration)

```
✅ Task List:
├── Implement Token pre-seeding strategy
├── Complete chat send/receive flow tests
├── Skills management tests
├── Keyboard shortcut tests
└── Performance benchmark tests
```

### Timeline Overview

```
Week 1                          Week 2                        Week 3+
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐
│  Phase 1: Infra   │  │  Phase 3: Mock Auth  │  │  Phase 5: Advanced Tests       │
│  Phase 2: NoAuth │  │  Phase 4: CI/CD     │  │  Ongoing iteration          │
└──────────────────┘  └──────────────────────┘  └──────────────────────────┘
```

---

## Appendix

### A. Playwright Electron API Quick Reference

```ts
import { _electron as electron } from '@playwright/test';

// Launch application
const app = await electron.launch({ args: ['main.js'] });

// Get window
const window = await app.firstWindow();
const allWindows = await app.windows();

// Execute code in the main process
const result = await app.evaluate(async ({ app, BrowserWindow, ipcMain }) => {
  return app.getVersion();
});

// Execute code in the renderer process
const domResult = await window.evaluate(() => {
  return document.title;
});

// Screenshot
await window.screenshot({ path: 'screenshot.png' });

// Close application
await app.close();
```

### B. HashRouter URL Matching Patterns

```ts
// Match root route
await expect(page).toHaveURL(/#\//);

// Match /agent route
await expect(page).toHaveURL(/#\/agent/);

// Match route with parameters
await expect(page).toHaveURL(/#\/agent\/chat\/[\w-]+/);

// Match settings sub-route
await expect(page).toHaveURL(/#\/settings\/mcp/);
```

### C. Related Reference Resources

- [Playwright Electron Documentation](https://playwright.dev/docs/api/class-electron)
- [Playwright Test Configuration](https://playwright.dev/docs/test-configuration)
- [Electron Testing Best Practices](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Vercel AI SDK Testing](https://sdk.vercel.ai/docs/guides/testing)

### D. Environment Variable List

| Variable | Purpose | Default |
|--------|------|--------|
| `E2E_GITHUB_TOKEN` | GitHub Token for CI authentication | — |
| `E2E_COPILOT_TOKEN` | Copilot Token for CI authentication | — |
| `KOSMOS_E2E_USER_DATA` | Test userData path | `os.tmpdir()` |
| `CI` | Whether in CI environment | `false` |

### E. Common Troubleshooting

| Problem | Cause | Solution |
|------|------|---------|
| App fails to start | Not built | Run `npm run build` |
| Window not visible | Headless mode | Use the `--headed` flag |
| Timeout failure | Slow app startup | Increase timeout, check `waitForSelector` |
| Linux CI failure | No display | Use `xvfb-run` |
| Auth failure | Token expired | Refresh token in CI Secrets |
| Selector not found | UI changed | Add `data-testid`, update selectors |

