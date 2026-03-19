# Playwright Local Environment Setup Guide

> This document is for configuring the local Playwright global environment. Please follow the steps below in order.
> Playwright is a browser automation library that supports Chromium, Firefox, and WebKit.

---

## Objective

> ⚠️ **IMPORTANT**: You **MUST** install Playwright version **1.57.0** exactly. If a different version is already installed, you **MUST** either upgrade or uninstall and reinstall to match version 1.57.0. This is mandatory to ensure compatibility with the project.

Ensure Playwright version 1.57.0 and its browsers are installed and available on the local system.

---

## Prerequisites

Playwright requires a Node.js environment. Please ensure Node.js is installed first:

```bash
node --version
npm --version
```

If Node.js is not installed, please refer to [npm-setup.prompt.md](https://cdn.kosmos-ai.com/setup/npm-setup.prompt.md) to complete the Node.js environment setup.

---

## Step 1: Check if Playwright is already installed and available

### 1.1 Check global Playwright version

```bash
# If globally installed
playwright --version

# Or using npx
npx playwright --version
```

### 1.2 Check if Playwright browsers are installed

```bash
# If globally installed
playwright install --dry-run

# Or using npx
npx playwright install --dry-run
```

### 1.3 Check if Playwright works correctly

```bash
# If globally installed
playwright --help

# Or using npx
npx playwright --help
```

### Decision Logic

- **If all commands above successfully return version numbers or help information**: Playwright is installed and available, skip to Step 4 to check if an upgrade is needed.
- **If commands return "command not found" or similar errors**: Playwright is not installed, continue to Step 2.
- **If commands produce errors (not version number output)**: Playwright is installed but not working, continue to Step 3.

---

## Step 2: Install Playwright (if not installed)

### Global Installation of Playwright CLI

Use npm/pnpm/yarn to globally install the Playwright CLI:

```bash
# Global installation using npm
npm install -g playwright@1.57.0

# Or using pnpm
pnpm add -g playwright@1.57.0

# Or using yarn
yarn global add playwright@1.57.0

# Verify installation
playwright --version
```

### Install Browsers (Required)

> ⚠️ **Important**: After globally installing Playwright, you **must** run the browser installation command, otherwise you will get errors at runtime!

```bash
# Install all supported browsers (Chromium, Firefox, WebKit)
playwright install

# Or install specific browsers only
playwright install chromium
playwright install firefox
playwright install webkit
```

### Install System Dependencies (Linux)

On Linux systems, you may need to install additional system dependencies:

```bash
# Ubuntu/Debian - Install all browser dependencies
playwright install-deps

# Install dependencies for specific browsers only
playwright install-deps chromium
playwright install-deps firefox
playwright install-deps webkit
```

### Post-Installation Verification

After installation, verify that Playwright works correctly:

```bash
# Check version
playwright --version

# View help
playwright --help

# List installed browsers
playwright install --dry-run
```

---

## Step 3: Repair or Reinstall Playwright (if installed but not working)

### 3.1 Clean and Reinstall Browsers

```bash
# Delete installed browsers
# Windows
rd /s /q "%USERPROFILE%\AppData\Local\ms-playwright"

# macOS
rm -rf ~/Library/Caches/ms-playwright

# Linux
rm -rf ~/.cache/ms-playwright

# Reinstall browsers
playwright install
```

### 3.2 Windows

#### Complete Uninstall of Global Installation

```bash
# Uninstall global Playwright
npm uninstall -g playwright

# Clean up cache
rd /s /q "%USERPROFILE%\AppData\Local\ms-playwright"
rd /s /q "%LOCALAPPDATA%\npm-cache\_npx"
```

#### Reinstall

```bash
# Reinstall globally
npm install -g playwright@1.57.0

# Reinstall browsers (required)
playwright install
```

### 3.3 macOS

#### Complete Uninstall

```bash
# Uninstall global Playwright
npm uninstall -g playwright

# Clean up browser cache
rm -rf ~/Library/Caches/ms-playwright

# Clean up npm cache
npm cache clean --force
```

#### Reinstall

```bash
# Reinstall globally
npm install -g playwright@1.57.0

# Reinstall browsers (required)
playwright install
```

### 3.4 Linux

#### Complete Uninstall

```bash
# Uninstall global Playwright
npm uninstall -g playwright

# Clean up browser cache
rm -rf ~/.cache/ms-playwright

# Clean up npm cache
npm cache clean --force
```

#### Reinstall

```bash
# Reinstall globally
npm install -g playwright@1.57.0

# Install system dependencies
playwright install-deps

# Reinstall browsers (required)
playwright install
```

### 3.5 Fix Permission Issues

If you encounter permission errors:

```bash
# macOS/Linux - Fix browser cache directory permissions
chmod -R 755 ~/.cache/ms-playwright

# Or use sudo to install system dependencies (Linux)
sudo playwright install-deps
```

---

## Step 4: Upgrade Playwright to the Latest Version

### Upgrade Globally Installed Playwright

```bash
# Upgrade global Playwright to version 1.57.0
npm install -g playwright@1.57.0

# After upgrade, you must reinstall browsers
playwright install
```

### Verify Upgrade Result

```bash
playwright --version
```

---

## Step 5: Confirm Successful Installation

Run the following commands to confirm Playwright is correctly installed and available:

```bash
# Check Playwright version
playwright --version

# Check Playwright help information
playwright --help

# Check installed browsers
playwright install --dry-run

# Run a simple test to verify browsers work correctly
playwright open https://example.com
```

### Expected Output Example

```
$ playwright --version
Version 1.57.0 (or higher)

$ playwright --help
Usage: playwright [options] [command]

Options:
  -V, --version                          output the version number
  -h, --help                             display help for command

Commands:
  open [options] [url]                   open page in browser specified via -b, --browser
  codegen [options] [url]                open page and generate code for user actions
  install [options] [browser...]         ensure browsers necessary for this version of Playwright are installed
  install-deps [options] [browser...]    install dependencies necessary to run browsers
  ...

$ playwright install --dry-run
browser: chromium 120.0.6099.28, installed
browser: firefox 119.0, installed
browser: webkit 17.4, installed
```

---

## Troubleshooting Common Issues

### Q1: Command shows "command not found"

**Cause**: Node.js/npm is not installed or Playwright is not correctly installed.

**Solution**:
1. Ensure Node.js and npm are installed (refer to [npm-setup.prompt.md](https://cdn.kosmos-ai.com/setup/npm-setup.prompt.md))
2. Run `npm install -g playwright@1.57.0` for global installation
3. After installation, you must run `playwright install` to install browsers
4. Or use `npx playwright` to run (no global installation required)

### Q2: Browser download failed

**Cause**: Network issues or proxy settings.

**Solution**:

```bash
# Set proxy
# Windows
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
npx playwright install

# macOS/Linux
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
npx playwright install

# Or use a Chinese mirror
# Windows
set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
npx playwright install

# macOS/Linux
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
npx playwright install
```

### Q3: Browser fails to start on Linux

**Cause**: Missing system dependencies.

**Solution**:

```bash
# Install all dependencies
sudo npx playwright install-deps

# Or manually install common dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2
```

### Q4: Browser version mismatch

**Cause**: Browsers were not reinstalled after Playwright upgrade.

**Solution**:

```bash
# Reinstall browsers
npx playwright install

# Or clean up and reinstall
rm -rf ~/.cache/ms-playwright  # Linux/macOS
rd /s /q "%USERPROFILE%\AppData\Local\ms-playwright"  # Windows
npx playwright install
```

### Q5: Permission denied error

**Cause**: Insufficient permissions for browser cache directory.

**Solution**:

```bash
# macOS/Linux
chmod -R 755 ~/.cache/ms-playwright

# Or delete and re-download
rm -rf ~/.cache/ms-playwright
npx playwright install
```

### Q6: Playwright version is too old

**Solution**:

```bash
# Upgrade to version 1.57.0
npm install -g playwright@1.57.0

# Reinstall browsers
playwright install
```

---

## Playwright Common Commands Quick Reference

| Command | Description |
|---------|-------------|
| `playwright --version` | View version |
| `playwright --help` | View help |
| `playwright install` | Install all browsers |
| `playwright install chromium` | Install Chromium only |
| `playwright install-deps` | Install system dependencies (Linux) |
| `playwright open <url>` | Open URL in browser |
| `playwright codegen <url>` | Record actions and generate code |
| `playwright screenshot <url>` | Take a page screenshot |
| `playwright pdf <url>` | Save page as PDF |

---

## Environment Variables Configuration

| Environment Variable | Description | Example |
|---------------------|-------------|---------|
| `PLAYWRIGHT_BROWSERS_PATH` | Custom browser installation path | `~/.playwright-browsers` |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Custom download mirror | `https://npmmirror.com/mirrors/playwright` |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | Skip browser download | `1` |
| `HTTPS_PROXY` | HTTPS proxy | `http://127.0.0.1:7890` |
| `HTTP_PROXY` | HTTP proxy | `http://127.0.0.1:7890` |

---

## Summary

| Step | Action | Key Command |
|------|--------|-------------|
| 0 | Prerequisites check | `node --version && npm --version` |
| 1 | Check existing installation | `playwright --version` |
| 2 | New installation (if not installed) | `npm install -g playwright@1.57.0 && playwright install` |
| 3 | Repair/reinstall (if not working) | Clean up cache then reinstall |
| 4 | Upgrade to version 1.57.0 | `npm install -g playwright@1.57.0 && playwright install` |
| 5 | Confirm successful installation | `playwright --version && playwright open https://example.com` |