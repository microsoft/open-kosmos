# Kosmos Built-in Runtime Environment Technical Proposal

## 1. Overview
To enhance the availability and stability of Kosmos services (including MCP services and general command execution) across different user environments, we will implement a runtime environment management solution. This solution allows users to switch between "using the system environment" and "using the built-in environment," and supports managing the versions of built-in environments (Bun and uv), **as well as managing Python virtual environments/interpreter versions via uv**.

This proposal is inspired by Cherry Studio's implementation, introducing Bun as a lightweight alternative to Node.js/npx, and uv as a Python environment management tool.
Since this environment is used not only for MCP services but also for general command execution (Execute Command), it is named Runtime Environment.

## 2. Core Strategy

The system adopts a **"default to system environment, smart fallback, with optional forced built-in environment"** strategy.

### 2.1 Runtime Mode
The application settings include a "Runtime Environment" configuration option with the following choices:
1.  **System (Default)**: Preferentially uses `node/npx` and `python/pip/uv` from the user's environment variables.
2.  **Internal**: Forces priority use of Kosmos-managed `bun` and `uv` binaries.

### 2.2 Environment Adaptation and Smart Fallback
*   **Node.js / npx**:
    *   **System Mode**:
        *   Preferentially attempts to invoke the system `npx`.
        *   **Smart Fallback**: If `npx`/`npm`/`node` commands are not found on the system, it checks whether the built-in `bun` is installed. If installed, it automatically uses `bun x -y` to take over execution, ensuring service availability.
    *   **Internal Mode**: Forces use of the built-in `bun` and converts the command format to `bun x -y ...` to emulate `npx` behavior.
*   **Python / uv**:
    *   **System Mode**:
        *   Preferentially attempts to invoke the system `uvx` / `python` / `pip`.
        *   **Smart Fallback**: If the above commands are not found on the system, it checks whether the built-in `uv` is installed. If installed, it automatically uses the built-in `uv` to take over execution.
    *   **Internal Mode**: Forces use of the built-in `uv` to execute commands.

### 2.3 Version Management
*   **Tool Versions**: Allows users to view and install/update Bun and uv from the settings interface.
*   **Python Versions**: Supports managing Python interpreter versions via `uv` (`uv python install/list`) to meet the specific Python version requirements of different MCP Servers or scripts.
*   Built-in environment configurations are stored in the user data directory.

## 3. Technical Architecture

### 3.1 Directory Structure
Built-in binaries are stored in a `bin` subdirectory under the application's user data directory (`userData`).
This path automatically adapts based on the packaged application name (`AppName`) and is **not hardcoded**.

*   **Path Rule**: `path.join(app.getPath('userData'), 'bin')`
*   **Windows**: `%AppData%\{AppName}\bin\` (e.g., `%AppData%\Kosmos\bin`)
*   **macOS**: `~/Library/Application Support/{AppName}/bin/`
*   **Linux**: `~/.config/{AppName}/bin/`

Directory structure example (using Kosmos as an example):
```
%AppData%\Kosmos\
  bin\
    bun         # Bun runtime
    node        # Node.js compatible
    npm         # npm compatible
    npx         # npx compatible
    pip         # pip compatible
    python      # Python compatible
    python3     # Python3 compatible
    uv          # uv tool
    uvx         # uvx tool
