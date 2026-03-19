const brandConfig = require('./scripts/brand-config');
const { config, paths, name: brandName } = brandConfig;
const path = require('path');

/**
 * Electron Builder Configuration - Multi-Brand Support
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 * 
 * ============================================================================
 * BRAND CONFIGURATION
 * ============================================================================
 * 
 * Configuration values are loaded from: brands/<brandName>/config.json
 * Brand is determined by: BRAND environment variable (default: 'kosmos')
 * 
 * ============================================================================
 * WINDOWS INSTALLATION PATHS
 * ============================================================================
 * 
 * EXE Installer (NSIS):
 *   Install Dir:  %LOCALAPPDATA%\Programs\<brandName>
 *                 → C:\Users\<user>\AppData\Local\Programs\kosmos
 *   Executable:   <filenamePrefix>.exe (e.g., KOSMOS.exe)
 *   User Data:    %APPDATA%\<userDataName>
 *                 → C:\Users\<user>\AppData\Roaming\kosmos-app
 * 
 * ZIP Portable:
 *   Extract to:   Any folder (user choice)
 *   Executable:   <filenamePrefix>.exe (same as NSIS)
 *   User Data:    Same as NSIS (%APPDATA%\<userDataName>)
 * 
 * ⚠️ IMPORTANT: Windows exe filename must NOT contain spaces!
 *    - executableName is set to filenamePrefix to avoid issues
 *    - Spaces in exe names cause CMD parsing errors and update failures
 * 
 * ============================================================================
 * MACOS INSTALLATION PATHS
 * ============================================================================
 * 
 * DMG Installer:
 *   Install Dir:  /Applications/<productName>.app
 *                 → /Applications/KOSMOS.app
 *   User Data:    ~/Library/Application Support/<userDataName>
 *                 → ~/Library/Application Support/kosmos-app
 * 
 * ZIP Portable:
 *   Extract to:   Any folder → <productName>.app bundle
 *   User Data:    Same as DMG
 * 
 * ✅ macOS: Spaces in app names are OK (.app is a bundle directory)
 * 
 * ============================================================================
 * KEY CONFIGURATION MAPPINGS
 * ============================================================================
 * 
 * extraMetadata.name     → Windows install directory name (via NSIS)
 * productName            → App display name, macOS .app name
 * executableName         → Windows .exe filename (avoid spaces!)
 * artifactName           → Downloaded file name (DMG/ZIP/EXE)
 * userDataName           → User data folder (via bootstrap.ts)
 * shortcutName           → Desktop/Start Menu shortcut name
 * filenamePrefix         → Artifact filename prefix
 * 
 */
