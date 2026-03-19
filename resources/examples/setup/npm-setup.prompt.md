# NPM/NPX Local Environment Setup Guide

> This document is for configuring the local npm/npx global environment. Please follow the steps below in order.

---

## Objective

Ensure the latest version of npm and npx is installed and available on the local system.

---

## Step 1: Check if npm/npx is already installed and available

### 1.1 Check npm version

```bash
npm --version
```

### 1.2 Check npx version

```bash
npx --version
```

### 1.3 Check Node.js version (npm depends on Node.js)

```bash
node --version
```

### Decision Logic

- **If all commands above successfully return version numbers**: npm/npx is installed and available, task complete, no need to continue.
- **If commands return "command not found" or similar errors**: npm/npx is not installed, continue to Step 2.
- **If commands produce errors (not version number output)**: npm/npx is installed but not working, continue to Step 3.

---

## Step 2: Install Node.js and npm (if not installed)

npm is installed together with Node.js. It's recommended to use the official Node.js installer or a version manager.

### Windows

#### Option A: Using winget (Recommended)

```bash
winget install OpenJS.NodeJS.LTS
```

#### Option B: Using Chocolatey

```bash
choco install nodejs-lts -y
```

#### Option C: Using Scoop

```bash
scoop install nodejs-lts
```

#### Option D: Manual Download and Install

1. Visit https://nodejs.org/
2. Download the LTS version
3. Run the installer and complete with default settings

### macOS

#### Option A: Using Homebrew (Recommended)

```bash
brew install node
```

#### Option B: Using nvm (Node Version Manager)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell configuration
source ~/.bashrc  # or source ~/.zshrc

# Install latest LTS version
nvm install --lts
nvm use --lts
```

### Post-Installation Configuration

After installation, **restart the terminal** or run the following commands to refresh environment variables:

```bash
# Windows (PowerShell)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# macOS
source ~/.bashrc  # or source ~/.zshrc
```

---

## Step 3: Repair or Reinstall npm (if installed but not working)

### 3.1 Windows

#### Complete Uninstall

```bash
# Uninstall using winget
winget uninstall OpenJS.NodeJS.LTS

# Or uninstall Node.js from Control Panel

# Manually clean up residual directories
rd /s /q "%APPDATA%\npm"
rd /s /q "%APPDATA%\npm-cache"
rd /s /q "%LOCALAPPDATA%\npm-cache"
```

#### Reinstall

Refer to the Windows installation methods in Step 2.

### 3.2 macOS

#### Reinstall using Homebrew

```bash
# Uninstall
brew uninstall node

# Clean up cache
rm -rf ~/.npm
rm -rf ~/.node-gyp

# Reinstall
brew install node
```

#### Reinstall using nvm

```bash
# List installed versions
nvm ls

# Uninstall current version
nvm uninstall <version>

# Reinstall LTS version
nvm install --lts
nvm use --lts
```

### 3.3 Fix npm Permission Issues

If you encounter permission errors, try the following methods:

```bash
# Option A: Change npm default directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Option B: Fix directory permissions (not recommended, use only when necessary)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
```

---

## Step 4: Upgrade npm to the Latest Version

After installing Node.js, npm may not be the latest version. Run the following command to upgrade:

```bash
# Upgrade npm to the latest version
npm install -g npm@latest

# Verify the upgrade
npm --version
```

---

## Step 5: Confirm Successful Installation

Run the following commands to confirm npm/npx is correctly installed and available:

```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Check npx version
npx --version

# Check npm global installation path
npm config get prefix

# List globally installed packages
npm list -g --depth=0
```

### Expected Output Example

```
$ node --version
v20.10.0

$ npm --version
10.2.5

$ npx --version
10.2.5

$ npm config get prefix
/usr/local  # or C:\Users\<username>\AppData\Roaming\npm (Windows)

$ npm list -g --depth=0
/usr/local/lib
├── npm@10.2.5
└── ...
```

---

## Troubleshooting Common Issues

### Q1: Command shows "command not found"

**Cause**: Node.js/npm was not correctly added to the system PATH.

**Solution**:
1. Restart the terminal
2. Check if environment variables include the Node.js installation path
3. Manually add the path to PATH

### Q2: Permission errors when installing packages with npm

**Cause**: Insufficient permissions for the global installation directory.

**Solution**:
- Use the methods in Step 3.4 to fix permissions
- Or use nvm to manage Node.js versions (recommended)

### Q3: npm version is too old

**Solution**:

```bash
npm install -g npm@latest
```

### Q4: Proxy/network issues causing installation failures

**Solution**:

```bash
# Set npm mirror source (using Taobao mirror)
npm config set registry https://registry.npmmirror.com

# Or use a proxy
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890
```

---

## Summary

| Step | Action | Key Command |
|------|--------|-------------|
| 1 | Check existing installation | `npm --version` |
| 2 | New installation (if not installed) | `winget install OpenJS.NodeJS.LTS` / `brew install node` |
| 3 | Repair/reinstall (if not working) | Uninstall then reinstall |
| 4 | Upgrade to latest version | `npm install -g npm@latest` |
| 5 | Confirm successful installation | `npm --version && npx --version` |