```

### 3.2 Module Design

#### Main Process

1.  **`src/main/lib/runtime/RuntimeManager.ts`**
    *   **Responsibility**: Singleton management class responsible for configuration management, path resolution, installation workflows, and IPC communication.
    *   **Core API**:
        *   `getInstance()`: Gets the singleton instance.
        *   `getRunTimeConfig()`: Gets the current mode and version configuration.
        *   `getBinaryPath(tool)`: Gets the absolute path of `bun` or `uv`.
        *   `isInstalled(tool)`: Checks whether the specified tool exists.
        *   `getEnvWithInternalPath(baseEnv)`: Gets the environment variable object with the built-in `bin` path injected (including the PYTHONUTF8 fix).
        *   `installRuntime(tool, version)`: Invokes external scripts to perform download and installation.
        *   **`listPythonVersions()`**: Calls `uv python list` to retrieve installed and available Python versions.
        *   **`installPythonVersion(version)`**: Calls `uv python install <version>` to install the specified Python version.
    *   **IPC Handlers**:
        *   `runtime:get-config`
        *   `runtime:set-mode`
        *   `runtime:install-component`
        *   `runtime:check-status`
        *   `runtime:list-python-versions`: Returns the Python version list.
        *   `runtime:install-python-version`: Triggers Python installation.

2.  **`src/main/lib/terminalManager/TerminalInstance.ts` (Environment Variable Management)**
    *   **Responsibility**: Centrally manages environment variables for all command executions.
    *   **Core Logic**:
        *   Determines whether to prepend `{userData}/bin` to PATH based on the runtime mode (internal/system).
        *   **Internal Mode**: Adds the bin directory to the front of PATH; commands directly use executables from the bin directory (bun, node, npm, npx, pip, python, python3, uv, uvx).
        *   **System Mode**: Does not add the bin directory; uses the system PATH.
        *   Re-prioritizes the bin directory in the shell wrapper after loading user configuration (overriding modifications from pyenv/nvm, etc.).

3.  **`src/main/lib/mcpRuntime/vscMcpClient.ts`**
    *   **Responsibility**: MCP client adapter that directly passes the original configuration to TerminalInstance.
    *   **Design Principle**: Does not perform command conversion or environment variable injection; all environment management is handled centrally by TerminalInstance.

4.  **Installation Scripts (`resources/scripts/`)**
    *   `install-bun.js`: Downloads and extracts Bun (using `node-stream-zip`).
    *   `install-uv.js`: Downloads and extracts uv.
    *   `download.js`: General-purpose download utility with redirect support.
    *   **Execution Mechanism**: Independently executed by `RuntimeManager` via `child_process.spawn` to avoid blocking the main process.

#### Renderer Process

1.  **`src/renderer/components/settings/RuntimeSettings.tsx`**
    *   **UI**: Embedded in the settings interface, providing Mode switching (System/Internal) and tool installation/status checking.
    *   **New Features**:
        *   **Python Management**: Displays a list of installed Python versions.
        *   Provides an input field or selector for installing new Python versions (e.g., `3.10`, `3.11`, `3.12`).
    *   **Interaction**: Communicates with the main process via `window.electronAPI.runtime`.

### 3.3 Data Storage
*   **Configuration File**: `runtimeConfig.json` is stored in the `userData` directory.
*   **Contents**: Includes `mode` (system/internal), `bunVersion`, `uvVersion`.

## 4. Implementation Details Summary

### 4.1 Environment Variable Fixes
In `RuntimeManager.getEnvWithInternalPath`, in addition to adding the `bin` directory to `PATH`, the following environment variables are injected by default to resolve Python encoding issues on Windows:
*   `PYTHONUTF8=1`
*   `PYTHONIOENCODING=utf-8`

### 4.2 Built-in Executables
The `{userData}/bin/` directory contains the complete set of executables, requiring no command conversion:

*   **Executable List**: `bun`, `node`, `npm`, `npx`, `pip`, `python`, `python3`, `uv`, `uvx`
*   **How It Works**:
    *   TerminalInstance prepends the bin directory to PATH
    *   Commands directly execute the binaries in the bin directory
    *   No command conversion or interception required

### 4.3 TerminalInstance Environment Management
`TerminalInstance` is the sole entry point for environment variable management:

*   **Internal Mode**: 
    *   Calls `PlatformConfigManager.getEnhancedEnvironment(true)` to add the bin directory to PATH
    *   Re-prioritizes the bin directory in the shell wrapper after loading the user profile
*   **System Mode**:
    *   Calls `PlatformConfigManager.getEnhancedEnvironment(false)` without adding the bin directory
    *   Uses the system default PATH

*   **Design Principle**: `vscMcpClient` and `executeCommandTool` do not manage environment variables; they pass configurations directly to TerminalInstance.

### 4.4 Separate Process Installation
The installation process runs entirely in standalone Node.js scripts located in `resources/scripts`. The main process is only responsible for `spawn` and listening to `stdout/stderr` logs. This ensures that CPU usage during the download and extraction process does not cause Electron UI freezes.

### 4.5 Python Version Management Implementation
Beyond basic tool installation, `RuntimeManager` leverages the installed `uv` to manage Python versions.
*   **Command Invocation**: Uses `bin/uv python list` and `bin/uv python install <version>`.
*   **Environment Variables**: When executing these commands, `UV_PYTHON_INSTALL_DIR` must be injected, or the default `uv` behavior (AppData/Roaming/uv/python) must be relied upon, to ensure Python is installed in the user's expected location or in an isolated environment.
    *   *Recommended Strategy*: Use the default path for now, so that users can reuse these Python versions when using `uv` in the terminal.
*   **UI Experience**: The frontend provides a list that parses the output of `uv python list` (typically containing Version, Path, Status), displaying it to the user and allowing one-click installation of common versions (3.10, 3.11, 3.12).
