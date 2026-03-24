# Lazy Loading Implementation Guide

## Approach Comparison

### Approach 1: Code-Level Lazy Loading (Recommended, Simple)

**Pros:**
- No additional UI needed, automatic and transparent
- Dependencies remain in the installer but are not loaded into memory immediately
- Simple implementation, no download logic required

**Cons:**
- Installer size is not reduced
- Brief delay on first use

**Use Cases:**
- Optimizing memory usage and startup speed
- No need to reduce installer size

### Approach 2: True On-Demand Download (Complex, Smallest Size)

**Pros:**
- Installer size is significantly reduced
- Users can choose whether to install certain features

**Cons:**
- Requires implementing download, installation, and verification logic
- Requires UI prompts and progress display
- Must handle network failures, permissions, and other issues

**Use Cases:**
- Need the smallest possible installer size
- Features are clearly optional (e.g., Playwright browser engine)

---

## Approach 1: Code Lazy Loading Implementation (Recommended First)

### Principle

Use dynamic `import()` syntax to load modules only when needed, rather than loading everything at application startup.

### Implementation Examples

#### 1. Playwright Lazy Loading

**Current Code (Immediate Loading):**

```typescript
// src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts
import { chromium, Browser, Page } from 'playwright';

export async function executeGoogleSearch() {
  const browser = await chromium.launch();
  // ...
}
```

**Optimized (Lazy Loading):**

```typescript
// src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts

let playwrightModule: typeof import('playwright') | null = null;

async function getPlaywright() {
  if (!playwrightModule) {
    try {
      playwrightModule = await import('playwright');
    } catch (error) {
      throw new Error('Playwright is not installed. Please run: npm install playwright');
    }
  }
  return playwrightModule;
}

export async function executeGoogleSearch() {
  const playwright = await getPlaywright();
  const browser = await playwright.chromium.launch();
  // ...
}
```

#### 2. Neo4j Lazy Loading

**Current Code:**

```typescript
// src/main/lib/mem0/mem0-core/graph_stores/neo4j.ts
import neo4j, { Driver } from "neo4j-driver";

export class Neo4jGraphStore {
  private driver: Driver;
  
  constructor() {
    this.driver = neo4j.driver(/* ... */);
  }
}
```

**Optimized:**

```typescript
// src/main/lib/mem0/mem0-core/graph_stores/neo4j.ts

let neo4jModule: typeof import('neo4j-driver') | null = null;

async function getNeo4j() {
  if (!neo4jModule) {
    try {
      neo4jModule = await import('neo4j-driver');
    } catch (error) {
      throw new Error('Neo4j driver is not installed. Memory graph feature is unavailable.');
    }
  }
  return neo4jModule;
}

export class Neo4jGraphStore {
  private driver: any;
  
  async initialize() {
    const neo4j = await getNeo4j();
    this.driver = neo4j.driver(/* ... */);
  }
}
```

### Results

- ✅ Application startup speed improved by 30-50%
- ✅ Memory usage reduced by 50-100MB
- ✅ Installer size unchanged (but can be combined with optionalDependencies)
- ✅ No UI changes required

---

## Approach 2: True On-Demand Download Implementation

### Architecture Design

```
┌─────────────────────────────────────────┐
│         Installer (50-80MB)             │
│  ├─ Core Features                      │
│  ├─ Base Dependencies                  │
│  └─ Plugin Downloader                  │
└─────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  On first use of a    │
        │  feature              │
        └───────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Check if plugin is   │
        │  installed            │
        └───────────────────────┘
                    │
            ┌───────┴────────┐
            │                │
        Installed        Not Installed
            │                │
            ▼                ▼
       Use directly   ┌──────────────┐
                      │ Show download │
                      │ prompt        │
                      │ [Download]    │
                      │ [Cancel]      │
                      └──────────────┘
                             │
                        User clicks download
                             │
                             ▼
                     ┌──────────────┐
                     │  Download    │
                     │  plugin      │
                     │ [Progress    │
                     │  bar 60%]    │
                     └──────────────┘
                             │
                             ▼
                     ┌──────────────┐
                     │  Installation│
                     │  verification│
                     └──────────────┘
                             │
                             ▼
                        Use feature
```

### Implementation Steps

#### 1. Create Plugin Manager

