# CDN Updaters Configuration

This document describes the structure of `updaters.json` for the CDN update system.

## File Location

The `updaters.json` file should be placed at:
```
<CDN_BASE_URL>/updaters/updaters.json
```

## JSON Structure

```json
{
  "latest": "1.2.0",
  "downloadUrls": {
    "win32-x64": "updater-win-x64.exe",
    "win32-arm64": "updater-win-arm64.exe",
    "darwin-x64": "updater-mac-x64",
    "darwin-arm64": "updater-mac-arm64",
    "visual-win32-x64": "openkosmos-updater-x64.exe",
    "visual-win32-arm64": "openkosmos-updater-arm64.exe"
  }
}
```

## Field Descriptions

### `latest`
The latest version number of the updater programs (semantic versioning format: `X.Y.Z`).

### `downloadUrls`
An object mapping platform keys to updater file names.

#### Platform Keys

| Key | Description |
|-----|-------------|
| `win32-x64` | Windows x64 command-line updater |
| `win32-arm64` | Windows ARM64 command-line updater |
| `darwin-x64` | macOS Intel command-line updater |
| `darwin-arm64` | macOS Apple Silicon command-line updater |
| `visual-win32-x64` | Windows x64 visual updater (GUI) |
| `visual-win32-arm64` | Windows ARM64 visual updater (GUI) |

## Updater Files

All updater files should be placed at:
```
<CDN_BASE_URL>/updaters/<filename>
```

### Required Files

| File | Description |
|------|-------------|
| `updater-win-x64.exe` | Windows x64 command-line updater |
| `updater-win-arm64.exe` | Windows ARM64 command-line updater |
| `updater-mac-x64` | macOS Intel command-line updater |
| `updater-mac-arm64` | macOS Apple Silicon command-line updater |

### Optional Files (Visual Updater)

| File | Description |
|------|-------------|
| `openkosmos-updater-x64.exe` | Windows x64 visual updater with GUI |
| `openkosmos-updater-arm64.exe` | Windows ARM64 visual updater with GUI |

## Update Flow

### Command-Line Updater
1. App downloads `updaters.json`
2. App checks if local updater version < `latest`
3. If update needed, downloads corresponding updater file
4. On ZIP update, app launches updater: `updater <zip_path> <install_path>`
5. Updater extracts ZIP and replaces app files silently

### Visual Updater (Windows Only)
1. App downloads `updaters.json`
2. App checks if visual updater exists (key: `visual-win32-<arch>`)
3. If available, downloads `openkosmos-updater-<arch>.exe`
4. On ZIP update, app prefers visual updater over command-line
5. Visual updater shows progress window with:
   - Progress bar
   - Status messages
   - Animated spinner
   - Error handling with retry option

## Local Storage

Updaters are stored locally at:
```
<userData>/assets/updater/
```

Version information is stored in:
```
<userData>/app.json
```

Example `app.json`:
```json
{
  "updaterVersion": "1.2.0",
  "visualUpdaterVersion": "1.2.0"
}
```
