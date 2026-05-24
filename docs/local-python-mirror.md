# Kosmos Local Python Mirror and Proxy Solution

## 1. Background and Goals
The current `uv python install` command depends on downloading Python build packages (`python-build-standalone`) from GitHub Releases. Due to network environment restrictions, downloads are often slow or fail entirely.
To improve the success rate and speed of Python environment setup, Kosmos optimizes this process from an "offline-first" perspective:
1.  **Pre-bundling**: Commonly used Python build packages are pre-bundled into the application resources.
2.  **Local proxy**: The app launches a local proxy service that intercepts `uv`'s download requests.
3.  **Smart distribution**: The proxy service first returns local cached files, and automatically falls back (via Redirect) to the GitHub source when a file is missing.

## 2. Core Architecture

### 2.1 Directory Structure Changes
Pre-downloaded Python packages are maintained under the `resources` directory, organized by tag.

```
resources/
└── python/
    └── 20240106/ (Tag directory)
        └── cpython-3.12.1+20240106-x86_64-pc-windows-msvc-install_only.tar.gz
    └── ... (other common versions)
```

### 2.2 Local Python Mirror Service
A lightweight HTTP Server (using the Node.js native `http` module) runs in the Main Process, listening on a random available port on the local loopback address (e.g., `127.0.0.1:45678`).

#### Request Handling Logic
The default download source URL pattern used by `uv` is:
`{MIRROR}/{TAG}/{FILENAME}`

When we set the environment variable `UV_PYTHON_INSTALL_MIRROR` to `http://127.0.0.1:45678`, requests made by `uv` become:
`GET http://127.0.0.1:45678/{TAG}/{FILENAME}`

**Processing flow**:
1.  Parse the URL to extract `{FILENAME}` (ignore `{TAG}` or use it for validation; filenames are usually globally unique).
2.  Check whether `resources/python/{FILENAME}` exists.
3.  **Hit (local cache found)**:
    *   Read the local file stream.
    *   Set the correct `Content-Type` and `Content-Length`.
    *   Pipe to the Response.
    *   *Advantage*: LAN/disk speed, zero network dependency.
4.  **Miss (not found locally)**:
    *   Construct the original GitHub URL: `https://github.com/astral-sh/python-build-standalone/releases/download/{TAG}/{FILENAME}`.
    *   Return `302 Found` redirect.
    *   *Advantage*: Seamless fallback; `uv` will automatically follow the redirect and download from GitHub.
    
### 2.3 RuntimeManager Integration
The proxy address is injected dynamically via environment variables in `RuntimeManager.getEnvWithInternalPath()`.

## 3. Implementation Guide

### 3.1 New Module `src/main/lib/runtime/LocalPythonMirror.ts`

```typescript
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { AddressInfo } from 'net';

const logger = createLogger();

export class LocalPythonMirror {
  private static instance: LocalPythonMirror;
  private server: http.Server | null = null;
  private port: number = 0;
  private resourcesPath: string;

  private constructor() {
    this.resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'python')
      : path.join(process.cwd(), 'resources', 'python');
  }

  public static getInstance(): LocalPythonMirror {
    if (!LocalPythonMirror.instance) {
      LocalPythonMirror.instance = new LocalPythonMirror();
    }
    return LocalPythonMirror.instance;
  }

  public async start(): Promise<string> {
    if (this.server) {
        return this.getBaseUrl();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on random port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as AddressInfo;
        this.port = address.port;
        logger.info(`[LocalPythonMirror] Started on port ${this.port}`, 'RuntimeManager');
        resolve(this.getBaseUrl());
      });
      
      this.server.on('error', (err) => {
        logger.error(`[LocalPythonMirror] Server error`, 'RuntimeManager', { error: err });
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Expected format: /TAG/FILENAME
    // Example: /20240106/cpython-3.12.1+20240106-x86_64-pc-windows-msvc-install_only.tar.gz
    logger.debug(`[LocalPythonMirror] Received request: ${req.url}`, 'RuntimeManager');
    try {
        const decodedUrl = req.url ? decodeURIComponent(req.url) : '';
        const urlParts = decodedUrl.split('/').filter(Boolean);
        if (urlParts.length < 2) {
            res.statusCode = 400;
            res.end('Invalid request format');
            return;
        }

        const tag = urlParts[urlParts.length - 2];
        const filename = urlParts[urlParts.length - 1];
        
        // Check local file
        const localFilePath = path.join(this.resourcesPath, tag, filename);
        
        if (fs.existsSync(localFilePath)) {
            logger.info(`[LocalPythonMirror] Serving local file: ${filename}`, 'RuntimeManager');
            const stat = fs.statSync(localFilePath);
            res.writeHead(200, {
                'Content-Type': 'application/gzip',
                'Content-Length': stat.size
            });
            const readStream = fs.createReadStream(localFilePath);
            readStream.pipe(res);
        } else {
            // Redirect to GitHub
            const githubUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${filename}`;
            logger.info(`[LocalPythonMirror] File not found locally, redirecting to: ${githubUrl}`, 'RuntimeManager');
            res.writeHead(302, { 'Location': githubUrl });
            res.end();
        }
    } catch (error) {
        logger.error(`[LocalPythonMirror] Request handling error`, 'RuntimeManager', { error });
        res.statusCode = 500;
        res.end('Internal Server Error');
    }
  }
}
```

### 3.2 `RuntimeManager` Changes

1.  **Start the service on demand**: Initialize and start `LocalPythonMirror` in the `installPythonVersion` method, and stop the service after installation completes.
2.  **Inject variable**: Add `UV_PYTHON_INSTALL_MIRROR` in `getEnvWithInternalPath`.

```typescript
// RuntimeManager.ts

