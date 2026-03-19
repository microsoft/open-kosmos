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
    preload: './src/main/preload.ts',
    'preload.screenshot': './src/main/preload-screenshot/entry.ts',
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
            },
          },
        ],
        exclude: [/node_modules/, /\.test\.ts$/, /\.spec\.ts$/, /__tests__/],
      },
      {
        // Handle .node files (native modules)
        test: /\.node$/,
        use: 'node-loader',
      },
      {
        // Handle .md files as raw text strings (for edge prompt resources)
        test: /\.md$/,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      // Expose environment variables to main process
      // Use webpack's mode as fallback to ensure development mode is properly detected for electron-reload
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'process.env.DEVELOPMENT_BASE_CDN_URL': JSON.stringify(process.env.DEVELOPMENT_BASE_CDN_URL),
      'process.env.PRODUCTION_BASE_CDN_URL': JSON.stringify(process.env.PRODUCTION_BASE_CDN_URL),
      'process.env.BRAND_CONFIG': JSON.stringify(appConfig),
      'process.env.BRAND_NAME': JSON.stringify(brandConfig.name),
      'process.env.APP_NAME': JSON.stringify(appConfig.productName),
      'process.env.USER_DATA_NAME': JSON.stringify(appConfig.userDataName || appConfig.productName),
      'process.env.PRESET_MODEL_GPT4O_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT4O_NAME),
      'process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT4O_DEPLOYMENT_NAME),
      'process.env.PRESET_MODEL_GPT4O_ENDPOINT': JSON.stringify(process.env.PRESET_MODEL_GPT4O_ENDPOINT),
      'process.env.PRESET_MODEL_GPT4O_API_KEY': JSON.stringify(process.env.PRESET_MODEL_GPT4O_API_KEY),
      'process.env.PRESET_MODEL_GPT4O_API_VERSION': JSON.stringify(process.env.PRESET_MODEL_GPT4O_API_VERSION),
      'process.env.PRESET_MODEL_GPT41_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT41_NAME),
      'process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME': JSON.stringify(process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME),
      'process.env.PRESET_MODEL_GPT41_ENDPOINT': JSON.stringify(process.env.PRESET_MODEL_GPT41_ENDPOINT),
      'process.env.PRESET_MODEL_GPT41_API_KEY': JSON.stringify(process.env.PRESET_MODEL_GPT41_API_KEY),
      'process.env.PRESET_MODEL_GPT41_API_VERSION': JSON.stringify(process.env.PRESET_MODEL_GPT41_API_VERSION),
      'process.env.HISTORY_PROMPT_QUEUE_SIZE': JSON.stringify(process.env.HISTORY_PROMPT_QUEUE_SIZE),
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
        // Playwright and browser automation
        'playwright',
        'playwright-core',
        'chromium-bidi',
        'utf-8-validate',
        'selection-hook', // Add selection-hook to native modules
        // node-screenshots window detection native addon
        'node-screenshots',
        // Azure MSAL native broker runtime (contains .node and .dylib files)
        '@azure/msal-node-runtime',
        '@azure/msal-node-extensions',
        // Whisper speech-to-text native addon
        '@kutalia/whisper-node-addon',
        // Additional AI/ML modules that may contain native bindings
        '@google/generative-ai',
        'cohere-ai',
        'ollama',
        'neo4j-driver',
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