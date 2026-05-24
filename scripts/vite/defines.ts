/**
 * Compile-time replacements (migrated from webpack DefinePlugin).
 * Every process.env.X used in bundled source code must be listed here.
 *
 * NOTE: We add `|| ''` fallbacks where webpack had bare JSON.stringify(process.env.X).
 * When env vars are unset, webpack's DefinePlugin produces `undefined` (the JS value)
 * while our approach produces `""` (empty string). This is intentional — empty string
 * is safer for string operations and avoids potential TypeError on .includes() etc.
 */

// OpenKosmos brand config (hardcoded — multi-brand support removed)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openkosmosConfig = require('../../brands/openkosmos/config.json') as {
  appId: string
  productName: string
  userDataName?: string
  [key: string]: unknown
}

export function sharedDefines(mode: string): Record<string, string> {
  return {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.BRAND_NAME': JSON.stringify('openkosmos'),
    'process.env.BRAND_CONFIG': JSON.stringify(openkosmosConfig),
    'process.env.APP_NAME': JSON.stringify(openkosmosConfig.productName),
    'process.env.DEVELOPMENT_BASE_CDN_URL': JSON.stringify(process.env.DEVELOPMENT_BASE_CDN_URL || ''),
    'process.env.PRODUCTION_BASE_CDN_URL': JSON.stringify(process.env.PRODUCTION_BASE_CDN_URL || ''),
    'process.env.RELEASE_CDN_URL': JSON.stringify(process.env.RELEASE_CDN_URL || ''),
    'process.env.HISTORY_PROMPT_QUEUE_SIZE': JSON.stringify(process.env.HISTORY_PROMPT_QUEUE_SIZE || '20'),
    // Preset model: GPT-4o
    'process.env.PRESET_MODEL_GPT4O_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT4O_NAME || ''),
    'process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME || ''),
    'process.env.PRESET_MODEL_GPT4O_ENDPOINT': JSON.stringify(process.env.PRESET_MODEL_GPT4O_ENDPOINT || ''),
    'process.env.PRESET_MODEL_GPT4O_API_KEY': JSON.stringify(process.env.PRESET_MODEL_GPT4O_API_KEY || ''),
    'process.env.PRESET_MODEL_GPT4O_API_VERSION': JSON.stringify(process.env.PRESET_MODEL_GPT4O_API_VERSION || ''),
    // Preset model: GPT-4.1
    'process.env.PRESET_MODEL_GPT41_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT41_NAME || ''),
    'process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME || ''),
    'process.env.PRESET_MODEL_GPT41_ENDPOINT': JSON.stringify(process.env.PRESET_MODEL_GPT41_ENDPOINT || ''),
    'process.env.PRESET_MODEL_GPT41_API_KEY': JSON.stringify(process.env.PRESET_MODEL_GPT41_API_KEY || ''),
    'process.env.PRESET_MODEL_GPT41_API_VERSION': JSON.stringify(process.env.PRESET_MODEL_GPT41_API_VERSION || ''),
  }
}

export function mainOnlyDefines(): Record<string, string> {
  return {
    'process.env.APP_ID': JSON.stringify(openkosmosConfig.appId),
    'process.env.USER_DATA_NAME': JSON.stringify(openkosmosConfig.userDataName || openkosmosConfig.productName),
    'process.env.DEVELOPMENT_RELAY_SERVICE_URL': JSON.stringify(process.env.DEVELOPMENT_RELAY_SERVICE_URL || ''),
    'process.env.PRODUCTION_RELAY_SERVICE_URL': JSON.stringify(process.env.PRODUCTION_RELAY_SERVICE_URL || ''),
    'process.env.ACTIVE_USER_THRESHOLD_MIN': JSON.stringify(process.env.ACTIVE_USER_THRESHOLD_MIN || ''),
  }
}

export function rendererOnlyDefines(): Record<string, string> {
  return {
    'global': 'globalThis',
    'window.global': 'globalThis',
    'process.platform': JSON.stringify(process.platform),
    'process.versions': JSON.stringify(process.versions),
    'process.argv': '[]',
    'process.browser': 'true',
    'process.env.npm_package_version': JSON.stringify(process.env.npm_package_version || ''),
  }
}