// ... imports
import { LocalPythonMirror } from './LocalPythonMirror';

class RuntimeManager {
    // ...

    public async installPythonVersion(version: string): Promise<void> {
        // ...
        
        // Start global mirror before installation
        const mirror = LocalPythonMirror.getInstance();
        try {
             await mirror.start();
        } catch (e) {
             logger.warn(`[FRE] Failed to start local python mirror, proceeding without it`, 'RuntimeManager', { error: e });
        }

        try {
            await this.doInstallPythonVersion(version);
        } finally {
            // Stop mirror
            mirror.stop();
        }
    }

    public getEnvWithInternalPath(baseEnv = process.env): NodeJS.ProcessEnv {
        // ... existing logic
        
        const mirrorUrl = LocalPythonMirror.getInstance().getBaseUrlIfRunning();
        if (mirrorUrl) {
             env['UV_PYTHON_INSTALL_MIRROR'] = mirrorUrl;
        }
        
        return env;
    }
}
```

### 3.3 Build Configuration (`electron-builder`)
To avoid inflating the installation package size, **platform-specific packaging must be configured** to ensure the Windows package includes only Windows Python, and macOS only macOS Python.

It is recommended to distinguish platforms by filename or subdirectory under `resources/python`, for example:
*   Windows: `cpython-*-windows-*.tar.gz`
*   macOS: `cpython-*-apple-*.tar.gz`
*   Linux: `cpython-*-linux-*.tar.gz`

**package.json / electron-builder.config.js (recommended configuration)**:

We can use `electron-builder`'s platform-specific configuration (`win`, `mac`, `linux`) along with `filter` to select files.

```yaml
# No python included in global or base configuration
extraResources: []

# Windows-specific configuration
win:
  extraResources:
    - from: "resources/python"
      to: "python"
      filter: 
        - "*windows*"  # Only bundle packages whose filename contains "windows"

# macOS-specific configuration
mac:
  extraResources:
    - from: "resources/python"
      to: "python"
      filter: 
        - "*apple*"    # Only bundle packages whose filename contains "apple" (supports x86_64, aarch64, or universal)

# Linux-specific configuration
linux:
  extraResources:
    - from: "resources/python"
      to: "python"
      filter: 
        - "*linux*"
```

**About the storage path**:
`resources/python` is only the recommended path. As long as `LocalPythonMirror.ts` points to the correct path and `electron-builder` is configured with the correct `from` and `to`, you can place the files anywhere in the project (e.g., `assets/python_bundles`).

The key points are:
1.  **Dev mode**: `LocalPythonMirror` can locate the files in the source directory.
2.  **Prod mode**: `LocalPythonMirror` can find the corresponding files under `process.resourcesPath` (determined by the `to` property of `extraResources`).

## 4. Summary of Advantages
1.  **Ultra-fast installation**: For bundled Python versions, installation time is reduced from minutes to seconds (extraction time only).
2.  **High availability**: Even when GitHub access is restricted, the Python environment for core functionality can still be deployed successfully.
3.  **Non-intrusive**: `uv` is unaware of the proxy; no changes to `uv`'s own code or logic are needed.
4.  **Easy maintenance**: Upgrading the bundled Python version only requires replacing files under `resources/python`.

## 5. Items to Confirm
*   Confirm `uv`'s support for `302 Redirect` (generally supported).
*   Confirm cross-platform path compatibility for Windows/Mac/Linux.
