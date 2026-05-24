# Kosmos Built-in Runtime Environment Technical Plan

## 1. Overview
To enhance the availability and stability of Kosmos services (including MCP services and general command execution) across different user environments, we will implement a runtime environment management solution. This solution allows users to switch between "use system environment" and "use built-in environment", and supports managing the versions of built-in environments (Bun and uv), **as well as managing Python virtual environment/interpreter versions via uv**.

This plan is inspired by Cherry Studio's implementation, introducing Bun as a lightweight alternative to Node.js/npx, and uv as a Python environment management tool.
Since this environment is used not only for MCP services but also for general command execution (Execute Command), it is named Runtime Environment.

## 2. Core Strategy

The system adopts a **"use system environment by default, intelligent fallback, optional forced built-in environment"** strategy.

### 2.1 Runtime Modes
The app settings include a "Runtime Environment" configuration item with the following options:
1.  **System (Default)**: Preferentially uses `node/npx` and `python/pip/uv` from the user's environment variables.
2.  **Internal**: Forces use of the `bun` and `uv` binaries managed by Kosmos.

### 2.2 Environment Adaptation and Smart Fallback
*   **Node.js / npx**:
    *   **System mode**:
        *   Preferentially tries to call the system `npx`.
        *   **Smart fallback**: If no `npx`/`npm`/`node` command is found in the system, detects whether the built-in `bun` is installed. If installed, automatically uses `bun x -y` to take over execution, ensuring service availability.
    *   **Internal mode**: Forces use of the built-in `bun`, converting commands to `bun x -y ...` format to simulate `npx` behavior.
*   **Python / uv**:
    *   **System mode**:
        *   Preferentially tries to call the system `uvx` / `python` / `pip`.
        *   **Smart fallback**: If the above commands are not found in the system, detects whether the built-in `uv` is installed. If installed, automatically uses the built-in `uv` to take over execution.
    *   **Internal mode**: Forces use of the built-in `uv` to execute commands.

### 2.3 Version Management
*   **Tool versions**: Allows users to view and install/update Bun and uv in the settings UI.
*   **Python versions**: Supports managing Python interpreter versions via `uv` (`uv python install/list`), to meet the specific Python version requirements of different MCP Servers or scripts.
*   Built-in environment configurations are stored in the user data directory.

## 3. Technical Architecture

### 3.1 Directory Structure
Built-in binaries will be stored in the `bin` subdirectory under the application's user data directory (`userData`). This path is determined by the packaged application name (`AppName`) and is **not hardcoded**.

*   **Path rule**: `path.join(app.getPath('userData'), 'bin')`
*   **Windows**: `%AppData%\{AppName}\bin\` (e.g., `%AppData%\Kosmos\bin`)
*   **macOS**: `~/Library/Application Support/{AppName}/bin/`
*   **Linux**: `~/.config/{AppName}/bin/`

Directory structure example (using Kosmos as example):
```
%AppData%\Kosmos\
  bin\
    bun         # Bun runtime
    node        # Node.js compatibility
    npm         # npm compatibility
    npx         # npx compatibility
    pip         # pip compatibility
    python      # Python compatibility
    python3     # Python3 compatibility
    uv          # uv tool
    uvx         # uvx tool
