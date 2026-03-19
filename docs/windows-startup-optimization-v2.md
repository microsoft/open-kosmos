# Windows Startup Performance Optimization Plan V2 - Deep Optimization

> This document is a deep supplement to [windows-startup-optimization.md](./windows-startup-optimization.md), providing a more comprehensive optimization analysis for main.ts.

## 📊 In-Depth Analysis of Current Code

### Already Optimized ✅

Based on the existing code, the following optimizations **have already been implemented**:

1. **Analytics Parallel Initialization** - Analytics in `onReady` is already executed in parallel via IIFE
2. **AgentChat Lazy Loading** - Uses `setImmediate` for deferred loading in `ready-to-show`
3. **Window Priority Display** - `mainWindow.show()` is called immediately after `ready-to-show`

### Areas Still Requiring Optimization 🔴

The following issues still exist and severely impact startup performance on Windows:

---

## 🔥 Issue 1: Heavy Top-Level Imports

### Current Code (main.ts lines 22-36)

```typescript
import { profileCacheManager } from './lib/userDataADO';
import { runtimeManager } from './lib/runtime/RuntimeManager';
import { createLogger, resetGlobalLogger } from './lib/unifiedLogger';
import { UpdateManager } from './lib/autoUpdate/updateManager';
import { safeConsole, exitSafeLog } from './lib/utilities/safeConsole';
import { mainAuthManager } from './lib/auth/authManager';
import { mainTokenMonitor } from './lib/auth';
import { registerScreenshotIPC } from './lib/screenshot';
```

### Problem Analysis

These modules **execute code at import time**:

| Module | Side Effects at Import | Impact |
|--------|----------------------|--------|
| `profileCacheManager` | Creates singleton instance | Medium |
| `runtimeManager` | Creates singleton + calls `createLogger()` + reads config file | High |
| `createLogger` | May initialize log directory | Medium |
| `mainAuthManager` | Creates singleton instance | Medium |
| `mainTokenMonitor` | Creates singleton + imports entire auth module | High |
| `registerScreenshotIPC` | Function definition, no side effects | Low |

### Optimization Plan

Convert these modules to **on-demand dynamic imports**:

```typescript
// ❌ Current approach
import { profileCacheManager } from './lib/userDataADO';

// ✅ Optimized approach - import only when needed
let _profileCacheManager: typeof import('./lib/userDataADO').profileCacheManager | null = null;

async function getProfileCacheManager() {
  if (!_profileCacheManager) {
    const module = await import('./lib/userDataADO');
    _profileCacheManager = module.profileCacheManager;
  }
  return _profileCacheManager;
}
```

---

## 🔥 Issue 2: Synchronous dotenv Loading (Lines 43-57)

### Current Code

```typescript
const possibleEnvPaths = [
  path.join(__dirname, '../../.env.local'),
  path.join(process.cwd(), '.env.local'),
  path.join(app?.getAppPath() || process.cwd(), '.env.local'),
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {  // 🔥 Synchronous I/O
    require('dotenv').config({ path: envPath });  // 🔥 Synchronous require
    envLoaded = true;
    break;
  }
}
```

### Problem Analysis

- `fs.existsSync` is a **synchronous blocking** call
- Windows Defender scans each file access
- Scanning 3 paths = 3 I/O operations + 3 security scans

### Optimization Plan

```typescript
// Load asynchronously only in development, without blocking startup
if (process.env.NODE_ENV === 'development') {
  setImmediate(async () => {
    const possibleEnvPaths = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
    ];
    
    for (const envPath of possibleEnvPaths) {
      try {
        await fs.promises.access(envPath, fs.constants.F_OK);
        require('dotenv').config({ path: envPath });
        console.log('[Startup] Loaded .env.local from:', envPath);
        break;
      } catch {
        // File does not exist, continue to next
      }
    }
  });
}
```

---

## 🔥 Issue 3: Synchronous electron-reload Initialization (Lines 63-87)

### Current Code

```typescript
if (process.env.NODE_ENV === 'development') {
  try {
    const electronReload = require('electron-reload');  // 🔥 Synchronous require
    const watchPath = __dirname;
    
    console.log('[Hot Reload] 🔥 Development mode detected...');
    
    electronReload(watchPath, {
      electron: require.resolve('electron'),  // 🔥 Synchronous require.resolve
      // ...configuration
    });
  } catch (error) {
    console.error('[Hot Reload] ❌ Failed:', error);
  }
}
```

### Optimization Plan

```typescript
if (process.env.NODE_ENV === 'development') {
  // Defer to the next event loop iteration
  setImmediate(() => {
    try {
      const electronReload = require('electron-reload');
      electronReload(__dirname, {
        electron: require.resolve('electron'),
        hardResetMethod: 'exit',
        forceHardReset: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        ignored: [/node_modules/, /\.map$/],
      });
      console.log('[Hot Reload] ✅ Enabled');
    } catch (error) {
      console.error('[Hot Reload] ❌ Failed:', error);
    }
  });
}
```

---

## 🔥 Issue 4: Logger Synchronously Initialized Before Window (Lines 90-101)

### Current Code

