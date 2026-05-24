import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { createRequire } from 'module'
import react from '@vitejs/plugin-react-swc'
import dotenv from 'dotenv'

import { ejsTemplatePlugin } from './scripts/vite/ejs-template-plugin'
import { monacoWorkerPlugin } from './scripts/vite/monaco-worker-plugin'
import { sharedDefines, mainOnlyDefines, rendererOnlyDefines } from './scripts/vite/defines'

// Load openkosmos brand config for template plugin (window title etc.)
const nodeRequire = createRequire(import.meta.url)
const openkosmosConfig = nodeRequire('./brands/openkosmos/config.json')

// Load .env.local (support DOTENV_CONFIG_PATH override for E2E tests)
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' })

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'

  const shared = sharedDefines(mode)
  const mainOnly = mainOnlyDefines()
  const rendererOnly = rendererOnlyDefines()

  return {
    main: {
      build: {
        outDir: 'dist-vite/main',
        rolldownOptions: {
          external: ['bufferutil', 'utf-8-validate'],
          input: {
            main: resolve(__dirname, 'src/main/bootstrap.ts'),
          },
          output: {
            // Keep chunks flat alongside main.js (no chunks/ subdirectory).
            // This ensures __dirname in any chunk === dist-vite/main/,
            // so path.join(__dirname, 'preload.*.js') resolves correctly.
            chunkFileNames: '[name]-[hash].js',
          },
        },
        sourcemap: isDev ? true : false,
      },
      define: { ...shared, ...mainOnly },
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
          '@main': resolve(__dirname, 'src/main'),
        },
      },
    },

    preload: {
      build: {
        outDir: 'dist-vite/main', // Same dir as main — preserves path.join(__dirname, 'preload.js')
        emptyOutDir: false, // CRITICAL: don't wipe main.js from the main build
        lib: {
          entry: {
            preload: resolve(__dirname, 'src/preload/main.ts'),
            'preload.screenshot': resolve(__dirname, 'src/preload/screenshot.ts'),
          },
          formats: ['cjs'], // Preload must be CJS — ESM preload can't use require('electron')
        },
      },
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
    },

    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      build: {
        outDir: resolve(__dirname, 'dist-vite/renderer'),
        minify: isDev ? false : 'esbuild',
        cssMinify: isDev ? false : 'esbuild',
        rolldownOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            screenshot: resolve(__dirname, 'src/renderer/screenshot.html'),
          },
        },
        sourcemap: isDev ? 'inline' : false,
      },
      plugins: [
        react(),
        monacoWorkerPlugin(),
        ejsTemplatePlugin({ appConfig: openkosmosConfig, isDev }),
      ],
      define: {
        ...shared,
        ...rendererOnly,
      },
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
          '@renderer': resolve(__dirname, 'src/renderer'),
          '@': resolve(__dirname, 'src/renderer'),
        },
      },
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react-router-dom',
          'lucide-react',
          'react-markdown',
          'react-syntax-highlighter',
          'react-syntax-highlighter/dist/esm/styles/prism',
          'remark-gfm',
          'remark-breaks',
          'rehype-raw',
          'immer',
          'clsx',
          'tailwind-merge',
          'monaco-editor',
        ],
      },
      server: {
        port: 39017,
        warmup: {
          clientFiles: [
            './index.tsx',
            './screenshot.tsx',
          ],
        },
      },
    },
  }
})
