// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateRoot = vi.hoisted(() => vi.fn());
const mockRootRender = vi.hoisted(() => vi.fn());
const mockRecordCrashBreadcrumb = vi.hoisted(() => vi.fn());
const mockReportRendererError = vi.hoisted(() => vi.fn());
const mockFeatureFlagInit = vi.hoisted(() => vi.fn());
const mockModelCacheInit = vi.hoisted(() => vi.fn());
const mockModelCacheGetInfo = vi.hoisted(() => vi.fn(() => ({ size: 1 })));
const appState = vi.hoisted(() => ({ shouldThrow: false }));
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockAppDataGetConfig = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
}));

vi.mock('../styles/globals.css', () => ({}));
vi.mock('../styles/Common.css', () => ({}));

vi.mock('../App', () => ({
  default: () => {
    if (appState.shouldThrow) {
      throw new Error('render failed');
    }
    return <div data-testid="app" />;
  },
}));

vi.mock('../atom', () => ({
  WithStore: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../lib/utilities/logger', () => ({
  logger: {
    startup: vi.fn(),
    system: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: mockLoggerError,
  },
}));

vi.mock('../lib/models/modelCacheManager', () => ({
  modelCacheManager: {
    initialize: mockModelCacheInit,
    getCacheInfo: mockModelCacheGetInfo,
  },
}));

vi.mock('../lib/featureFlags', () => ({
  featureFlagCacheManager: {
    initialize: mockFeatureFlagInit,
  },
}));

vi.mock('../lib/userData/appDataManager', () => ({
  appDataManager: {
    getConfig: mockAppDataGetConfig,
  },
}));

function installElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      recordCrashBreadcrumb: mockRecordCrashBreadcrumb,
      reportRendererError: mockReportRendererError,
    },
  });
}

function installRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
}

async function importEntry() {
  await import('../index');
}

describe('renderer entry additional coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    appState.shouldThrow = false;
    mockAppDataGetConfig.mockReturnValue({});
    mockCreateRoot.mockReturnValue({ render: mockRootRender });
    mockFeatureFlagInit.mockResolvedValue(undefined);
    mockModelCacheInit.mockReturnValue(undefined);
    installElectronApi();
  });

  it('serializes bigint arrays and functions in global error metadata', async () => {
    installRoot();
    await importEntry();
    mockReportRendererError.mockClear();

    function namedFailure() {
      return 'boom';
    }

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'metadata',
      error: [1n, namedFailure],
    }));

    expect(mockReportRendererError).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        error: ['1', '[Function namedFailure]'],
      },
    }));
  });

  it('renders root error fallback and reports boundary failures', async () => {
    installRoot();
    appState.shouldThrow = true;
    mockAppDataGetConfig.mockReturnValue({ uiLanguage: 'zh-CN' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalReload = window.location.reload;
    const reload = vi.fn();
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reload,
    });

    await importEntry();
    render(mockRootRender.mock.calls[0][0]);
    const { translate } = await import('../lib/i18n');

    expect(screen.getByText(translate('zh-CN', 'app.rootError.title'))).toBeTruthy();
    fireEvent.click(screen.getByText(translate('zh-CN', 'app.rootError.reload')));
    expect(reload).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith(
      '[Startup] Root error boundary caught renderer error:',
      expect.any(Error),
      expect.any(Object),
    );

    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: originalReload,
    });
    consoleError.mockRestore();
  });

  it('throws when the root element is missing', async () => {
    await expect(importEntry()).rejects.toThrow('Failed to find the root element');
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it('logs cache initialization failures after rendering', async () => {
    installRoot();
    mockFeatureFlagInit.mockRejectedValueOnce(new Error('feature flag failed'));
    mockModelCacheInit.mockImplementationOnce(() => {
      throw new Error('model cache failed');
    });

    await importEntry();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRootRender).toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      '[Startup] Failed to initialize feature flags cache:',
      expect.any(Error),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      '[Startup] Failed to initialize model cache:',
      expect.any(Error),
    );
  });
});