module.exports = {
  appId: config.appId,
  
  // extraMetadata.name determines Windows NSIS install directory
  // → %LOCALAPPDATA%\Programs\<name>
  extraMetadata: {
    name: brandName,
  },
  
  // productName is the app display name and macOS .app bundle name
  productName: config.productName,
  
  // artifactName is the downloaded installer/archive filename
  artifactName: (config.filenamePrefix || '${productName}') + '-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist/**/*',
    'resources/**/*',
    '!resources/python',
    'package.json',
    '!**/*.map',
    '!**/*.ts',
    '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/node_modules/*.d.ts',
    '!**/node_modules/.bin',
    '!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}',
    '!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}',
    '!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}',
    '!**/node_modules/playwright*/.local-browsers/**',
    // The following two oversized native modules are not distributed with the installer; they are downloaded on-demand from npm CDN by NativeModuleManager
    '!**/node_modules/@kutalia/whisper-node-addon/**',  // 127 MB
    '!**/node_modules/sherpa-onnx/**',                  //  13 MB
  ],
  asarUnpack: [
    'node_modules/@vscode/ripgrep/**',
    'node_modules/sqlite-vec/**',
    'node_modules/sqlite-vec-darwin-arm64/**',
    'node_modules/sqlite-vec-darwin-x64/**',
    'node_modules/sqlite-vec-linux-x64/**',
    'node_modules/sqlite-vec-linux-arm64/**',
    'node_modules/sqlite-vec-windows-x64/**',
    // Azure MSAL native broker runtime (native .node + .dylib files)
    'node_modules/@azure/msal-node-runtime/**',
    'node_modules/node-screenshots/**',
    'node_modules/node-screenshots-win32-x64-msvc/**',
    'node_modules/node-screenshots-win32-ia32-msvc/**',
    'node_modules/node-screenshots-win32-arm64-msvc/**',
    'node_modules/node-screenshots-darwin-x64/**',
    'node_modules/node-screenshots-darwin-arm64/**',
    'node_modules/node-screenshots-linux-x64-gnu/**',
    'node_modules/node-screenshots-linux-x64-musl/**',
    'node_modules/node-screenshots-linux-arm64-gnu/**',
    // whisper-node-addon and sherpa-onnx are excluded from global files, no need to unpack
  ],
  extraResources: [
    {
      from: 'resources/scripts',
      to: 'scripts',
      filter: ['**/*'],
    },
  ],
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  compression: 'maximum',
  afterSign: 'scripts/notarize.js',
  
  // ==========================================================================
  // macOS Configuration
  // ==========================================================================
  // App Bundle: /Applications/<productName>.app (spaces OK in macOS)
  // User Data:  ~/Library/Application Support/<userDataName>
  // Artifacts:  <filenamePrefix>-<version>-mac-<arch>.dmg/.zip
  mac: {
    icon: paths.iconMac,
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    type: 'distribution',
    artifactName: `${config.filenamePrefix}-\${version}-mac-\${arch}.\${ext}`,
    // whisper-node-addon and sherpa-onnx are excluded in global files, no platform-level extra config needed
    extendInfo: {
      NSAppleEventsUsageDescription:
        'This app needs to access Apple Events to run external programs.',
      NSSystemAdministrationUsageDescription:
        'This app needs system administration access to run MCP servers.',
      NSFileProviderPresenceUsageDescription:
        'This app needs file system access to manage MCP server files.',
      LSEnvironment: {
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
    },
    extraResources: [
      {
        from: 'resources/python',
        to: 'python',
        filter: ['*apple*'],
      },
    ],
    target: ['dmg', 'zip'],
    notarize: false,
  },
  
  // ==========================================================================
  // Windows Configuration
  // ==========================================================================
  // Install Dir: %LOCALAPPDATA%\Programs\<extraMetadata.name> (set by NSIS)
  // Executable:  <executableName>.exe (NO SPACES! Use filenamePrefix)
  // User Data:   %APPDATA%\<userDataName>
  // Artifacts:   <filenamePrefix>-<version>-win-<arch>.exe/.zip
  //
  // ⚠️ CRITICAL: executableName must NOT contain spaces!
  //    Spaces in exe names cause CMD parsing errors and update failures
  //    Always use filenamePrefix for exe name
  win: {
    icon: paths.iconWin,
    // executableName: Windows .exe filename (MUST NOT contain spaces!)
    // Uses filenamePrefix to avoid spaces in exe name
    executableName: config.filenamePrefix || config.productName.replace(/\s+/g, '-'),
    // whisper-node-addon and sherpa-onnx are excluded in global files, no platform-level config needed
    artifactName: `${config.filenamePrefix}-\${version}-win-\${arch}.\${ext}`,
    target: [
      {
        target: 'nsis',
        arch: 'x64',
      },
      {
        target: 'nsis',
        arch: 'arm64',
      },
      {
        target: 'zip',
        arch: 'x64',
      },
      {
        target: 'zip',
        arch: 'arm64',
      },
    ],
    forceCodeSigning: false,
    extraResources: [
      {
        from: 'node_modules/sharp/build/Release',
        to: 'app/node_modules/sharp/build/Release',
        filter: ['**/*'],
      },
      {
        from: 'resources/dll',
        to: 'dll',
        filter: ['**/*'],
      },
      {
        from: paths.assets,
        to: 'brand-assets',
        filter: ['**/*'],
      },
      {
        from: 'resources/python',
        to: 'python',
        filter: ['*windows*'],
      },
    ],
  },
  linux: {
    icon: path.join(paths.assetsWin, 'icon_round_512x512.png'),
    extraResources: [
      {
        from: 'resources/python',
        to: 'python',
        filter: ['*linux*'],
      },
    ],
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
    ],
  },
  
  // ==========================================================================
  // NSIS Installer Configuration (Windows)
  // ==========================================================================
  // Install location is determined by extraMetadata.name (brandName)
  // → %LOCALAPPDATA%\Programs\<brandName>
  // shortcutName: Desktop and Start Menu shortcut display name
  nsis: {
    oneClick: true,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // shortcutName: Display name for desktop/start menu shortcuts
    // Can contain spaces - this is just the shortcut label
    shortcutName: config.shortcutName,
    displayLanguageSelector: false,
    multiLanguageInstaller: false,
    allowElevation: false,
    perMachine: false,
    artifactName: `${config.filenamePrefix}-\${version}-win-\${arch}.\${ext}`,
    differentialPackage: true,
  },
  // ==========================================================================
  // DMG Installer Configuration (macOS)
  // ==========================================================================
  // Layout inspired by Claude/Codex DMG installers:
  // - Icons centered vertically in window
  // - Proper spacing between app icon and Applications folder
  // - Clean, professional appearance with solid arrow
  // - Background: 1080x760 @2x (actual: 540x380)
  // - Arrow center Y: 340@2x = 170 logical pixels
  dmg: {
    iconSize: 80,
    background: 'build/dmg-background.png',
    contents: [
      {
        x: 135,
        y: 170,
        type: 'file',
      },
      {
        x: 405,
        y: 170,
        type: 'link',
        path: '/Applications',
      },
    ],
    window: {
      width: 540,
      height: 380,
    },
  },
};
