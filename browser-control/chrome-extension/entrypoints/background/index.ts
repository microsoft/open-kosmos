import { initNativeHostListener } from './native-host';

/**
 * Background script entry point
 * Initializes core MCP services only
 */
export default defineBackground(() => {
  const manifest = chrome.runtime.getManifest();
  console.log(`[MCP-Chrome] Extension v${manifest.version} started`);

  // Initialize Native Host listener for MCP tool proxy
  initNativeHostListener();
});
