# Kosmos E2E Testing Technical Plan — Based on Playwright

> **Version**: 1.0
> **Updated**: 2026-02-24
> **Author**: Claude Code
> **Status**: Technical Feasibility Analysis & Implementation Plan

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feasibility Analysis](#2-feasibility-analysis)
3. [Technical Architecture Design](#3-technical-architecture-design)
4. [Directory Structure Plan](#4-directory-structure-plan)
5. [Environment Configuration](#5-environment-configuration)
6. [Core Fixture Design](#6-core-fixture-design)
7. [Authentication Strategy](#7-authentication-strategy)
8. [Test Case Plan](#8-test-case-plan)
9. [CI/CD Integration](#9-cicd-integration)
10. [Notes and Best Practices](#10-notes-and-best-practices)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Appendix](#appendix)

---

## 1. Overview

### 1.1 Background

OpenKosmos AI Studio is an AI assistant desktop application built on Electron + React. The project currently has only **6 unit test files** (all in `__tests__` directories under `src/main/lib/`), with no end-to-end (E2E) tests at all. As feature iteration accelerates, there is an urgent need to establish an E2E testing framework to ensure stability of core user flows.

### 1.2 Goals

- Establish an E2E testing framework based on the Playwright Electron API
- Cover core user flows: launch → authenticate → chat → settings → Agent management
- Support both local development and CI/CD run modes
- Not interfere with the existing Jest unit testing setup

### 1.3 Why Playwright

| Comparison | Playwright | Spectron (deprecated) | WebDriverIO | Cypress |
|---------|------------|-------------------|-------------|---------|
| Native Electron support | ✅ `_electron.launch()` | ❌ Maintenance stopped | ⚠️ Complex config | ❌ No Electron |
| Multi-window support | ✅ `app.windows()` | ✅ | ⚠️ Limited | ❌ |
| Main process access | ✅ `app.evaluate()` | ✅ | ❌ | ❌ |
| TypeScript support | ✅ First-class | ⚠️ | ✅ | ✅ |
| Community activity | ⭐⭐⭐⭐⭐ | ❌ Deprecated | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Already installed | ✅ `^1.58.0` | — | — | — |

**Conclusion**: Playwright is the best choice for Electron E2E testing, and the project already has the dependency installed.

---

## 2. Feasibility Analysis

### 2.1 ✅ Favorable Conditions

| Condition | Details |
|------|------|
| **Playwright already installed** | `"playwright": "^1.58.0"` is in `devDependencies` |
| **Webpack already externalizes** | `webpack.main.config.js` already treats `playwright` / `playwright-core` as external modules |
| **electron-builder already excludes browsers** | `!**/node_modules/playwright*/.local-browsers/**` already excluded from packaging |
| **BrowserWindow sandbox disabled** | `sandbox: false` — a hard requirement for Playwright Electron API |
| **contextIsolation enabled** | Secure preload bridge pattern, fully compatible with Playwright |
| **Build output available** | `dist/main/main.js` can be used directly as Electron launch entry |

### 2.2 ⚠️ Issues to Resolve

#### A. App Readiness Gate

The App component shows a loading page before backend services are ready:

```tsx
// src/renderer/App.tsx
if (!isAppReady) {
  return <div>Initializing Core Services...</div>;
}
```

**Solution**: E2E tests need to use `waitForSelector` to wait for loading to complete before interacting.

#### B. GitHub OAuth Device Code Authentication Flow

Authentication uses the GitHub Copilot OAuth Device Flow, requiring user confirmation in a browser:

```
User → App requests device code → GitHub returns device code → User confirms in browser → App gets Token
```

**Solution**: Provide three authentication strategies (see Section 7).

#### C. HashRouter Routing

All routes use `HashRouter`, with URL format `/#/path`:

```tsx
<HashRouter>
  <AppRoutes />
</HashRouter>
```

**Solution**: URL assertions use regex matching `/#/` prefix.

#### D. Multi-Window Architecture

The app may have multiple windows open simultaneously:

| Window | HTML Entry | Purpose |
|------|----------|------|
| Main | `index.html` | Main application |
| Screenshot | `screenshot.html` | Screenshot overlay |

**Solution**: Use `electronApp.windows()` to get window list, filter by URL or title to find target window.

#### E. userData Path Isolation

`bootstrap.ts` sets the brand-specific `userData` path on startup:

```ts
app.setPath('userData', path.join(app.getPath('appData'), userDataName));
```

**Solution**: E2E tests inject an independent test data directory via environment variable, avoiding contamination of real user data.

#### F. Feature Flag Control

Some pages are behind Feature Flags (e.g., Memory, Voice Input only available in dev mode):

| Feature Flag | Default Condition |
|-------------|---------|
| `kosmosFeatureMemory` | dev mode (excluding win32-arm64) |
| `kosmosFeatureVoiceInput` | dev mode |
| `browserControl` | dev + win32 |

**Solution**: Set `NODE_ENV=development` on E2E startup or use `--enable-features` CLI argument.

### 2.3 Feasibility Conclusion

| Dimension | Assessment |
|------|------|
| Playwright compatibility | ✅ Fully compatible |
| Infrastructure readiness | ✅ Dependencies installed, build config ready |
| Authentication complexity | ⚠️ Requires Token pre-seeding or IPC Mock |
| Multi-window handling | ⚠️ Needs window selection logic |
| Existing test infrastructure | ⚠️ `tests/` directory and `tests/setup.ts` missing |
| **Overall feasibility** | **✅ Highly feasible, low adaptation cost** |

---

## 3. Technical Architecture Design

### 3.1 Test Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          E2E Test Layer                          │
│                     tests/e2e/*.e2e.ts                           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │  Startup   │ │    Auth    │ │    Chat    │ │  Settings/   │  │
│  │   Tests    │ │   Tests    │ │   Tests    │ │    MCP       │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────┬───────┘  │
│        └───────────────┴──────────────┴───────────────┘          │
│                              │                                   │
│                    ┌─────────┴──────────┐                        │
│                    │   Test Fixtures    │                        │
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

### 3.2 Test Layer Hierarchy

```
┌─────────────────────────────────────────────────────┐
│            E2E Tests (Playwright + Electron)          │  ← This plan
│         Complete user flows, real Electron env       │
├─────────────────────────────────────────────────────┤
│          Integration Tests (Jest + jsdom)            │  ← Future extension
│         Component interaction tests, Mock IPC        │
├─────────────────────────────────────────────────────┤
│            Unit Tests (Jest + ts-vitest)             │  ← Existing
│         Pure logic tests, no Electron dependencies   │
└─────────────────────────────────────────────────────┘
```

### 3.3 Isolation Strategy from Existing Jest Tests

| Dimension | Jest Unit Tests | Playwright E2E |
|------|-------------|----------------|
| Config file | `vitest.config.js` | `playwright.config.ts` |
| Test directory | `src/**/__tests__/` | `tests/e2e/` |
| File naming | `*.test.ts` | `*.e2e.ts` |
| Run command | `npm test` | `npm run test:e2e` |
| Run environment | Node.js | Electron Application |
| Parallelism | Jest Worker Pool | Playwright Worker |

The two test systems are completely isolated via different config files and commands.

---

## 4. Directory Structure Plan

```
tests/
├── setup.ts                        # Jest setup (fixes existing vitest.config.js reference)
├── e2e/
│   ├── fixtures/
│   │   ├── electronApp.ts          # Electron launch fixture (core)
│   │   ├── authHelper.ts           # Authentication helper
│   │   └── testDataManager.ts      # Test data management (create/cleanup)
│   ├── helpers/
│   │   ├── selectors.ts            # Common selector constants
│   │   ├── waitUtils.ts            # Wait utility functions
│   │   └── navigation.ts           # Navigation helper functions
│   ├── startup.e2e.ts              # Startup flow tests
│   ├── auth.e2e.ts                 # Authentication flow tests
│   ├── chat.e2e.ts                 # Chat feature tests
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

### 5.1 Playwright Config File

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
  retries: process.env.CI ? 2 : 0,    // Retry 2 times in CI

  /* Parallelism control */
  workers: 1,                // Serial execution recommended for Electron tests to avoid resource contention
  fullyParallel: false,

  /* Reporters */
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

  /* Screenshots and video */
  use: {
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    trace: 'retain-on-failure',
  },

  /* Output directory */
  outputDir: 'tests/e2e/test-results',

  /* Global Setup/Teardown */
  globalSetup: undefined,     // Reserved: can add global auth token acquisition later
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

> **Note**: `pretest:e2e` automatically builds the app using `.env.test` (`NODE_ENV=production`) before each E2E test run, ensuring the compiled output has `isDev` as a runtime check rather than hardcoded `true`.

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

This is the core of the entire E2E test, encapsulating Electron app launch and cleanup.

```ts
// tests/e2e/fixtures/electronApp.ts
import { test as base, _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * E2E Test Fixture type definitions
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
  const dirName = `kosmos-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        OpenKosmos_E2E_USER_DATA: testUserDataDir,
      },
    });

    await use(app);
    await app.close();
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for first window to appear
    const window = await electronApp.firstWindow();

    // Wait for app to be ready (past the loading page)
    // App.tsx shows "Initializing Core Services..." when isAppReady=false
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
 * Pre-seed authentication data to test userData directory
 * Used to skip OAuth Device Flow and enter authenticated state directly
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
    tokenExpiry: Date.now() + 3600_000, // expires in 1 hour
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
 * Bypass authentication via IPC Mock
 * Injects mock handler into Electron main process
 */
export async function mockAuthInMainProcess(
  electronApp: import('@playwright/test').ElectronApplication
): Promise<void> {
  await electronApp.evaluate(async ({ ipcMain }) => {
    // Remove real auth handler and inject mock
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
 * Global page selectors
 * Note: If components don't have data-testid, use CSS/XPath selectors
 * Recommend progressively adding data-testid to key components
 */
export const Selectors = {
  // Loading state
  LOADING_SCREEN: 'text=Initializing Core Services',

  // Startup page
  STARTUP_PAGE: '[data-testid="startup-page"]',

  // Login page
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

  // General
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
 * Navigate to the specified route (HashRouter)
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  const currentUrl = page.url();
  const baseUrl = currentUrl.split('#')[0];
  await page.goto(`${baseUrl}#${route}`);
  // Wait for route change to take effect
  await page.waitForTimeout(500);
}

/**
 * Wait for route to change to target path
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
 * Wait for app to fully load (past loading gate)
 */
export async function waitForAppReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => !document.body.textContent?.includes('Initializing Core Services'),
    { timeout }
  );
}

/**
 * Wait for specific IPC call to complete (via main process evaluate)
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
 * Wait for network requests to complete (for waiting on CDN resource loads)
 */
export async function waitForNetworkIdle(page: Page, timeout = 5_000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    // networkidle may be unstable in Electron, degrade gracefully
    console.warn('Network idle timeout, continuing...');
  });
}
```

---

## 7. Authentication Strategy

Authentication is the biggest challenge in E2E testing. GitHub Copilot OAuth Device Flow requires manual browser confirmation and is not suitable for automation. Three strategies are provided below:

### Strategy A: Token Pre-seeding (Recommended for CI)

**Principle**: Pre-write valid authentication tokens to the test userData directory.

```
┌──────────────┐     Pre-seed Token      ┌──────────────┐
│   CI Secret  │ ──────────────────────► │  auth.json   │
│  (GitHub)    │                         │  (test dir)  │
└──────────────┘                         └──────────────┘
                                                │
                                         App reads on startup
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │  Auth passed │
                                         │  → /loading  │
                                         │  → /agent    │
                                         └──────────────┘
```

**Pros**: Closest to real scenario, all IPC channels work normally
**Cons**: Need to maintain valid tokens, risk of token expiry
**Use case**: CI/CD environments, using Service Account Token

### Strategy B: IPC Mock (Recommended for Local Development)

**Principle**: Replace auth-related IPC handlers in the main process via `electronApp.evaluate()`.

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
                                   │  Mock Auth   │
                                   │  Return fake │
                                   │  Token       │
                                   └──────────────┘
```

**Pros**: No real Token needed, convenient for local development
**Cons**: Does not test real auth chain
**Use case**: Local development, testing non-auth features

### Strategy C: Test Only Auth-Free Flows

**Principle**: Only test startup page, login page UI, error messages, etc. that don't require authentication.

**Pros**: Simplest, no dependencies
**Cons**: Limited coverage
**Use case**: Quick start, initial phase

### Recommended Approach

| Phase | Strategy | Description |
|------|------|------|
| Phase 1 | C + B | Cover auth-free flows first + local Mock |
| Phase 2 | A + B | CI uses pre-seeded tokens, local uses Mock |
| Phase 3 | A | CI fully uses real tokens |

---

## 8. Test Case Plan

### 8.1 Startup Flow Tests

```ts
// tests/e2e/startup.e2e.ts
import { test, expect } from '../fixtures/electronApp';

test.describe('App Startup Flow', () => {
  test('App window created successfully', async ({ electronApp }) => {
    const windows = await electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  test('App title contains OpenKosmos', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const title = await window.title();
    expect(title).toMatch(/OpenKosmos/i);
  });

  test('Redirects to login page without account', async ({ mainWindow }) => {
    // Empty userData directory, should navigate to login page
    await mainWindow.waitForURL(/#\/(login|$)/, { timeout: 20_000 });
  });

  test('Loading page displays correctly then disappears', async ({ electronApp }) => {
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

test.describe('Login Page', () => {
  test('Login page renders correctly', async ({ mainWindow }) => {
    await mainWindow.waitForURL(/#\/login/, { timeout: 20_000 });

    // Verify login button exists
    const signInButton = mainWindow.locator('button').filter({ hasText: /sign\s*in/i });
    await expect(signInButton).toBeVisible({ timeout: 10_000 });
  });

  test('Clicking login triggers GitHub Device Flow', async ({ mainWindow }) => {
    await mainWindow.waitForURL(/#\/login/, { timeout: 20_000 });

    const signInButton = mainWindow.locator('button').filter({ hasText: /sign\s*in/i });
    await signInButton.click();

    // Verify device code is displayed (UI feedback for OAuth Device Flow)
    // Specific selector needs to be adjusted based on actual UI
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

test.describe('Chat Features (Mock Auth)', () => {
  test.beforeEach(async ({ electronApp, mainWindow }) => {
    // Mock auth, skip login flow
    await mockAuthInMainProcess(electronApp);
  });

  test('Agent page loads correctly', async ({ mainWindow }) => {
    await navigateTo(mainWindow, '/agent');

    // Wait for core elements of Agent page to load
    await expect(
      mainWindow.locator('textarea, [contenteditable]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Can select Agent for chat', async ({ mainWindow }) => {
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

| Test Module | Estimated Tests | Actual Completed | Auth Required | Priority |
|---------|----------------|---------|---------|-------|
| Startup flow (startup) | 4-6 | ✅ 10 | None | P0 |
| Login page (auth) | 3-5 | ✅ 10 | None | P0 |
| Mock auth flow (device-flow/preseeded/post-auth) | 5-10 | ✅ 9 | Mock | P1 |
| Chat features (chat) | 5-8 | ✅ 4 | Mock | P1 |
| Settings page | 6-10 | — | Mock | P1 |
| MCP management | 5-8 | — | Mock | P1 |
| Skills management | 3-5 | — | Mock | P2 |
| Agent create/edit | 4-6 | — | Mock | P2 |
| Multi-window (Toolbar) | 2-3 | — | Mock | P3 |
| Keyboard shortcuts | 2-4 | — | Mock | P3 |
| **Total** | **39-63** | **33** | — | — |

---

## 9. CI/CD Integration

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
          BRAND: kosmos

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

### 9.2 CI Environment Notes

| Platform | Notes |
|------|---------|
| **Linux** | Requires `xvfb-run` to provide virtual display |
| **macOS** | May need screen recording permission authorization (for screenshot tests) |
| **Windows** | May need `--disable-gpu` parameter |

### 9.3 Performance Optimization Recommendations

- **Build cache**: Use `actions/cache` to cache `node_modules` and `dist/` directories
- **Staged testing**: P0 tests run on PR, P2/P3 tests run after merging to main
- **Parallel matrix**: Run in parallel by platform, serial within a single platform

---

## 10. Notes and Best Practices

### 10.1 data-testid Convention

To support stable E2E selectors, progressively add `data-testid` attributes to key components:

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

**Naming rules**:
- Use `kebab-case`
- Format: `{page/area}-{component}-{element}`
- Examples: `agent-chat-input`, `settings-mcp-list`, `auth-signin-button`

### 10.2 Test Stability Principles

1. **Avoid hardcoded waits**: Use `waitForSelector` / `waitForURL` instead of `waitForTimeout`
2. **Retry mechanism**: Configure `retries: 2` in CI environment
3. **Isolation**: Each test uses an independent userData directory
4. **Idempotency**: Tests do not depend on results from other tests
5. **Cleanup strategy**: Clean up test data in `afterEach`

### 10.3 Debugging Tips

```bash
# Run with UI debugger
npm run test:e2e:debug

# Run only a specific test file
npx playwright test tests/e2e/startup.e2e.ts

# View HTML report
npm run test:e2e:report

# Analyze failures with trace viewer
npx playwright show-trace tests/e2e/test-results/*/trace.zip
```

### 10.4 Performance Notes

| Strategy | Description |
|------|------|
| Serial execution | `workers: 1`, avoid multiple Electron instances competing for system resources |
| Timeout configuration | Electron startup is slow; set single test timeout to 60s |
| Skip cold start | Reuse Electron instance within same `test.describe` (controlled via Fixture scope) |
| Minimize I/O | Video recording retained only on failure |

### 10.5 Fix Existing Jest Configuration

The current `vitest.config.js` references files/directories that don't exist:

```js
roots: ['<rootDir>/src', '<rootDir>/tests'],           // tests/ doesn't exist
setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],      // file doesn't exist
```

**Fix**: Create `tests/setup.ts`:

```ts
// tests/setup.ts
// Jest global test setup
// This file is referenced by setupFilesAfterEnv in vitest.config.js

// Extend Jest timeout (some tests may be slow)
vitest.setTimeout(30_000);

// Global mock: prevent accidental Electron API calls in tests
vitest.mock('electron', () => ({
  app: {
    getPath: vitest.fn(() => '/tmp/test'),
    setPath: vitest.fn(),
    getName: vitest.fn(() => 'kosmos-test'),
    getVersion: vitest.fn(() => '0.0.0-test'),
  },
  ipcMain: {
    handle: vitest.fn(),
    on: vitest.fn(),
    removeHandler: vitest.fn(),
  },
  BrowserWindow: vitest.fn(),
}), { virtual: true });
```

---

## 11. Implementation Roadmap

### Phase 1: Infrastructure Setup (1-2 days) ✅ Completed (2026-02-24)

```
✅ Completed:
├── [x] Create tests/ directory structure
├── [x] Create tests/setup.ts (fix Jest config)
├── [x] Create playwright.config.ts
├── [x] Create core Fixture (electronApp.ts)
├── [x] Create auth helper (authHelper.ts)
├── [x] Create helpers (selectors.ts, navigation.ts, waitUtils.ts)
├── [x] Update package.json with E2E scripts
├── [x] Update .gitignore
├── [x] Create tests/e2e/tsconfig.json
├── [x] Create .env.test (E2E build-specific env config, NODE_ENV=production)
├── [x] Fix webpack.main.config.js — dotenv path supports DOTENV_CONFIG_PATH, argv.mode takes priority over .env.local
├── [x] Fix webpack.renderer.config.js — same + DefinePlugin NODE_ENV no longer polluted by .env.local
├── [x] Write startup.e2e.ts and auth.e2e.ts smoke tests (all passing)
└── [x] Verify `npm run test:e2e` executes ✅
```

### Phase 2: Auth-Free Test Cases (2-3 days) ✅ Completed (2026-02-24)

```
✅ Completed:
├── [x] startup.e2e.ts — startup flow tests (10 tests)
├── [x] auth.e2e.ts — login page UI tests (10 tests)
├── [x] Verify all P0 tests pass — 20/20 passed
└── [x] Add first batch of data-testid to key components
```

### Phase 3: Mock Auth + Chat Test Cases (3-5 days) ✅ Completed (2026-02-25)

```
✅ Completed:
├── [x] Implement authHelper.ts Mock strategy (V3 AuthData + IPC mock)
├── [x] Create mockedApp.ts — 4 fixture variants (Empty/Authenticated/MultiUser/ChatReady)
├── [x] mock-auth-device-flow.e2e.ts — device flow tests (4 tests)
├── [x] mock-auth-preseeded.e2e.ts — pre-seeded auth tests (3 tests)
├── [x] mock-auth-post-auth.e2e.ts — post-auth navigation tests (2 tests)
├── [x] chat.e2e.ts — chat feature tests (4 tests): UI verification, send message, AI response, Enter key send
├── [x] Add mockedChatReadyTest fixture (pre-seeded auth + chat-ready env, mock agentChat IPC)
├── [x] Update selectors.ts — add chat-textarea/send-button/message and other chat selectors
└── [x] Verify all Mock tests pass — 13/13 passed, total 33/33 passed
```

### Phase 4: CI/CD Integration (1-2 days) ✅ Completed (2026-02-25)

```
✅ Completed:
├── [x] Create .github/workflows/pr-e2e-test.yml — auto-run E2E tests for all PRs
├── [x] Ubuntu + xvfb headless Electron environment
├── [x] Concurrency control (auto-cancel previous run for same PR)
├── [x] Upload test reports and screenshots/video/trace on failure
└── [x] Delete smoke.e2e.ts, test cases merged into startup/auth
```

### Phase 5: Real Auth + Advanced Tests (Continuous Iteration)

```
✅ Task List:
├── Implement Token pre-seeding strategy
├── Full chat send/receive flow tests
├── Skills management tests
├── Multi-window tests (Toolbar)
├── Keyboard shortcut tests
└── Performance benchmark tests
```

### Timeline Overview

```
Week 1                          Week 2                        Week 3+
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐
│  Phase 1: Setup  │  │  Phase 3: Mock Auth  │  │  Phase 5: Advanced Tests │
│  Phase 2: No Auth│  │  Phase 4: CI/CD      │  │  Continuous Iteration    │
└──────────────────┘  └──────────────────────┘  └──────────────────────────┘
```

---

## Appendix

### A. Playwright Electron API Quick Reference

```ts
import { _electron as electron } from '@playwright/test';

// Launch app
const app = await electron.launch({ args: ['main.js'] });

// Get windows
const window = await app.firstWindow();
const allWindows = await app.windows();

// Execute code in main process
const result = await app.evaluate(async ({ app, BrowserWindow, ipcMain }) => {
  return app.getVersion();
});

// Execute code in renderer process
const domResult = await window.evaluate(() => {
  return document.title;
});

// Screenshot
await window.screenshot({ path: 'screenshot.png' });

// Close app
await app.close();
```

### B. HashRouter URL Match Patterns

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

### C. Related Resources

- [Playwright Electron Documentation](https://playwright.dev/docs/api/class-electron)
- [Playwright Test Configuration](https://playwright.dev/docs/test-configuration)
- [Electron Testing Best Practices](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Vercel AI SDK Testing](https://sdk.vercel.ai/docs/guides/testing)

### D. Environment Variables

| Variable | Purpose | Default |
|--------|------|--------|
| `E2E_GITHUB_TOKEN` | GitHub Token for CI auth | — |
| `E2E_COPILOT_TOKEN` | Copilot Token for CI auth | — |
| `OpenKosmos_E2E_USER_DATA` | Test userData path | `os.tmpdir()` |
| `CI` | Whether CI environment | `false` |

### E. Common Troubleshooting

| Issue | Cause | Solution |
|------|------|---------|
| App fails to launch | Not built | Run `npm run build` |
| Window not visible | Headless mode | Use `--headed` parameter |
| Timeout failure | App startup slow | Increase timeout, check `waitForSelector` |
| Linux CI failure | No display | Use `xvfb-run` |
| Auth failure | Token expired | Refresh Token in CI Secrets |
| Selector not found | UI changed | Add `data-testid`, update selectors |
