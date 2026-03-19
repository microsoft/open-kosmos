import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './styles/Common.css';
import { logger } from './lib/utilities/logger';
import { modelCacheManager } from './lib/models/modelCacheManager';
import { featureFlagCacheManager } from './lib/featureFlags';

// Global type definitions are automatically loaded from ./types/global.d.ts

// Startup logs - also displayed in production mode
logger.startup('KOSMOS App renderer process started!');
logger.system('Current time:', new Date().toLocaleString());
logger.system('Environment:', process.env.NODE_ENV);
logger.debug('User agent:', navigator.userAgent);

document.addEventListener('DOMContentLoaded', () => {
  logger.debug('DOM content loaded');
});

const container = document.getElementById('root');
if (!container) {
  logger.error('Failed to find the root element');
  throw new Error('Failed to find the root element');
}

logger.verbose('Root element found, creating React root');
const root = createRoot(container);

// 🚀 Initialize various cache managers (async, non-blocking rendering)
(async () => {
  // Initialize feature flags cache manager
  try {
    logger.info('[Startup] Initializing feature flags cache manager...');
    await featureFlagCacheManager.initialize();
    logger.success('[Startup] Feature flags cache initialized successfully');
  } catch (error) {
    logger.error('[Startup] Failed to initialize feature flags cache:', error);
  }

  // Initialize model cache manager
  try {
    logger.info('[Startup] Initializing model cache manager...');
    await modelCacheManager.initialize();
    logger.success('[Startup] Model cache initialized successfully');
    
    // Print cache info
    const cacheInfo = modelCacheManager.getCacheInfo();
    logger.debug('[Startup] Model cache info:', cacheInfo);
  } catch (error) {
    logger.error('[Startup] Failed to initialize model cache:', error);
    // Don't block app startup even if model cache initialization fails
  }
})();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

logger.success('App rendered successfully');
