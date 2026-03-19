# Cherry Studio Built-in MCP Runtime Environment Solution
Project path: F:\repos\cherry-studio
## 1. Overview
Cherry Studio provides a complete runtime environment fallback and auto-installation solution to ensure stable operation of MCP (Model Context Protocol) services, especially for users who do not have Node.js or Python pre-installed.

This solution primarily targets:
- **Bun**: A lightweight, high-performance alternative to Node.js / `npx`.
- **uv / uvx**: Python environment management tools, replacing traditional pip/venv.

## 2. Core Strategy

The system adopts a **"prefer system environment, fall back to built-in environment"** strategy.

### 2.1 Node.js / npx Environment
1.  **System Detection**: When starting an MCP service, the system first checks whether `npx` exists in the user's shell environment.
2.  **Fallback**: If `npx` is not found, it checks for the built-in `bun` binary.
3.  **Compatible Execution**: If the built-in `bun` is used, the system automatically converts commands to `bun x -y ...` format to emulate `npx` behavior, ensuring existing MCP Server commands (typically based on npx) can run directly.

### 2.2 Python / uv Environment
1.  **System Detection**: Checks whether `uv` or `uvx` exists in the user's shell environment.
2.  **Fallback**: If not installed on the system, falls back to the built-in binary file path.

## 3. Technical Implementation

### 3.1 Directory Structure
All built-in runtime binaries are stored in a hidden folder under the user's home directory, isolated from the application installation directory for easy updates and management.
- **Windows**: `C:\Users\{User}\.cherrystudio\bin\`
- **macOS/Linux**: `~/.cherrystudio/bin/`

### 3.2 Key Code Modules

*   **`src/main/services/MCPService.ts`**:
    Responsible for MCP service startup logic. Includes environment detection and command substitution logic when building startup commands.
*   **`src/main/utils/process.ts`**:
    Provides the `runInstallScript(scriptPath)` function, which executes scripts under `resources/scripts/` via `child_process.spawn`. Also provides utility functions such as `isBinaryExists` and `getBinaryPath` for unified management of access to the `.cherrystudio/bin` directory.
*   **`resources/scripts/`**:
    Contains the Node.js scripts that perform the actual downloading and installation.

## 4. Installation Mechanism

Cherry Studio does not bundle these binaries in the installer package; instead, it provides on-demand download functionality.

### 4.1 Installation Scripts
Installation scripts are located in the `resources/scripts/` directory:
- **`install-bun.js`**: Responsible for downloading and extracting Bun.
- **`install-uv.js`**: Responsible for downloading and extracting uv.

### 4.2 Download Source Strategy
To optimize the download experience for users in China, the scripts default to using the **GitCode mirror source** (`gitcode.com/CherryHQ/...`), ensuring download speed and stability.

### 4.3 Cross-Platform Support
Scripts automatically select the correct binary package based on the current operating system (Windows/macOS/Linux) and CPU architecture (x64/arm64).
- **Linux Special Handling**: For Linux environments, supports identifying glibc and musl (Alpine) variants.

## 5. Interaction Flow

1.  **User Trigger**:
    In the `Settings` -> `MCP Servers` interface, the system checks the environment status. If dependencies are missing, the user clicks the install button.
2.  **Frontend Call**:
    The React component calls `window.api.installUVBinary()` or `installBunBinary()`.
3.  **IPC Communication**:
    The request is sent to the main process via IPC channel (`IpcChannel.App_InstallUvBinary`, etc.).
4.  **Script Execution**:
    The main process uses the `runInstallScript` function (located in `process.ts`) to create a child process (spawn) that runs the corresponding `.js` installation script. For example: `runInstallScript('install-bun.js')`.
5.  **Status Synchronization**:
    After installation completes, the main process logs the result, the frontend polls or receives status updates, and the UI displays "Installed".

## 6. File List

- `src/main/services/MCPService.ts` - Core detection logic
- `src/main/utils/process.ts` - Path management utilities
- `src/main/ipc.ts` - IPC event registration
- `resources/scripts/install-bun.js` - Bun installation script
- `resources/scripts/install-uv.js` - uv installation script
- `resources/scripts/download.js` - General download utility
- `src/renderer/src/pages/settings/MCPSettings/InstallNpxUv.tsx` - Frontend settings interface