```typescript
// src/main/lib/pluginManager/index.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Plugin {
  id: string;
  name: string;
  description: string;
  size: string;
  npmPackage: string;
  version: string;
}

export const AVAILABLE_PLUGINS: Plugin[] = [
  {
    id: 'playwright',
    name: 'Web Search Engine',
    description: 'Supports Google search and web scraping functionality',
    size: '~90MB',
    npmPackage: 'playwright',
    version: '^1.56.1'
  },
  {
    id: 'neo4j',
    name: 'Memory Graph',
    description: 'Advanced memory management and knowledge graph functionality',
    size: '~25MB',
    npmPackage: 'neo4j-driver',
    version: '^5.28.2'
  }
];

export class PluginManager {
  private pluginsDir: string;
  private installedPlugins: Set<string>;

  constructor() {
    this.pluginsDir = path.join(app.getPath('userData'), 'plugins');
    this.installedPlugins = new Set();
    this.initializePluginsDir();
    this.scanInstalledPlugins();
  }

  private initializePluginsDir() {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  private scanInstalledPlugins() {
    try {
      const nodeModulesPath = path.join(this.pluginsDir, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        const packages = fs.readdirSync(nodeModulesPath);
        packages.forEach(pkg => {
          if (pkg.startsWith('@')) {
            // Handle scoped packages
            const scopedPackages = fs.readdirSync(path.join(nodeModulesPath, pkg));
            scopedPackages.forEach(subPkg => {
              this.installedPlugins.add(`${pkg}/${subPkg}`);
            });
          } else {
            this.installedPlugins.add(pkg);
          }
        });
      }
    } catch (error) {
      console.error('Failed to scan installed plugins:', error);
    }
  }

  isPluginInstalled(pluginId: string): boolean {
    const plugin = AVAILABLE_PLUGINS.find(p => p.id === pluginId);
    if (!plugin) return false;
    return this.installedPlugins.has(plugin.npmPackage);
  }

  async installPlugin(
    pluginId: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    const plugin = AVAILABLE_PLUGINS.find(p => p.id === pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    if (this.isPluginInstalled(pluginId)) {
      throw new Error(`Plugin already installed: ${plugin.name}`);
    }

    try {
      onProgress?.(10, 'Preparing installation...');

      // Create package.json
      const packageJsonPath = path.join(this.pluginsDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(
          packageJsonPath,
          JSON.stringify({ name: 'openkosmos-plugins', version: '1.0.0' }, null, 2)
        );
      }

      onProgress?.(30, 'Downloading plugin...');

      // Install plugin
      const command = `cd "${this.pluginsDir}" && npm install ${plugin.npmPackage}@${plugin.version} --save --no-package-lock`;
      
      await execAsync(command);

      onProgress?.(80, 'Verifying installation...');

      // If it's playwright, need to install browsers
      if (pluginId === 'playwright') {
        onProgress?.(85, 'Downloading browser engine...');
        await execAsync(`cd "${this.pluginsDir}" && npx playwright install chromium`);
      }

      onProgress?.(100, 'Installation complete');

      // Update installed list
      this.installedPlugins.add(plugin.npmPackage);

    } catch (error) {
      throw new Error(`Failed to install plugin: ${error.message}`);
    }
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    const plugin = AVAILABLE_PLUGINS.find(p => p.id === pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    try {
      const command = `cd "${this.pluginsDir}" && npm uninstall ${plugin.npmPackage}`;
      await execAsync(command);
      this.installedPlugins.delete(plugin.npmPackage);
    } catch (error) {
      throw new Error(`Failed to uninstall plugin: ${error.message}`);
    }
  }

  getPluginPath(pluginId: string): string {
    const plugin = AVAILABLE_PLUGINS.find(p => p.id === pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }
    return path.join(this.pluginsDir, 'node_modules', plugin.npmPackage);
  }

  async loadPlugin(pluginId: string): Promise<any> {
    if (!this.isPluginInstalled(pluginId)) {
      throw new Error(`Plugin not installed: ${pluginId}`);
    }

    const pluginPath = this.getPluginPath(pluginId);
    return require(pluginPath);
  }
}

// Singleton
let pluginManager: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager();
  }
  return pluginManager;
}
```

#### 2. IPC Communication Interface