```typescript
let advancedLogger: any;
const initLogger = () => {
  const logDirectory = path.join(app.getPath('userData'), 'logs');
  resetGlobalLogger();
  advancedLogger = createLogger();  // 🔥 May create directories and open file handles
  advancedLogger.updateConfig({ LOGGER_DIRECTORY: logDirectory });
};
```

Then called in the ElectronApp constructor:

```typescript
constructor() {
  // ...
  (() => {
    if (!advancedLogger) initLogger();  // 🔥 Synchronous call in constructor
    advancedLogger.info('ElectronApp initialized', ...);
  })();
}
```

### Optimization Plan

```typescript
// Use lazy initialization
let _advancedLogger: any = null;

function getLogger() {
  if (!_advancedLogger) {
    const { createLogger, resetGlobalLogger } = require('./lib/unifiedLogger');
    const logDirectory = path.join(app.getPath('userData'), 'logs');
    resetGlobalLogger();
    _advancedLogger = createLogger();
    _advancedLogger.updateConfig({ LOGGER_DIRECTORY: logDirectory });
  }
  return _advancedLogger;
}

// Use setImmediate to defer in the constructor
constructor() {
  // ...
  setImmediate(() => {
    getLogger().info('ElectronApp initialized', 'main', { isDev: this.isDev });
  });
}
```

---

## 🔥 Issue 5: Heavy ElectronApp Constructor (Lines 104-155)

### Current Issues

```typescript
constructor() {
  console.time('[Startup] ElectronApp constructor');
  
  // PATH environment variable setup - OK, very fast
  
  // 🔥 Feature Flag initialization - uses async IIFE, but still in constructor
  (async () => {
    const { featureFlagManager } = await import('./lib/featureFlags');
    featureFlagManager.initialize();
  })();
  
  this.setupEventHandlers();  // 🔥 Registers numerous IPC handlers
  setImmediate(() => this.initSelectionHook());  // ✅ Already optimized
  
  // 🔥 Logger initialization
  (() => {
    if (!advancedLogger) initLogger();
    advancedLogger.info('ElectronApp initialized', ...);
  })();
}
```

### Optimization Plan

```typescript
constructor() {
  console.time('[Startup] ElectronApp constructor');
  
  // Only set the most essential environment variables
  if (process.platform === 'darwin') {
    process.env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || '');
  }
  
  this.isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  
  // 🚀 Minimize event handler registration - only register startup essentials
  this.setupMinimalEventHandlers();
  
  console.timeEnd('[Startup] ElectronApp constructor');
  
  // All other initialization deferred until after onReady
}

private setupMinimalEventHandlers(): void {
  app.on('ready', this.onReady.bind(this));
  app.on('window-all-closed', this.onWindowAllClosed.bind(this));
  app.on('activate', this.onActivate.bind(this));
  app.on('before-quit', this.onBeforeQuit.bind(this));
}

// Other IPC handlers registered after window is shown
private async setupDeferredHandlers(): Promise<void> {
  // Register these handlers after the window is shown
  this.registerAuthHandlers();
  this.registerProfileHandlers();
  this.registerMcpHandlers();
  // ...
}
```

---

## 📋 Optimization Implementation Checklist

### Phase 1: Zero-Risk Quick Optimizations (Estimated Benefit: 30-50%)

- [ ] Convert dotenv to asynchronous loading
- [ ] Defer electron-reload to setImmediate
- [ ] Convert Logger to lazy initialization
- [ ] Move Feature Flag initialization to after onReady

### Phase 2: Medium-Risk Optimizations (Estimated Additional Benefit: 20-30%)

- [ ] Convert `profileCacheManager` to dynamic import
- [ ] Convert `mainAuthManager` to dynamic import  
- [ ] Convert `mainTokenMonitor` to dynamic import
- [ ] Register IPC handlers in batches

### Phase 3: Architecture-Level Optimizations (Long-Term)

- [ ] Extract IPC handlers into separate modules
- [ ] Convert singleton pattern to factory functions
- [ ] Webpack configuration optimization (code splitting)
- [ ] Consider using v8-compile-cache

---

## 🧪 Performance Verification

### Test Commands

```powershell
# 1. Add Defender exclusion for testing
Add-MpPreference -ExclusionPath "C:\Users\$env:USERNAME\AppData\Local\KOSMOS"

# 2. Cold start after clearing Node module cache
Remove-Item -Recurse -Force "C:\Users\$env:USERNAME\AppData\Local\KOSMOS\Cache"

# 3. Record startup time
$sw = [Diagnostics.Stopwatch]::StartNew()
Start-Process "C:\Users\$env:USERNAME\AppData\Local\KOSMOS\KOSMOS.exe"
# Manually record when the window appears
```

### Target Metrics

| Metric | Current Estimate | Target |
|--------|-----------------|--------|
| First Frame Display (Window Show) | 5-10s | < 2s |
| Fully Interactive | 10-15s | < 5s |
| Background Initialization Complete | - | < 10s |

---

## 📚 References

- [Electron Performance Best Practices](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Windows Defender Exclusions](https://docs.microsoft.com/en-us/windows/security/threat-protection/windows-defender-antivirus/configure-exclusions-windows-defender-antivirus)
- [Node.js Startup Optimization](https://nodejs.org/en/docs/guides/dont-block-the-event-loop)
