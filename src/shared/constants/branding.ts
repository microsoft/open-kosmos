/**
 * Global Branding Constants
 * Injected at build time via Webpack DefinePlugin
 */

// Define types for global env vars injected by webpack
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_NAME: string;
      BRAND_NAME: string;
      BRAND_CONFIG: any; 
    }
  }
}

export const APP_NAME = process.env.APP_NAME || 'KOSMOS';
export const BRAND_NAME = process.env.BRAND_NAME || 'kosmos';
export const BRAND_CONFIG = process.env.BRAND_CONFIG || {};

export const getWindowTitle = () => (BRAND_CONFIG.windowTitle || `${APP_NAME} AI Studio`);
