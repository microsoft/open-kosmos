/**
 * Browser configuration map: differentiated parameters for Chrome / Edge
 * Shared by main.ts, browserControlHttpServer.ts, and browserControlStatus.ts
 */

export const BROWSER_CONFIG = {
  chrome: {
    exe: 'chrome.exe',
    displayName: 'Google Chrome',
    appPathRegKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
    downloadUrl: 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi',
    installerName: 'GoogleChromeStandaloneEnterprise64.msi',
    installerArgs: '/qn /norestart',
    startCmd: 'start chrome',
    registerScript: 'register-chrome.ps1',
    unregisterScript: 'unregister-chrome.ps1',
    registerNativeServerScript: 'register-native-server-chrome.ps1',
    unregisterNativeServerScript: 'unregister-native-server-chrome.ps1',
    snapRightScript: 'snap-right-chrome.ps1',
    moveBrowserToDisplayScript: 'move-browser-to-display-chrome.ps1',
    nativeHostRegPath: 'Software\\Google\\Chrome\\NativeMessagingHosts',
    policyRegPath: 'Software\\Policies\\Google\\Chrome\\ExtensionSettings',
    // macOS
    macProcessName: 'Google Chrome',
    macAppName: 'Google Chrome',
    macBundleId: 'com.google.Chrome',
    macDownloadUrl: 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg',
    macDmgVolumeName: 'Google Chrome',
  },
  edge: {
    exe: 'msedge.exe',
    displayName: 'Microsoft Edge',
    appPathRegKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    downloadUrl: 'https://go.microsoft.com/fwlink/?LinkID=2093437',
    installerName: 'MicrosoftEdgeEnterpriseX64.msi',
    installerArgs: '/qn /norestart',
    startCmd: 'start msedge',
    registerScript: 'register-edge.ps1',
    unregisterScript: 'unregister-edge.ps1',
    registerNativeServerScript: 'register-native-server-edge.ps1',
    unregisterNativeServerScript: 'unregister-native-server-edge.ps1',
    snapRightScript: 'snap-right-edge.ps1',
    moveBrowserToDisplayScript: 'move-browser-to-display-edge.ps1',
    nativeHostRegPath: 'Software\\Microsoft\\Edge\\NativeMessagingHosts',
    policyRegPath: 'Software\\Policies\\Microsoft\\Edge\\ExtensionSettings',
    // macOS
    macProcessName: 'Microsoft Edge',
    macAppName: 'Microsoft Edge',
    macBundleId: 'com.microsoft.edgemac',
    macDownloadUrl: '',
    macDmgVolumeName: '',
  }
} as const;

// Combined scripts for registering/unregistering both browsers at once
export const COMBINED_SCRIPTS = {
  registerAll: 'register-all.ps1',
  unregisterAll: 'unregister-all.ps1',
  registerNativeServerAll: 'register-native-server-all.ps1',
  unregisterNativeServerAll: 'unregister-native-server-all.ps1',
  // macOS equivalents
  registerAllMac: 'register-all-mac.sh',
  unregisterAllMac: 'unregister-all-mac.sh',
} as const;

export type BrowserType = keyof typeof BROWSER_CONFIG;
