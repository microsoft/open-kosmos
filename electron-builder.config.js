const config = require('./brands/openkosmos/config.json');
const path = require('path');

const brandAssetsDir = path.join(__dirname, 'brands/openkosmos/assets');
const iconMac = path.join(brandAssetsDir, 'mac/app.icns');
const iconWin = path.join(brandAssetsDir, 'win/app.ico');
const iconLinux = path.join(brandAssetsDir, 'win/icon_round_512x512.png');
const assetsDir = brandAssetsDir;

/**
 * Electron Builder Configuration
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
module.exports = {
  appId: config.appId,

  // extraMetadata.name determines Windows NSIS install directory
  // → %LOCALAPPDATA%\Programs\<name>
  extraMetadata: {
    name: 'openkosmos',
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
    // The following large native module is not bundled with the installer; NativeModuleManager downloads it on demand from npm CDN
    '!**/node_modules/@kutalia/whisper-node-addon/**',  // 127 MB
  ],
  // ── asarUnpack ──────────────────────────────────────────────────────
  // Packages listed here are extracted from the asar archive at install time
  // so they can access the real filesystem (spawn processes, load .node addons).
  //
  // CAUTION: Moving a runtime dependency to devDependencies will silently
  // exclude it from the build. electron-builder only packages `dependencies`
  // and `optionalDependencies`, NOT `devDependencies`. A module that works
  // fine in development (where all deps are installed) will fail at runtime
  // in the packaged app. Always verify with `npx asar list <app.asar>` after
  // build if you change dependency categories. (Lesson from 7ea925e / 09521ea)
  asarUnpack: [
    'node_modules/@vscode/ripgrep/**',
    // sharp 0.34+ resolves native binaries from platform-specific @img packages.
    // Keep both the loader package and native runtime packages outside asar.
    'node_modules/sharp/**',
    'node_modules/@img/sharp-*/**',
    // keytar: native credential storage (.node file)
    'node_modules/keytar/**',
    'node_modules/node-screenshots/**',
    'node_modules/node-screenshots-win32-x64-msvc/**',
    'node_modules/node-screenshots-win32-ia32-msvc/**',
    'node_modules/node-screenshots-win32-arm64-msvc/**',
    'node_modules/node-screenshots-darwin-x64/**',
    'node_modules/node-screenshots-darwin-arm64/**',
    'node_modules/node-screenshots-linux-x64-gnu/**',
    'node_modules/node-screenshots-linux-x64-musl/**',
    'node_modules/node-screenshots-linux-arm64-gnu/**',
    // Playwright browser automation — playwright-core spawns child processes (browser server)
    // and performs file I/O (browser registry, profiles), which cannot work inside asar.
    // The wrapper package "playwright" is a thin re-export and can stay in asar.
    'node_modules/playwright-core/**',
    // whisper-node-addon is already excluded from global files, no need to unpack
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
  publish: [
    {
      provider: 'github',
      owner: 'gim-home',
      repo: 'Kosmos',
      private: false,
      protocol: 'https',
      releaseType: 'release',
      publishAutoUpdate: true,
    },
  ],
  releaseInfo: {
    releaseNotes: 'See CHANGELOG.md for details',
    releaseName: '${version}',
  },
  generateUpdatesFilesForAllChannels: false,
  afterPack: 'scripts/verify-sharp-runtime-packaging.js',
  afterSign: 'scripts/notarize.js',
  
  // ==========================================================================
  // macOS Configuration
  // ==========================================================================
  // App Bundle: /Applications/<productName>.app (spaces OK in macOS)
  // User Data:  ~/Library/Application Support/<userDataName>
  // Artifacts:  <filenamePrefix>-<version>-mac-<arch>.dmg/.zip
  mac: {
    icon: iconMac,
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    type: 'distribution',
    artifactName: `${config.filenamePrefix}-\${version}-mac-\${arch}.\${ext}`,
    // whisper-node-addon is already excluded in global files, no platform-level extra config needed
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
    icon: iconWin,
    // executableName: Windows .exe filename (MUST NOT contain spaces!)
    executableName: config.filenamePrefix || config.productName.replace(/\s+/g, '-'),
    // whisper-node-addon is already excluded in global files, no platform-level config needed
    // sharp 0.34+ is unpacked via top-level asarUnpack entries instead of the
    // legacy sharp/build/Release directory.
    // Do not hardcode both x64 and arm64 here. Local `npm run dist:win` should
    // build only the current runner architecture unless an explicit CLI arch
    // flag (for example `--x64` or `--arm64`) is provided.
    artifactName: `${config.filenamePrefix}-\${version}-win-\${arch}.\${ext}`,
    target: ['nsis', 'zip'],
    forceCodeSigning: false,
    extraResources: [
      {
        from: 'resources/dll',
        to: 'dll',
        filter: ['**/*'],
      },
      {
        from: assetsDir,
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
    icon: iconLinux,
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
    // shortcutName: Display name for desktop/start menu shortcuts (can contain spaces)
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
