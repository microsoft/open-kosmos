# KOSMOS Multi-Platform Installer Build Guide

This document provides a complete solution for building Windows ARM64, x64 and Mac ARM, x64 installers for the KOSMOS application.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Build Configuration](#build-configuration)
- [Build Scripts](#build-scripts)
- [Platform-Specific Configuration](#platform-specific-configuration)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Overview

The KOSMOS application is built on the Electron framework and uses electron-builder for packaging. The following target platforms are currently supported:
- Windows x64 & ARM64
- macOS Intel (x64) & Apple Silicon (ARM64)

## Prerequisites

### Development Environment Requirements
- Node.js >= 18.0.0
- npm or yarn
- Sufficient disk space (approximately 300-500MB per platform)

### Platform-Specific Requirements

#### Windows Build
- Windows 10/11 or macOS/Linux (via cross-compilation)
- For code signing: Windows code signing certificate

#### macOS Build
- macOS system (required, Apple restriction)
- Xcode Command Line Tools
- For code signing and notarization:
  - Apple Developer account
  - Code signing certificate
  - App Store Connect API key

## Build Configuration

### 1. Update package.json

First, update the electron-builder configuration in [`package.json`](package.json:98) to support all target architectures:

```json
{
  "build": {
    "appId": "com.kosmos.app",
    "productName": "KOSMOS",
    "directories": {
      "output": "release",
      "buildResources": "build"
    },
    "files": [
      "dist/**/*",
      "resources/**/*",
      "package.json"
    ],
    "mac": {
      "icon": "resources/icons/kosmos_icon_1024x1024.png",
      "category": "public.app-category.productivity",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        },
        {
          "target": "zip",
          "arch": ["x64", "arm64"]
        }
      ]
    },
    "win": {
      "icon": "resources/icons/kosmos_icon.ico",
      "target": [
        {
          "target": "nsis",
          "arch": ["x64", "arm64"]
        },
        {
          "target": "portable",
          "arch": ["x64", "arm64"]
        }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "KOSMOS",
      "displayLanguageSelector": true,
      "multiLanguageInstaller": true,
      "allowElevation": true,
      "perMachine": false,
      "artifactName": "${productName}-Setup-${version}-${arch}.${ext}"
    },
    "portable": {
      "artifactName": "${productName}-Portable-${version}-${arch}.${ext}"
    },
    "dmg": {
      "artifactName": "${productName}-${version}-${arch}.${ext}",
      "background": "resources/icons/dmg_background.png",
      "iconSize": 100,
      "contents": [
        {
          "x": 380,
          "y": 280,
          "type": "link",
          "path": "/Applications"
        },
        {
          "x": 110,
          "y": 280,
          "type": "file"
        }
      ],
      "window": {
        "width": 540,
        "height": 380
      }
    }
  }
}
```

### 2. Update Build Scripts

Add new build commands in the scripts section of [`package.json`](package.json:9):

```json
{
  "scripts": {
    "build": "npm run build:main && npm run build:renderer",
    "build:main": "webpack --config webpack.main.config.js --mode production",
    "build:renderer": "webpack --config webpack.renderer.config.js --mode production",
    
    "dist": "npm run build && electron-builder",
    "dist:all": "npm run build && electron-builder --mac --win",
    
    "dist:win": "npm run build && electron-builder --win",
    "dist:win:x64": "npm run build && electron-builder --win --x64",
    "dist:win:arm64": "npm run build && electron-builder --win --arm64",
    
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:mac:x64": "npm run build && electron-builder --mac --x64",
    "dist:mac:arm64": "npm run build && electron-builder --mac --arm64",
    "dist:mac:universal": "npm run build && electron-builder --mac --universal",
    
    "pack": "electron-builder --dir",
    "pack:all": "npm run build && electron-builder --dir --mac --win"
  }
}
```

## Build Scripts

### Automated Build Script

Create the `scripts/build-all.js` automated build script:

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Build configuration
const platforms = [
  { name: 'win-x64', command: 'npm run dist:win:x64' },
  { name: 'win-arm64', command: 'npm run dist:win:arm64' },
  { name: 'mac-x64', command: 'npm run dist:mac:x64' },
  { name: 'mac-arm64', command: 'npm run dist:mac:arm64' }
];

// Clean output directory
console.log('🧹 Cleaning output directory...');
if (fs.existsSync('release')) {
  fs.rmSync('release', { recursive: true });
}

// Build application
console.log('🔨 Building application...');
execSync('npm run build', { stdio: 'inherit' });

// Build installer for each platform
for (const platform of platforms) {
  console.log(`📦 Building ${platform.name} installer...`);
  try {
    execSync(platform.command, { stdio: 'inherit' });
    console.log(`✅ ${platform.name} build succeeded`);
  } catch (error) {
    console.error(`❌ ${platform.name} build failed:`, error.message);
  }
}

console.log('🎉 All platform builds completed!');
console.log('📁 Output directory: release/');
```

### Batch Script (Windows)

Create `scripts/build-all.bat`:

```batch
@echo off
echo 🧹 Cleaning output directory...
if exist release rmdir /s /q release

echo 🔨 Building application...
call npm run build
if %errorlevel% neq 0 exit /b %errorlevel%

echo 📦 Building Windows x64 installer...
call npm run dist:win:x64
if %errorlevel% neq 0 echo ❌ Windows x64 build failed

echo 📦 Building Windows ARM64 installer...
call npm run dist:win:arm64
if %errorlevel% neq 0 echo ❌ Windows ARM64 build failed

echo 🎉 Windows platform builds completed!
echo 📁 Output directory: release\
pause
```

### Shell Script (macOS/Linux)

Create `scripts/build-all.sh`:

```bash
#!/bin/bash

set -e

echo "🧹 Cleaning output directory..."
rm -rf release

echo "🔨 Building application..."
npm run build

echo "📦 Building macOS x64 installer..."
npm run dist:mac:x64

echo "📦 Building macOS ARM64 installer..."
npm run dist:mac:arm64

echo "🎉 macOS platform builds completed!"
echo "📁 Output directory: release/"
```

## Platform-Specific Configuration

### macOS Configuration

#### 1. Create Entitlements File

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.debugger</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
  </dict>
</plist>
```

#### 2. Code Signing Configuration

For code signing, add the following to [`package.json`](package.json:98):

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "notarize": {
        "teamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

### Windows Configuration

#### Code Signing Configuration

For code signing, add the following to [`package.json`](package.json:98):

```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/certificate.p12",
      "certificatePassword": "certificate_password",
      "signAndEditExecutable": true,
      "verifyUpdateCodeSignature": true
    }
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/build.yml`:

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build Windows x64
        run: npm run dist:win:x64
      
      - name: Build Windows ARM64
        run: npm run dist:win:arm64
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-builds
          path: release/

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build macOS x64
        run: npm run dist:mac:x64
      
      - name: Build macOS ARM64
        run: npm run dist:mac:arm64
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-builds
          path: release/

  release:
    needs: [build-windows, build-macos]
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/')
    steps:
      - name: Download Windows builds
        uses: actions/download-artifact@v4
        with:
          name: windows-builds
          path: release/
      
      - name: Download macOS builds
        uses: actions/download-artifact@v4
        with:
          name: macos-builds
          path: release/
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: release/*
          draft: false
          prerelease: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Common Build Commands

### Local Development Build
```bash
# Build for all platforms (requires corresponding platform environment)
npm run dist:all

# Build for a specific platform
npm run dist:win:x64      # Windows x64
npm run dist:win:arm64    # Windows ARM64
npm run dist:mac:x64      # macOS Intel
npm run dist:mac:arm64    # macOS Apple Silicon

# Package only without distribution (for testing)
npm run pack
```

### Batch Build
```bash
# Using the automated script
node scripts/build-all.js

# Windows batch
scripts\build-all.bat

# macOS/Linux Shell
chmod +x scripts/build-all.sh
./scripts/build-all.sh
```

## Output Files

After the build completes, installers will be generated in the `release/` directory:

```
release/
├── KOSMOS-Setup-1.0.0-x64.exe           # Windows x64 installer
├── KOSMOS-Setup-1.0.0-arm64.exe         # Windows ARM64 installer
├── KOSMOS-Portable-1.0.0-x64.exe        # Windows x64 portable version
├── KOSMOS-Portable-1.0.0-arm64.exe      # Windows ARM64 portable version
├── KOSMOS-1.0.0-x64.dmg                 # macOS Intel installer
├── KOSMOS-1.0.0-arm64.dmg               # macOS Apple Silicon installer
└── latest.yml                           # Auto-update configuration file
```

## Troubleshooting

### Common Issues

1. **Node.js Version Incompatibility**
   ```bash
   # Check version
   node --version
   # Should be >= 18.0.0
   ```

2. **Build Failure: Permission Issues**
   ```bash
   # Windows
   npm cache clean --force
   
   # macOS/Linux
   sudo npm cache clean --force
   ```

3. **macOS Signing Failure**
   ```bash
   # Check certificates
   security find-identity -v -p codesigning
   
   # Clean Keychain
   security delete-certificate -c "certificate_name"
   ```

4. **Out of Memory**
   ```bash
   # Increase Node.js memory limit
   export NODE_OPTIONS="--max-old-space-size=4096"
   npm run dist
   ```

### Build Optimization

1. **Reduce Package Size**
   - Exclude unnecessary files in the files configuration of [`package.json`](package.json:105)
   - Use `.gitignore` and `.npmignore` to exclude development files

2. **Speed Up Builds**
   ```bash
   # Use parallel builds
   npm install --save-dev electron-builder-parallel
   
   # Enable caching
   export ELECTRON_BUILDER_CACHE=/path/to/cache
   ```

3. **Debug Builds**
   ```bash
   # Enable verbose logging
   DEBUG=electron-builder npm run dist
   
   # Keep build directory for debugging
   npm run pack
   ```

## References

- [electron-builder Official Documentation](https://www.electron.build/)
- [Electron Application Distribution](https://www.electronjs.org/docs/tutorial/distribution-overview)
- [Apple Code Signing Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Windows Code Signing](https://docs.microsoft.com/en-us/windows/win32/seccrypto/signtool)