```

### 3.2 Module Design

#### Main Process

1.  **`src/main/lib/runtime/RuntimeManager.ts`**
    *   **Responsibility**: Singleton management class, responsible for config management, path resolution, installation process, and IPC communication.
    *   **Core API**:
        *   `getInstance()`: Get singleton.
        *   `getRunTimeConfig()`: Get current mode and version config.
        *   `getBinaryPath(tool)`: Get absolute path for `bun` or `uv`.
        *   `isInstalled(tool)`: Check if the specified tool exists.
        *   `getEnvWithInternalPath(baseEnv)`: Get environment variable object with built-in `bin` path injected (includes PYTHONUTF8 fix).
        *   `installRuntime(tool, version)`: Call external scripts to perform download installation.
        *   **`listPythonVersions()`**: Call `uv python list` to get installed and available Python versions.
        *   **`installPythonVersion(version)`**: Call `uv python install <version>` to install the specified Python version.
    *   **IPC Handlers**:
        *   `runtime:get-config`
        *   `runtime:set-mode`
        *   `runtime:install-component`
        *   `runtime:check-status`
        *   `runtime:list-python-versions`: Returns Python version list.
        *   `runtime:install-python-version`: Triggers Python installation.

2.  **`src/main/lib/terminalManager/TerminalInstance.ts` (Environment Variable Management)**
    *   **Responsibility**: Unified management of environment variables for all command executions.
    *   **Core Logic**:
        *   Based on runtime mode (internal/system), decides whether to prepend `{userData}/bin` to PATH.
        *   **Internal mode**: Add bin directory to front of PATH, commands use executables in bin directory directly (bun, node, npm, npx, pip, python, python3, uv, uvx).
        *   **System mode**: Don't add bin directory, use system PATH.
        *   In shell wrapper, after loading user config, re-prepend the bin directory (overriding pyenv/nvm etc. modifications).

3.  **`src/main/lib/mcpRuntime/vscMcpClient.ts`**
    *   **Responsibility**: MCP client adapter, directly passes raw config to TerminalInstance.
    *   **Design principle**: No command conversion or environment variable injection; all environment management is handled uniformly by TerminalInstance.

4.  **Installation Scripts (`resources/scripts/`)**
    *   `install-bun.js`: Downloads and extracts Bun (uses `node-stream-zip`).
    *   `install-uv.js`: Downloads and extracts uv.
    *   `download.js`: General download utility, supports redirects.
    *   **Execution mechanism**: Executed independently by `RuntimeManager` via `child_process.spawn`, to avoid blocking the main process.

#### Renderer Process

1.  **`src/renderer/components/settings/RuntimeSettings.tsx`**
    *   **UI**: Embedded in the settings UI, provides Mode switching (System/Internal) and tool installation/status check.
    *   **New features**:
        *   **Python Management**: Displays installed Python version list.
        *   Provides input box or selector for installing new Python versions (e.g., `3.10`, `3.11`, `3.12`).
    *   **Interaction**: Communicates with main process via `window.electronAPI.runtime`.

### 3.3 Data Storage
*   **Config file**: `runtimeConfig.json` stored in the `userData` directory.
*   **Content**: Contains `mode` (system/internal), `bunVersion`, `uvVersion`.

## 4. Implementation Details Summary

### 4.1 Environment Variable Fixes
In `RuntimeManager.getEnvWithInternalPath`, in addition to adding the `bin` directory to `PATH`, the following environment variables are injected by default to resolve Python encoding issues on Windows:
*   `PYTHONUTF8=1`
*   `PYTHONIOENCODING=utf-8`

### 4.2 Built-in Executables
The `{userData}/bin/` directory contains a complete set of executables, no command conversion needed:

*   **Executable list**: `bun`, `node`, `npm`, `npx`, `pip`, `python`, `python3`, `uv`, `uvx`
*   **How it works**:
    *   TerminalInstance prepends the bin directory to PATH
    *   Commands execute the binaries in the bin directory directly
    *   No command conversion or interception needed

### 4.3 TerminalInstance Environment Management
`TerminalInstance` is the sole entry point for environment variable management:

*   **Internal mode**: 
    *   Call `PlatformConfigManager.getEnhancedEnvironment(true)` to add bin directory to PATH
    *   In shell wrapper, after loading user profile, re-prepend the bin directory
*   **System mode**:
    *   Call `PlatformConfigManager.getEnhancedEnvironment(false)` without adding bin directory
    *   Use system default PATH

*   **Design principle**: `vscMcpClient` and `executeCommandTool` do not manage environment variables; they pass config directly to TerminalInstance.

### 4.4 Isolated Process Installation
The installation process runs entirely in standalone Node.js scripts under `resources/scripts`. The main process only handles `spawn` and listening to `stdout/stderr` logs. This ensures that CPU usage during download and extraction does not cause Electron UI lag.

### 4.5 Python Version Management Implementation
Beyond basic tool installation, `RuntimeManager` will use the installed `uv` to manage Python versions.
*   **Command calls**: Use `bin/uv python list` and `bin/uv python install <version>`.
*   **Environment variables**: When executing these commands, `UV_PYTHON_INSTALL_DIR` must be injected or rely on `uv`'s default behavior (AppData/Roaming/uv/python), ensuring Python is installed in the user's expected location or isolated environment.
    *   *Recommended strategy*: Temporarily use the default path, so users can reuse these Python versions with `uv` in terminal.
*   **UI experience**: The frontend provides a list that parses the output of `uv python list` (typically includes Version, Path, Status), displays it to users, and allows one-click installation of common versions (3.10, 3.11, 3.12).
