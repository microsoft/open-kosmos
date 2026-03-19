const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const brandConfig = require('./scripts/brand-config');
const { config: appConfig } = brandConfig;

// Load environment variables from .env.local (or DOTENV_CONFIG_PATH for E2E test builds)
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';
  const isProduction = argv.mode === 'production';

  return {
    target: 'web', // Explicitly set to web target, not electron-renderer
    entry: {
      main: './src/renderer/index.tsx',
      screenshot: './src/renderer/screenshot.tsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist/renderer'),
      filename: isProduction ? 'js/[name].[contenthash:8].js' : '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@renderer': path.resolve(__dirname, 'src/renderer'),
        '@': path.resolve(__dirname, 'src/renderer'),
      },
      fallback: {
        path: require.resolve('path-browserify'),
        os: require.resolve('os-browserify/browser'),
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer'),
        util: require.resolve('util'),
        events: require.resolve('events'),
        process: require.resolve('process/browser'),
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        module: false,
        dgram: false,
        dns: false,
        http: false,
        https: false,
        url: false,
        querystring: false,
        zlib: false,
      },
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          include: /node_modules/,
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.tsx?$/,
          use: [
            // Babel loader for React Fast Refresh
            {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/preset-react', '@babel/preset-typescript'],
                plugins: [
                  isDevelopment && require.resolve('react-refresh/babel'),
                ].filter(Boolean),
              },
            },
            // TypeScript loader
            {
              loader: 'ts-loader',
              options: {
                configFile: 'tsconfig.renderer.build.json',
              },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            'style-loader',
            'css-loader',
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [require('tailwindcss'), require('autoprefixer')],
                },
              },
            },
          ],
        },
        {
          test: /\.(png|jpe?g|gif|svg|ico)$/,
          type: 'asset/resource',
        },
        {
          test: /\.(ttf|woff|woff2|eot)$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        global: 'globalThis',
        'window.global': 'globalThis',
        // argv.mode (--mode flag) takes priority over .env.local NODE_ENV
        'process.env.NODE_ENV': JSON.stringify(
          isDevelopment ? 'development' : 'production',
        ),
        'process.platform': JSON.stringify(process.platform),
        'process.versions': JSON.stringify(process.versions),
        'process.env.DEVELOPMENT_BASE_CDN_URL': JSON.stringify(
          process.env.DEVELOPMENT_BASE_CDN_URL,
        ),
        'process.env.PRODUCTION_BASE_CDN_URL': JSON.stringify(
          process.env.PRODUCTION_BASE_CDN_URL,
        ),
        'process.env.APP_NAME': JSON.stringify(appConfig.productName),
        'process.env.BRAND_NAME': JSON.stringify(brandConfig.name),
        // Expose preset model environment variables
        'process.env.PRESET_MODEL_GPT4O_NAME': JSON.stringify(
          process.env.PRESET_MODEL_GPT4O_NAME,
        ),
        'process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME': JSON.stringify(
          process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME,
        ),
        'process.env.PRESET_MODEL_GPT4O_ENDPOINT': JSON.stringify(
          process.env.PRESET_MODEL_GPT4O_ENDPOINT,
        ),
        'process.env.PRESET_MODEL_GPT4O_API_KEY': JSON.stringify(
          process.env.PRESET_MODEL_GPT4O_API_KEY,
        ),
        'process.env.PRESET_MODEL_GPT4O_API_VERSION': JSON.stringify(
          process.env.PRESET_MODEL_GPT4O_API_VERSION,
        ),
        'process.env.PRESET_MODEL_GPT41_NAME': JSON.stringify(
          process.env.PRESET_MODEL_GPT41_NAME,
        ),
        'process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME': JSON.stringify(
          process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME,
        ),
        'process.env.PRESET_MODEL_GPT41_ENDPOINT': JSON.stringify(
          process.env.PRESET_MODEL_GPT41_ENDPOINT,
        ),
        'process.env.PRESET_MODEL_GPT41_API_KEY': JSON.stringify(
          process.env.PRESET_MODEL_GPT41_API_KEY,
        ),
        'process.env.PRESET_MODEL_GPT41_API_VERSION': JSON.stringify(
          process.env.PRESET_MODEL_GPT41_API_VERSION,
        ),
        // Expose prompt history configuration
        'process.env.HISTORY_PROMPT_QUEUE_SIZE': JSON.stringify(
          process.env.HISTORY_PROMPT_QUEUE_SIZE,
        ),
        'process.argv': '[]', // Provide empty process.argv array
        'process.browser': 'true', // Mark as browser environment
        'process.env.BRAND_CONFIG': JSON.stringify(appConfig),
        'process.env.BRAND_NAME': JSON.stringify(brandConfig.name),
        'process.env.APP_NAME': JSON.stringify(appConfig.productName),
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
        global: 'global',
      }),
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
        filename: 'index.html',
        title: appConfig.windowTitle,
        productName: appConfig.productName,
        chunks: ['main'], // Only include JS files from the main entry
        minify: !isDevelopment
          ? {
              removeComments: true,
              collapseWhitespace: true,
              removeRedundantAttributes: true,
              useShortDoctype: true,
              removeEmptyAttributes: true,
              removeStyleLinkTypeAttributes: true,
              keepClosingSlash: true,
              minifyJS: true,
              minifyCSS: true,
              minifyURLs: true,
            }
          : false,
      }),
      new HtmlWebpackPlugin({
        template: './src/renderer/screenshot.html',
        filename: 'screenshot.html',
        title: `${appConfig.productName} - Screenshot`,
        chunks: ['screenshot'], // Only include JS files from the screenshot entry
        minify: !isDevelopment
          ? {
              removeComments: true,
              collapseWhitespace: true,
              removeRedundantAttributes: true,
              useShortDoctype: true,
              removeEmptyAttributes: true,
              removeStyleLinkTypeAttributes: true,
              keepClosingSlash: true,
              minifyJS: true,
              minifyCSS: true,
              minifyURLs: true,
            }
          : false,
      }),
      // React Fast Refresh plugin for HMR (development only)
      isDevelopment &&
        new ReactRefreshWebpackPlugin({
          overlay: false, // Disable error overlay to avoid Electron contextBridge conflicts
        }),
      // Monaco Editor web workers support
      new MonacoWebpackPlugin({
      // Only keep languages actually used in the app, remove unused languages to reduce bundle
        languages: [
          'javascript', 'typescript', 'json', 'html', 'css',
          'markdown', 'python', 'yaml', 'xml', 'sql', 'shell',
        ],
        features: [
          'bracketMatching', 'clipboard', 'contextmenu', 'find',
          'folding', 'fontZoom', 'hover', 'indentation',
          'lineNumbers', 'links', 'multicursor', 'parameterHints',
          'smartSelect', 'suggest', 'wordHighlighter', 'wordOperations',
        ],
      }),
    ].filter(Boolean),
    devServer: {
      static: {
        directory: path.join(__dirname, 'dist/renderer'),
      },
      port: 3000,
      hot: true, // Enable HMR (require problem fixed by removing polyfill from index.html)
      liveReload: true, // Enable live reload
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      client: {
        overlay: {
          errors: true,
          warnings: false,
        },
        webSocketTransport: 'sockjs', // Use sockjs transport
      },
      webSocketServer: 'sockjs', // Use sockjs server
    },
    optimization: {
      minimize: isProduction,
      minimizer: isProduction
        ? [
            new TerserPlugin({
              terserOptions: {
                compress: {
                  drop_console: false, // Explicitly keep all console
                  drop_debugger: true,
                  pure_funcs: [], // Do not remove any functions
                },
                mangle: {
                  // Keep important function names
                  keep_fnames: true,
                  reserved: ['console'], // Preserve console-related names
                },
              },
              extractComments: false, // Do not extract comments to a separate file
            }),
          ]
        : [],
      splitChunks: isProduction
        ? {
            chunks: 'all',
            // Allow enough parallel async requests to ensure mermaid/monaco lazy-loaded chunks can be split independently
            maxAsyncRequests: 30,
            maxInitialRequests: 10,
            cacheGroups: {
              // mermaid: lazy-loaded dedicated chunk, not merged into vendors, loaded only when needed
              mermaid: {
                test: /[\\/]node_modules[\\/]mermaid[\\/]/,
                name: 'async-mermaid',
                chunks: 'async', // Only applies to async chunks
                filename: 'js/[name].[contenthash:8].js',
                priority: 30,
                reuseExistingChunk: true,
              },
              // monaco-editor: lazy-loaded dedicated chunk, not merged into vendors
              monaco: {
                test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
                name: 'async-monaco',
                chunks: 'async',
                filename: 'js/[name].[contenthash:8].js',
                priority: 30,
                reuseExistingChunk: true,
              },
              // Main entry synchronous dependencies (excluding mermaid / monaco)
              mainVendor: {
                test: (module) => {
                  if (!module.resource) return false;
                  if (!/[\\/]node_modules[\\/]/.test(module.resource)) return false;
                  // mermaid and monaco are split separately, not included in mainVendor
                  if (/[\\/]node_modules[\\/]mermaid[\\/]/.test(module.resource)) return false;
                  if (/[\\/]node_modules[\\/]monaco-editor[\\/]/.test(module.resource)) return false;
                  return true;
                },
                name: 'main-vendors',
                chunks: 'initial', // Only bundle synchronous initial chunks, async chunks handled by groups above
                filename: 'js/[name].[contenthash:8].js',
                priority: 20,
              },
              common: {
                name: 'common',
                minChunks: 2,
                chunks: 'all',
                filename: 'js/[name].[contenthash:8].js',
                priority: -10,
                reuseExistingChunk: true,
              },
            },
          }
        : false,
    },
    devtool: isDevelopment ? 'eval-source-map' : false,
    mode: argv.mode || 'development',
  };
};
