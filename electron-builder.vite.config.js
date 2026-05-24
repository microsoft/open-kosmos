/**
 * Electron Builder Configuration for Vite build pipeline.
 *
 * Inherits all settings from electron-builder.config.js (branding, platform
 * configs, signing, asarUnpack, etc.) and overrides only what's needed for
 * the two-package.json pattern with vite-pack/ staging directory.
 *
 * Usage: electron-builder --config electron-builder.vite.config.js
 */
const path = require('path');
const baseConfig = require('./electron-builder.config');

module.exports = {
  ...baseConfig,

  // ── Two-package.json pattern ────────────────────────────────────
  // Point electron-builder at the vite-pack/ staging directory.
  // It reads vite-pack/package.json for metadata and packages
  // vite-pack/node_modules/ (production-only deps).
  directories: {
    ...baseConfig.directories,
    app: 'vite-pack',
  },

  // ── Windows: fix extraResources paths ───────────────────────────
  // Base config references node_modules/sharp/build/Release which is
  // now inside vite-pack/node_modules/ instead of root node_modules/.
  // electron-builder resolves extraResources.from relative to project
  // root, so we prepend 'vite-pack/' to node_modules references.
  win: {
    ...baseConfig.win,
    extraResources: (baseConfig.win?.extraResources || []).map(resource => {
      if (typeof resource === 'object' && resource.from?.startsWith('node_modules/')) {
        return {
          ...resource,
          from: path.join('vite-pack', resource.from),
        };
      }
      return resource;
    }),
  },
};
