# OpenKosmos macOS Updater

🍎 **Lightweight macOS Native Updater** - Single Binary, No Dependencies

## Overview


- ⚡ **Instant Startup** - No Electron, pure Node.js binary
- 📦 **Single File** - One executable, no external dependencies
- 🔄 **Auto Recovery** - Automatic rollback on failure
- 🚀 **Auto Launch** - Restarts app after successful update

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         macOS Update Flow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Main App (Electron)                                                │
│        │                                                             │
│        │ spawn(updaterPath, [zipPath, installPath])                  │
│        │ app.quit()                                                  │
│        ▼                                                             │
│   ┌─────────────────────┐                                           │
│   │  updater-mac-*      │  ◄── Node.js binary (pkg)                 │
│   │                     │                                            │
│   │  1. Wait for app exit (3s)                                      │
│   │  2. Extract ZIP to temp                                          │
│   │  3. Backup current .app                                          │
│   │  4. Copy new files                                               │
│   │  5. Cleanup temp & backup                                        │
│   │  6. Launch updated app                                           │
│   └─────────────────────┘                                           │
│                                                                      │
│   On Error:                                                          │
│   ┌─────────────────────┐                                           │
│   │  Auto Rollback      │  ◄── Restore from .backup                 │
│   └─────────────────────┘                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Update Flow

| Phase | Description |
|-------|-------------|
| Wait | Wait for main app to fully exit (3 seconds) |
| Extract | Unzip update package to temp directory |
| Backup | Rename current .app to .app.backup |
| Copy | Copy extracted files to install path |
| Cleanup | Remove temp directory and backup |
| Launch | Start the updated application |

### Error Recovery

If any step fails, the updater automatically:
1. Restores from `.backup` if available
2. Logs detailed error information
3. Exits with error code (app remains usable)

## Supported Platforms

| Platform | Binary | Architecture |
|----------|--------|--------------|
| macOS Intel | `updater-mac-x64` | x64 |
| macOS Apple Silicon | `updater-mac-arm64` | arm64 |

## Installation

```bash
cd updater/mac
npm install
```

## Build

### Build All Platforms

```bash
npm run build:all
```

### Build Specific Platform

```bash
npm run build:mac-x64      # macOS Intel
npm run build:mac-arm64    # macOS Apple Silicon
```

### Output Location

```
resources/updater/
├── updater-mac-x64       # Intel Mac
└── updater-mac-arm64     # Apple Silicon
```

## Usage

### Command Line

```
updater <zip_path> <install_path>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `zip_path` | Path to the update ZIP file |
| `install_path` | Path to the .app bundle (e.g., `/Applications/OpenKosmos.app`) |

### Examples

```bash
# Update OpenKosmos
./updater-mac-arm64 "/tmp/OpenKosmos-1.2.0.zip" "/Applications/OpenKosmos.app"

```

## Integration with Main App

### Calling Convention

```typescript
import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

function runUpdater(zipPath: string, installPath: string) {
  // Determine updater binary based on architecture
  const arch = process.arch; // 'x64' or 'arm64'
  const updaterName = `updater-mac-${arch}`;
  
  const updaterPath = path.join(
    app.getPath('userData'),
    'assets/updater',
    updaterName
  );
  
  // Launch updater and quit main app
  const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
    detached: true,
    stdio: 'ignore',
  });
  
  updaterProcess.unref();
  app.quit();
}
```

### UpdateManager Integration

```typescript
// In updateManager.ts
const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
  detached: true,
  stdio: 'ignore',
});
updaterProcess.unref();
```

> **Note:** The calling convention is identical to Windows updater for consistency.

## Deployment

### In Electron App Resources

```
YourApp.app/
└── Contents/
    └── Resources/
        └── updater/
            └── updater-mac-arm64  (or updater-mac-x64)
```

### In User Data Directory

```
~/Library/Application Support/your-app/
└── assets/
    └── updater/
        └── updater-mac-arm64
```

### electron-builder Configuration

```json
{
  "build": {
    "files": [
      "resources/**/*"
    ],
    "extraResources": [
      {
        "from": "resources/updater",
        "to": "updater"
      }
    ]
  }
}
```

## Logs

Log file location: `/tmp/kosmos-updater.log`

View logs:
```bash
cat /tmp/kosmos-updater.log
# or
tail -f /tmp/kosmos-updater.log  # Watch in real-time
```

## Testing

### Manual Test

```bash
# Prepare test environment
ZIP_PATH="/tmp/test-update.zip"
INSTALL_PATH="/Applications/OpenKosmos.app"
UPDATER="./resources/updater/updater-mac-arm64"

# Make updater executable
chmod +x $UPDATER

# Run updater
$UPDATER "$ZIP_PATH" "$INSTALL_PATH"
```

### Debug Mode

```bash
# Run directly with Node.js for debugging
node updater.js "/tmp/update.zip" "/Applications/OpenKosmos.app"
```

## Project Structure

```
updater/mac/
├── updater.js           # Main updater script
├── package.json         # Build configuration
├── README.md
└── resources/
    └── updater/         # Built binaries
        ├── updater-mac-x64
        └── updater-mac-arm64
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `extract-zip` | ZIP file extraction |
| `pkg` | Package into standalone binary |

## Comparison with Windows Updater

| Feature | macOS | Windows |
|---------|-------|---------|
| UI | ❌ None (silent) | ✅ Windows Forms progress bar |
| Architecture | x64, arm64 | x64, arm64 |
| Single File | ✅ Yes | ✅ Yes |
| Auto Recovery | ✅ Backup & rollback | ✅ Backup & rollback |
| Console Window | N/A (no console on macOS) | ✅ Hidden (VBS launcher) |

## Troubleshooting

### Permission Denied

```bash
# Make updater executable
chmod +x /path/to/updater-mac-arm64
```

### App Not Launching After Update

1. Check `/tmp/kosmos-updater.log` for errors
2. Verify the .app bundle is properly signed
3. Check if Gatekeeper is blocking: `xattr -d com.apple.quarantine /Applications/YourApp.app`

### Backup Not Cleaned Up

If `.app.backup` remains after update:
```bash
# Manual cleanup (only if update was successful)
rm -rf "/Applications/YourApp.app.backup"
```

### Update Fails Silently

1. Check log file for detailed error messages
2. Verify ZIP file is valid: `unzip -t /path/to/update.zip`
3. Ensure sufficient disk space
4. Check file permissions on install path
