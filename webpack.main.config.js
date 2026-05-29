const path = require('path');
const webpack = require('webpack');

const brandConfig = require('./scripts/brand-config');
const { config: appConfig } = brandConfig;

// Load environment variables from .env.local (or DOTENV_CONFIG_PATH for E2E test builds)
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

module.exports = (env, argv) => {
  // Determine if we're in development mode from webpack CLI
  // argv.mode (--mode flag) takes priority over .env.local NODE_ENV
  const webpackMode = argv?.mode; // 'development' | 'production' | undefined
  const isDevMode = webpackMode
    ? webpackMode === 'development'
    : process.env.NODE_ENV === 'development';
  const nodeEnv = isDevMode ? 'development' : 'production';
  
  return {
  target: 'electron-main',
  entry: {
    main: './src/main/bootstrap.ts',
    preload: './src/preload/main.ts',
    'preload.toolbar': './src/preload/toolbar.ts',
    'preload.screenshot': './src/preload/screenshot.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.main.json',
              compilerOptions: { noEmit: false, outDir: './dist/main', rootDir: './src' },
            },
          },
        ],
        exclude: [/node_modules/, /\.test\.ts$/, /\.spec\.ts$/, /__tests__/, /src\/preload/],
      },
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.preload.json',
              compilerOptions: { noEmit: false, outDir: './dist/main', rootDir: './src' },
            },
          },
        ],
        include: [/src\/preload/],
        exclude: [/node_modules/, /\.test\.ts$/, /\.spec\.ts$/, /__tests__/],
      },
      {
        // Handle .node files (native modules)
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      // Expose environment variables to main process
      // Use webpack's mode as fallback to ensure development mode is properly detected for electron-reload
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'process.env.DEVELOPMENT_BASE_CDN_URL': JSON.stringify(process.env.DEVELOPMENT_BASE_CDN_URL || ''),
      'process.env.PRODUCTION_BASE_CDN_URL': JSON.stringify(process.env.PRODUCTION_BASE_CDN_URL || ''),
      'process.env.RELEASE_CDN_URL': JSON.stringify(process.env.RELEASE_CDN_URL || ''),
      'process.env.BRAND_CONFIG': JSON.stringify(appConfig),
      'process.env.BRAND_NAME': JSON.stringify(brandConfig.name),
      'process.env.APP_NAME': JSON.stringify(appConfig.productName),
      'process.env.APP_ID': JSON.stringify(appConfig.appId),
      'process.env.DEVELOPMENT_RELAY_SERVICE_URL': JSON.stringify(process.env.DEVELOPMENT_RELAY_SERVICE_URL || ''),
      'process.env.PRODUCTION_RELAY_SERVICE_URL': JSON.stringify(process.env.PRODUCTION_RELAY_SERVICE_URL || ''),
      'process.env.USER_DATA_NAME': JSON.stringify(appConfig.userDataName || appConfig.productName),
      'process.env.HISTORY_PROMPT_QUEUE_SIZE': JSON.stringify(process.env.HISTORY_PROMPT_QUEUE_SIZE),
      // Additional environment variables
      'process.env.REDDIT_CLIENT_ID': JSON.stringify(process.env.REDDIT_CLIENT_ID),
      'process.env.REDDIT_CLIENT_SECRET': JSON.stringify(process.env.REDDIT_CLIENT_SECRET),
      'process.env.DATA_AI_API_KEY': JSON.stringify(process.env.DATA_AI_API_KEY),
      'process.env.UNWRAP_ACCESS_TOKEN': JSON.stringify(process.env.UNWRAP_ACCESS_TOKEN),
      'process.env.TAVILY_API_KEY': JSON.stringify(process.env.TAVILY_API_KEY),
    })
  ],
  node: {
    __dirname: false,
    __filename: false,
  },
  externals: [
    'electron',
    'electron-reload', // Externalize electron-reload to run in native Node.js environment
    // Function to handle dynamic externals (updated for new webpack signature)
    function ({ context, request }, callback) {
      // Handle .node files
      if (/\.node$/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }

      // Handle native modules
      const nativeModules = [
        'sharp',
        'onnxruntime-node',
        'better-sqlite3',
        'sqlite-vec',
        '@xenova/transformers',
        'fsevents',
        'cpu-features',
        // Playwright and browser automation — MUST stay external.
        // These are resolved from node_modules at runtime (outside asar via asarUnpack).
        // "playwright" kept for dev/E2E tests; "playwright-core" is the runtime dep.
        // If you move playwright-core out of package.json `dependencies`, all browser
        // automation (CDP auth, web search) will silently break in packaged builds.
        'playwright',
        'playwright-core',
        'chromium-bidi',
        'bufferutil',
        'utf-8-validate',
        'selection-hook', // Add selection-hook to native modules
        // node-screenshots window detection native addon
        'node-screenshots',
        // Additional AI/ML modules that may contain native bindings
        '@google/generative-ai',
        'cohere-ai',
        'ollama',
      ];

      if (nativeModules.some((mod) => request.startsWith(mod))) {
        return callback(null, 'commonjs ' + request);
      }

      callback();
    },
  ],
  mode: nodeEnv,
};
};