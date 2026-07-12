/**
 * Compile-time replacements (migrated from webpack DefinePlugin).
 * Every process.env.X used in bundled source code must be listed here.
 *
 * NOTE: We add `|| ''` fallbacks where webpack had bare JSON.stringify(process.env.X).
 * When env vars are unset, webpack's DefinePlugin produces `undefined` (the JS value)
 * while our approach produces `""` (empty string). This is intentional — empty string
 * is safer for string operations and avoids potential TypeError on .includes() etc.
 */

interface BrandConfig {
  name: string
  config: {
    appId: string
    productName: string
    userDataName?: string
    [key: string]: unknown
  }
}

export function sharedDefines(mode: string, brandConfig: BrandConfig): Record<string, string> {
  const appConfig = brandConfig.config
  return {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.BRAND_NAME': JSON.stringify(brandConfig.name),
    'process.env.BRAND_CONFIG': JSON.stringify(appConfig),
    'process.env.APP_NAME': JSON.stringify(appConfig.productName),
    'process.env.HISTORY_PROMPT_QUEUE_SIZE': JSON.stringify(process.env.HISTORY_PROMPT_QUEUE_SIZE || '20'),
  }
}

export function mainOnlyDefines(brandConfig: BrandConfig): Record<string, string> {
  const appConfig = brandConfig.config
  return {
    'process.env.APP_ID': JSON.stringify(appConfig.appId),
    'process.env.USER_DATA_NAME': JSON.stringify(appConfig.userDataName || appConfig.productName),
    // OpenKosmos MCP credential placeholders
    'process.env.REDDIT_CLIENT_ID': JSON.stringify(process.env.REDDIT_CLIENT_ID || ''),
    'process.env.REDDIT_CLIENT_SECRET': JSON.stringify(process.env.REDDIT_CLIENT_SECRET || ''),
    'process.env.DATA_AI_API_KEY': JSON.stringify(process.env.DATA_AI_API_KEY || ''),
    'process.env.UNWRAP_ACCESS_TOKEN': JSON.stringify(process.env.UNWRAP_ACCESS_TOKEN || ''),
    'process.env.TAVILY_API_KEY': JSON.stringify(process.env.TAVILY_API_KEY || ''),
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
