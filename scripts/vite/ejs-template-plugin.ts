/**
 * Vite plugin: render EJS templates in HTML files so that the same *.html
 * files work for both webpack (HtmlWebpackPlugin) and Vite builds.
 * Uses the same `ejs` library that HtmlWebpackPlugin uses internally.
 */
import ejs from 'ejs'
import type { Plugin } from 'vite'

interface PageOptions {
  title: string
  productName: string
  connectSrcExtra: string
  entryScript: string
}

interface EjsTemplatePluginConfig {
  appConfig: { windowTitle: string; productName: string }
  isDev: boolean
}

export function ejsTemplatePlugin({ appConfig, isDev }: EjsTemplatePluginConfig): Plugin {
  const pageOptions: Record<string, PageOptions> = {
    'index.html': {
      title: appConfig.windowTitle,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./index.tsx"></script>',
    },
    'screenshot.html': {
      title: `${appConfig.productName} - Screenshot`,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./screenshot.tsx"></script>',
    },
  }

  const fallback: PageOptions = {
    title: appConfig.productName,
    productName: appConfig.productName,
    connectSrcExtra: '',
    entryScript: '',
  }

  return {
    name: 'ejs-template-compat',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const filename = ctx.filename.split('/').pop() || ''
        const opts = pageOptions[filename] || fallback

        return ejs.render(html, {
          htmlWebpackPlugin: { options: opts },
          connectSrcExtra: opts.connectSrcExtra,
          entryScript: opts.entryScript,
        })
      },
    },
  }
}
