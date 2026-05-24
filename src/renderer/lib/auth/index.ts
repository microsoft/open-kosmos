// src/renderer/lib/auth/index.ts
// Authentication module exports - now implemented via main process proxies

// Core auth functionality is now implemented through proxies
export * from './authManagerProxy';
export * from './tokenMonitorProxy';

// Shared config and types
export * from './ghcConfig';