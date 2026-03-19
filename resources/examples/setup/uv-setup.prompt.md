# UV/UVX Global Installation Guide

> This document provides comprehensive instructions for installing, verifying, updating, uninstalling, cache management, and PATH configuration for uv/uvx on Windows and macOS.

## 📌 Version Requirement

**Install uv 0.6.17 (LTS / CLI-stable)** - This is the official Long-Term Support version with stable command-line interface.

---

# 🚀 Windows (PowerShell)

## ✅ 1. Verify uv/uvx Installation and Version

```powershell
uv --version
uvx --version
```

> 📌 **Version Check**: The output should show version `0.6.17`. For example: `uv 0.6.17`
>
> If the version is **not 0.6.17** (e.g., 0.5.x or 0.7.x), you need to update to the required version. See **Step 2.2** below.

---

## ✅ 2. Install uv (includes uvx)

### 2.1 Fresh Installation (if uv is not installed)

### Install Latest LTS Version (0.6.17)

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/astral-sh/uv/releases/download/0.6.17/uv-installer.ps1 | iex"
```

> Default installation path: `%USERPROFILE%\.local\bin` (e.g., `C:\Users\YourName\.local\bin`)
> 
> Installs: `uv.exe`, `uvx.exe`, `uvw.exe`
>
> 📌 The installer will automatically install the 0.6.17 LTS version

### 2.2 Update to Required Version (if version is not 0.6.17)

If you already have uv installed but the version is not 0.6.17, update it:

```powershell
uv self update
```

> ⚠️ **Note**: `uv self update` will update to the latest stable version. If this doesn't give you 0.6.17, you can reinstall using the installation command above, which will overwrite the existing installation.

After updating, verify the version again:

```powershell
uv --version
```

---

## 🔧 3. PATH Configuration

> ⚠️ **Important**: After installation, **restart the Kosmos app** for the PATH changes to take effect globally. Session-level PATH updates do not apply to the running app.

The installer automatically adds `%USERPROFILE%\.local\bin` to your system PATH.

If `uv` command is still not found after restarting, manually verify PATH:

```powershell
$env:Path -split ';' | Select-String '\.local\\bin'
```

---

# 🍎 macOS (zsh/bash)

## ✅ 1. Verify uv/uvx Installation and Version

```bash
uv --version
uvx --version
```

> 📌 **Version Check**: The output should show version `0.6.17`. For example: `uv 0.6.17`
>
> If the version is **not 0.6.17** (e.g., 0.5.x or 0.7.x), you need to update to the required version. See **Step 2.2** below.

---

## ✅ 2. Install uv (includes uvx)

### 2.1 Fresh Installation (if uv is not installed)

### Install Latest LTS Version (0.6.17)

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/astral-sh/uv/releases/download/0.6.17/uv-installer.sh | sh
```

> Default installation path: `~/.local/bin` (e.g., `/Users/YourName/.local/bin`)
> 
> Installs: `uv`, `uvx`, `uvw`
>
> 📌 The installer will automatically install the 0.6.17 LTS version

### 2.2 Update to Required Version (if version is not 0.6.17)

If you already have uv installed but the version is not 0.6.17, update it:

```bash
uv self update
```

> ⚠️ **Note**: `uv self update` will update to the latest stable version. If this doesn't give you 0.6.17, you can reinstall using the installation command above, which will overwrite the existing installation.

After updating, verify the version again:

```bash
uv --version
```

---

## 🔧 3. PATH Configuration

> ⚠️ **Important**: After installation, **restart the Kosmos app** for the PATH changes to take effect globally. Session-level PATH updates do not apply to the running app.

The installer automatically adds `~/.local/bin` to your PATH.

If `uv` command is still not found after restarting, manually verify PATH:

```bash
echo $PATH | tr ':' '\n' | grep '.local/bin'
```

If not present, manually add it to your shell profile:

### For zsh users (macOS default)

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

### For bash users

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

Then restart the Kosmos app.

---

# 🧭 Common Diagnostic Commands

## Check uv Installation Location

macOS:

```bash
which uv
```

Windows (PowerShell):

```powershell
Get-Command uv
```

---

## Verify PATH Contains .local/bin

macOS:

```bash
echo $PATH | tr ':' '\n' | grep '.local/bin'
```

Windows (PowerShell):

```powershell
$Env:PATH.Split(';') | Select-String "\.local\\bin"
```

---

## Common uv Commands

| Command | Description |
|---------|-------------|
| `uv --version` | View version |
| `uv self update` | Update uv to latest version |
| `uv self uninstall` | Uninstall uv |
| `uv cache clean --all` | Clean all cache |
| `uv venv` | Create virtual environment |
| `uv pip install <pkg>` | Install package |
| `uv pip list` | List installed packages |
| `uv run <script>` | Run script |
| `uvx <tool>` | Run one-off tool globally |
| `uv init` | Initialize new project |
| `uv add <pkg>` | Add project dependency |
| `uv sync` | Sync project environment |
