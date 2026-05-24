/**
 * Global Branding Constants
 * Hardcoded to openkosmos — multi-brand support removed.
 */

export const APP_NAME = 'OpenKosmos';
export const BRAND_NAME = 'openkosmos';
export const BRAND_CONFIG = {
  appId: 'com.openkosmos.app',
  productName: 'OpenKosmos',
  userDataName: 'openkosmos-app',
  description: 'OpenKosmos AI Studio',
  copyright: 'Copyright © 2025-2026 OpenKosmos Team',
  author: 'OpenKosmos Team',
  homepage: 'https://www.kosmos-ai.com',
  feedbackLink: 'https://feedback.placeholder.example.com',
  filenamePrefix: 'OpenKosmos',
  shortcutName: 'OpenKosmos',
  windowTitle: 'OpenKosmos AI Studio',
};

export const getWindowTitle = () => BRAND_CONFIG.windowTitle;
