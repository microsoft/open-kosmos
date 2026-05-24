import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

const CHROME_EXTENSION_KEY = process.env.CHROME_EXTENSION_KEY;
// Detect dev mode early for manifest-level switches
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.MODE !== 'production';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  runner: {
    // Disable auto-launch
    disabled: true,
  },
  manifest: {
    // Use environment variable for the key, fallback to undefined if not set
    key: CHROME_EXTENSION_KEY,
    update_url: 'http://localhost:8000/update.xml',
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    icons: {
      16: 'icon/icon.png',
      32: 'icon/icon.png',
      48: 'icon/icon.png',
      96: 'icon/icon.png',
      128: 'icon/icon.png',
    },
    permissions: [
      'nativeMessaging',
      'tabs',
      'activeTab',
      'scripting',
      'contextMenus',
      'downloads',
      'webRequest',
      'webNavigation',
      'debugger',
      'history',
      'bookmarks',
      'offscreen',
      'storage',
      'declarativeNetRequest',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: [
          '/inject-scripts/*', // Helper files allowed for content script injection
        ],
        matches: ['<all_urls>'],
      },
    ],
    // Note: The following security policies block dev server resource loading in development mode,
    // so they are only enabled in production; development mode uses WXT's default policy.
    ...(IS_DEV
      ? {}
      : {
          cross_origin_embedder_policy: { value: 'require-corp' as const },
          cross_origin_opener_policy: { value: 'same-origin' as const },
          content_security_policy: {
            extension_pages:
              "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;",
          },
        }),
  },
  vite: (env) => ({
    plugins: [
      // TailwindCSS v4 Vite plugin – no PostCSS config required
      tailwindcss(),
      // Ensure static assets are available as early as possible to avoid race conditions in dev
      viteStaticCopy({
        targets: [
          {
            src: 'inject-scripts/*.js',
            dest: 'inject-scripts',
          },
          {
            src: '_locales/**/*',
            dest: '_locales',
          },
        ],
        hook: 'writeBundle',
        watch: {} as any,
      }) as any,
    ],
    build: {
      target: 'es2015',
      sourcemap: env.mode !== 'production',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      minify: false,
    },
  }),
});
