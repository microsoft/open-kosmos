// src/renderer/lib/auth/index.ts
// Authentication module exports - now uses main process proxies

// Main auth functionality is now implemented through proxies
export * from './authManagerProxy';
export * from './tokenMonitorProxy';

// Shared configuration and types
export * from './ghcConfig';
