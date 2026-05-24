import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './styles/Common.css';
import { logger } from './lib/utilities/logger';
import { modelCacheManager } from './lib/models/modelCacheManager';
import { featureFlagCacheManager } from './lib/featureFlags';
import { WithStore } from './atom';

function serializeUnknown(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeUnknown(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeUnknown(nestedValue)]),
    );
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  return value;
}

async function recordCrashBreadcrumb(message: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await window.electronAPI?.recordCrashBreadcrumb?.(message, metadata);
  } catch {
    // Intentionally swallow renderer-side crash reporting failures.
  }
}

async function reportRendererError(report: {
  kind: 'error' | 'unhandledrejection' | 'react-error-boundary';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  componentStack?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await window.electronAPI?.reportRendererError?.(report);
  } catch {
    // Intentionally swallow renderer-side crash reporting failures.
  }
}

window.addEventListener('error', (event) => {
  void reportRendererError({
    kind: 'error',
    message: event.message || 'Unknown renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    url: window.location.href,
    metadata: {
      error: serializeUnknown(event.error),
    },
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);

  void reportRendererError({
    kind: 'unhandledrejection',
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
    url: window.location.href,
    metadata: {
      reason: serializeUnknown(reason),
    },
  });
});

class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error('[Startup] Root error boundary caught renderer error:', error, info);
    void reportRendererError({
      kind: 'react-error-boundary',
      message: error.message,
      stack: error.stack,
      url: window.location.href,
      componentStack: info.componentStack || undefined,
      metadata: {
        errorName: error.name,
      },
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#888', background: '#1a1a1a' }}>
          <p style={{ fontSize: '16px', marginBottom: '20px' }}>Something went wrong.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', fontSize: '14px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: '#ccc', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Global type definitions are automatically loaded from ./types/global.d.ts

// Startup logs - also displayed in production mode
logger.startup('OpenKosmos App renderer process started!');
logger.system('Current time:', new Date().toLocaleString());
logger.system('Environment:', process.env.NODE_ENV);
logger.debug('User agent:', navigator.userAgent);
void recordCrashBreadcrumb('renderer-startup', {
  href: window.location.href,
  userAgent: navigator.userAgent,
  nodeEnv: process.env.NODE_ENV,
});

document.addEventListener('DOMContentLoaded', () => {
  logger.debug('DOM content loaded');
  void recordCrashBreadcrumb('renderer-dom-content-loaded', {
    href: window.location.href,
  });
});

const container = document.getElementById('root');
if (!container) {
  logger.error('Failed to find the root element');
  throw new Error('Failed to find the root element');
}

logger.verbose('Root element found, creating React root');
const root = createRoot(container);

// 🚀 Initialize various cache managers (async, non-blocking for rendering)
(async () => {
  // Initialize Feature Flags cache manager
  try {
    logger.info('[Startup] Initializing feature flags cache manager...');
    await featureFlagCacheManager.initialize();
    logger.success('[Startup] Feature flags cache initialized successfully');
  } catch (error) {
    logger.error('[Startup] Failed to initialize feature flags cache:', error);
  }

  // Initialize model cache manager (passive sync mode: register listener, wait for backend push)
  try {
    logger.info('[Startup] Initializing model cache manager (passive sync)...');
    modelCacheManager.initialize();
    logger.success('[Startup] Model cache initialized — waiting for backend models:updated notification');

    // Print cache info
    const cacheInfo = modelCacheManager.getCacheInfo();
    logger.debug('[Startup] Model cache info:', cacheInfo);
  } catch (error) {
    logger.error('[Startup] Failed to initialize model cache:', error);
  }
})();

root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <WithStore><App /></WithStore>
    </RootErrorBoundary>
  </React.StrictMode>
);

logger.success('App rendered successfully');
void recordCrashBreadcrumb('renderer-app-rendered', {
  href: window.location.href,
});