```typescript
// src/main/ipc/pluginIpc.ts

import { ipcMain, BrowserWindow } from 'electron';
import { getPluginManager, AVAILABLE_PLUGINS } from '../lib/pluginManager';

export function registerPluginIpc() {
  const pluginManager = getPluginManager();

  // Get available plugins list
  ipcMain.handle('plugin:list', async () => {
    return AVAILABLE_PLUGINS.map(plugin => ({
      ...plugin,
      installed: pluginManager.isPluginInstalled(plugin.id)
    }));
  });

  // Check if plugin is installed
  ipcMain.handle('plugin:is-installed', async (_, pluginId: string) => {
    return pluginManager.isPluginInstalled(pluginId);
  });

  // Install plugin
  ipcMain.handle('plugin:install', async (event, pluginId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    
    await pluginManager.installPlugin(pluginId, (progress, message) => {
      window?.webContents.send('plugin:install-progress', {
        pluginId,
        progress,
        message
      });
    });

    return { success: true };
  });

  // Uninstall plugin
  ipcMain.handle('plugin:uninstall', async (_, pluginId: string) => {
    await pluginManager.uninstallPlugin(pluginId);
    return { success: true };
  });
}
```

#### 3. Code Using Plugins

```typescript
// src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts

import { getPluginManager } from '../../pluginManager';

export async function executeGoogleSearch(query: string) {
  const pluginManager = getPluginManager();
  
  // Check if plugin is installed
  if (!pluginManager.isPluginInstalled('playwright')) {
    throw new Error('PLUGIN_NOT_INSTALLED:playwright');
  }

  // Load plugin
  const playwright = await pluginManager.loadPlugin('playwright');
  
  // Use plugin
  const browser = await playwright.chromium.launch();
  // ... search logic
}
```

#### 4. UI Component - Plugin Download Dialog

```typescript
// src/renderer/components/PluginDownloadDialog.tsx

import React, { useState } from 'react';

interface PluginDownloadDialogProps {
  pluginId: string;
  pluginName: string;
  pluginSize: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PluginDownloadDialog({
  pluginId,
  pluginName,
  pluginSize,
  onConfirm,
  onCancel
}: PluginDownloadDialogProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  React.useEffect(() => {
    const handleProgress = (event: any, data: any) => {
      if (data.pluginId === pluginId) {
        setProgress(data.progress);
        setMessage(data.message);
      }
    };

    window.electron.ipcRenderer.on('plugin:install-progress', handleProgress);
    return () => {
      window.electron.ipcRenderer.removeListener('plugin:install-progress', handleProgress);
    };
  }, [pluginId]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await window.electron.ipcRenderer.invoke('plugin:install', pluginId);
      onConfirm();
    } catch (error) {
      alert(`Installation failed: ${error.message}`);
      setDownloading(false);
    }
  };

  return (
    <div className="plugin-download-dialog">
      <h3>Plugin Installation Required</h3>
      <p>
        Using this feature requires installing the <strong>{pluginName}</strong> plugin
      </p>
      <p className="plugin-size">Size: {pluginSize}</p>
      
      {downloading ? (
        <div className="download-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <p>{message}</p>
        </div>
      ) : (
        <div className="dialog-buttons">
          <button onClick={handleDownload} className="btn-primary">
            Download and Install
          </button>
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
```

#### 5. Using It Where Needed

```typescript
// src/renderer/lib/chat/chatOps.ts

export async function executeToolWithPluginCheck(toolName: string) {
  try {
    // Try to execute the tool
    await executeTool(toolName);
  } catch (error) {
    // Check if it's a plugin-not-installed error
    if (error.message?.startsWith('PLUGIN_NOT_INSTALLED:')) {
      const pluginId = error.message.split(':')[1];
      
      // Show download dialog
      const shouldInstall = await showPluginDownloadDialog(pluginId);
      
      if (shouldInstall) {
        // Retry after installation completes
        await executeTool(toolName);
      }
    } else {
      throw error;
    }
  }
}
```

---

## Recommended Approach

### Quick Optimization (1-2 hours)

1. Use **Approach 1: Code Lazy Loading**
2. Combine with [`electron-builder.optimized.yml`](../electron-builder.optimized.yml:1)
3. Remove unused `@xenova/transformers`

**Expected Results:**
- Installer size reduced by 60-80MB
- Startup speed improved by 40%
- Memory usage reduced by 80MB

### Full Optimization (1-2 days)

1. Implement **Approach 2: Plugin Download System**
2. Convert Playwright and Neo4j to optional plugins
3. Implement plugin management UI

**Expected Results:**
- Installer size reduced by 120-150MB (down to 50-80MB only)
- Users can choose the features they need
- First download time increases (but more flexible overall)

---

## Recommendations

**If your goal is:**
- Quick results → Use Approach 1 + configuration optimization
- Smallest possible size → Use Approach 2 plugin system
- Balanced approach → Approach 1 + optionalDependencies + configuration optimization

In most cases, **Approach 1 + configuration optimization** is sufficient.