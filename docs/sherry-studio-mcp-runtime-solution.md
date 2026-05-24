# Cherry Studio Built-in MCP Runtime Environment Solution
Project path: F:\repos\cherry-studio
## 1. Overview
To ensure stable operation of MCP (Model Context Protocol) services, especially for users who do not have Node.js or Python environments pre-installed, Cherry Studio provides a complete runtime environment fallback and automatic installation solution.

This solution primarily targets:
- **Bun**: as a lightweight, high-performance alternative to Node.js / `npx`.
- **uv / uvx**: as a Python environment management tool, replacing traditional pip/venv.

## 2. Core Strategy

The system uses a **"prefer system environment, fall back to built-in environment"** strategy.

### 2.1 Node.js / npx Environment
1.  **System detection**: When starting an MCP service, first detect whether `npx` exists in the user's Shell environment.
2.  **Fallback**: If `npx` is not found, check for the built-in `bun` binary.
3.  **Compatible execution**: If using the built-in `bun`, the system automatically converts commands to `bun x -y ...` format to simulate `npx` behavior, ensuring that existing MCP Server commands (typically npx-based) can run directly.

### 2.2 Python / uv Environment
1.  **System detection**: Detect whether `uv` or `uvx` exists in the user's Shell environment.
2.  **Fallback**: If not installed on the system, fall back to the built-in binary path.

## 3. Technical Implementation

### 3.1 Directory Structure
All built-in runtime binaries are stored in a hidden folder in the user's home directory, isolated from the application installation directory for easy updates and management.
- **Windows**: `C:\Users\{User}\.cherrystudio\bin\`
- **macOS/Linux**: `~/.cherrystudio/bin/`

### 3.2 Key Code Modules

*   **`src/main/services/MCPService.ts`**:
    Handles MCP service startup logic. When building the startup command, it contains environment detection and command substitution logic.
*   **`src/main/utils/process.ts`**:
    Provides the `runInstallScript(scriptPath)` function, which creates a subprocess (`child_process.spawn`) to execute scripts under `resources/scripts/`. Also provides utility functions like `isBinaryExists` and `getBinaryPath` for unified access to the `.cherrystudio/bin` directory.
*   **`resources/scripts/`**:
    Contains Node.js scripts that perform the actual download and installation.

## 4. Installation Mechanism

Cherry Studio does not bundle these binaries in the installer package; instead it provides on-demand download capability.

### 4.1 Installation Scripts
Installation scripts are located in the `resources/scripts/` directory:
- **`install-bun.js`**: Downloads and extracts Bun.
- **`install-uv.js`**: Downloads and extracts uv.

### 4.2 Download Source Strategy
To optimize the download experience for users in China, the scripts default to using the **GitCode mirror** (`gitcode.com/CherryHQ/...`) to ensure download speed and stability.

### 4.3 Cross-Platform Support
The scripts automatically select the correct binary package based on the current operating system (Windows/macOS/Linux) and CPU architecture (x64/arm64).
- **Linux special handling**: On Linux, the scripts support detecting both glibc and musl (Alpine) variants.

## 5. Interaction Flow

1.  **User trigger**:
    In the `Settings` -> `MCP Servers` interface, the system detects the environment status. If something is missing, the user clicks the install button.
2.  **Frontend call**:
    The React component calls `window.api.installUVBinary()` or `installBunBinary()`.
3.  **IPC communication**:
    The request is sent to the main process via an IPC channel (`IpcChannel.App_InstallUvBinary`, etc.).
4.  **Script execution**:
    The main process creates a subprocess (spawn) via the `runInstallScript` function (in `process.ts`) to run the corresponding `.js` installation script. Example: `runInstallScript('install-bun.js')`.
5.  **State synchronization**:
    After installation completes, the main process logs it; the frontend polls or receives status updates; the UI shows "Installed".

## 6. File List

- `src/main/services/MCPService.ts` - Core detection logic
- `src/main/utils/process.ts` - Path management utilities
- `src/main/ipc.ts` - IPC event registration
- `resources/scripts/install-bun.js` - Bun installation script
- `resources/scripts/install-uv.js` - uv installation script
- `resources/scripts/download.js` - General download utility
- `src/renderer/src/pages/settings/MCPSettings/InstallNpxUv.tsx` - Frontend settings interface
