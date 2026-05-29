# OpenKosmos Windows Updater

🪟 **Lightweight Windows Native Updater** - Single File, Zero Console Flash

## Overview


- ⚡ **Instant Startup** - No Electron, millisecond-level startup
- 🪟 **Native Windows UI** - Windows Forms progress bar, standard Windows style
- 📦 **Single File** - One exe, no external dependencies (~26-36MB)
- 🔇 **No Console Flash** - VBScript launcher ensures completely hidden console
- 🔄 **Backward Compatible** - Same calling convention as Go-based updater

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Update Flow (No Console Window)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Main App (Electron)                                                │
│        │                                                             │
│        │ spawn(updaterPath, [zipPath, installPath])                  │
│        ▼                                                             │
│   ┌─────────────────────┐                                           │
│   │  updater-win-*.exe  │  ◄── stub.exe (Node.js, exits immediately)│
│   │                     │                                            │
│   │  1. Write PS1 script to %TEMP%                                  │
│   │  2. Create VBS launcher                                          │
│   │  3. spawn('wscript.exe', [vbs])                                 │
│   │  4. process.exit(0) ◄── Exits immediately to minimize flash     │
│   └──────────┬──────────┘                                           │
│              │                                                       │
│              ▼                                                       │
│   ┌─────────────────────┐                                           │
│   │   wscript.exe       │  ◄── No console window                    │
│   │   (VBS Launcher)    │                                            │
│   │                     │                                            │
│   │   WshShell.Run      │                                            │
│   │   "powershell...",  │                                            │
│   │   0,  ◄── 0 = Hidden window                                     │
│   │   True              │                                            │
│   └──────────┬──────────┘                                           │
│              │                                                       │
│              ▼                                                       │
│   ┌─────────────────────┐                                           │
│   │   PowerShell        │  ◄── Hidden console (-WindowStyle Hidden) │
│   │   (Update Logic)    │                                            │
│   │                     │                                            │
│   │  ┌───────────────┐  │                                            │
│   │  │ Windows Forms │  │  ◄── Native Progress Bar UI (VISIBLE)     │
│   │  │     UI        │  │                                            │
│   │  └───────────────┘  │                                            │
│   └─────────────────────┘                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why VBScript Launcher?

The `pkg`-packaged Node.js exe creates a brief console flash even with GUI subsystem. To achieve **zero console flash**, we use a VBScript launcher:

1. **stub.exe** writes embedded PowerShell script to temp file
2. **stub.exe** creates VBScript launcher with `WshShell.Run(..., 0, True)`
3. **stub.exe** spawns `wscript.exe` and **exits immediately**
4. **wscript.exe** runs VBS which launches PowerShell with hidden window
5. **PowerShell** shows native Windows Forms progress UI

## UI Preview

```
┌─────────────────────────────────────────────┐
├─────────────────────────────────────────────┤
│                                             │
│  Extracting: app.asar                       │
│                                             │
│  ████████████████████░░░░░░░░░░  65%       │
│                                             │
│       Please do not close this window       │
│                                             │
└─────────────────────────────────────────────┘
```

- Standard Windows style progress bar
- DPI aware, crisp on high-resolution displays
- Real-time status updates
- Error/Success dialogs

## Update Flow

| Phase | Progress | Description |
|-------|----------|-------------|
| Validate | 5% | Check update package integrity |
| Extract | 10-50% | Unzip to temporary directory |
| Wait | 50% | Wait for main app to exit |
| Copy | 50-90% | Replace installation files |
| Cleanup | 95% | Delete temporary files |
| Launch | 100% | Start the updated application |

## Installation

```bash
cd updater/win
npm install
```

## Build

```powershell
npm run build:all
```

**Build outputs:**

| File | Platform | Size |
|------|----------|------|
| `updater-win-x64.exe` | Windows x64 | ~36MB |
| `updater-win-arm64.exe` | Windows ARM64 | ~26MB |

**Output locations:**
- `release/` - Build output
- `resources/updater/` - Copied for distribution

**Build process:**
1. Compile TypeScript → JavaScript
2. Package with `pkg` → exe
3. Patch PE header: Subsystem Console → GUI
4. Copy to resources directory

## Usage

### Command Line

```
updater <zip_path> <install_path>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `zip_path` | Path to the update ZIP file |
| `install_path` | Path to the installation directory |

### Examples

```powershell

# Update OpenKosmos
.\updater-win-x64.exe "C:\updates\app-1.2.0.zip" "C:\Program Files\OpenKosmos"
```

## Integration with Main App

### Calling Convention (Backward Compatible)

```typescript
import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';

function runUpdater(zipPath: string, installPath: string) {
  const updaterPath = path.join(
    app.getPath('userData'),
    'assets/updater/updater-win-x64.exe'
  );
  
  // Standard spawn - updater handles console hiding internally
  const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
    detached: true,
    stdio: 'ignore',
  });
  
  updaterProcess.unref();
  app.quit();
}
```

> **Note:** No special handling needed in main app. The updater internally uses VBScript to hide console windows. This maintains backward compatibility with older app versions.

### UpdateManager Integration

The updater is designed to work with `UpdateManager.silentUpdate()`:

```typescript
// In updateManager.ts - simple call, no VBS wrapper needed
const updaterProcess = spawn(updaterPath, [zipPath, installPath], {
  detached: true,
  stdio: 'ignore',
});
updaterProcess.unref();
```

## Deployment

Only one file needed per platform:

```
assets/updater/
├── updater-win-x64.exe
└── updater-win-arm64.exe
```

No external scripts or dependencies required.

## Testing

```powershell
# Test full update flow
$updaterPath = ".\release\updater-win-arm64.exe"

# This simulates how main app calls updater
Start-Process -FilePath $updaterPath -ArgumentList "`"$zipPath`"", "`"$installPath`""
```

## Logs

Log file location: `%TEMP%\openkosmos-updater.log`

View logs:
```powershell
Get-Content $env:TEMP\openkosmos-updater.log
```

## Temporary Files

During update, the following temp files are created and auto-cleaned:

| File | Purpose |
|------|---------|
| `%TEMP%\openkosmos-updater-ui.ps1` | PowerShell UI script |
| `%TEMP%\openkosmos-updater-*.vbs` | VBScript launcher |
| `%TEMP%\openkosmos-update-*\` | Extracted update files |

## Project Structure

```
updater/win/
├── src/
│   └── stub.ts          # TypeScript source (with embedded PS script)
├── scripts/
│   └── build-exe.js     # Build script (includes PE header patching)
├── dist/                # Compiled JS output
├── release/             # Packaged exe output
├── package.json
├── tsconfig.json
└── README.md
```

## Comparison

| Feature | Node.js Stub (Current) | Go Version |
|---------|------------------------|------------|
| Size | ~26-36MB | ~8MB |
| Startup | Fast | Very Fast |
| Native UI | ✅ Windows Forms | ❌ None |
| Console Flash | ✅ None (VBS launcher) | ✅ None |
| Single File | ✅ Yes | ✅ Yes |
| Backward Compatible | ✅ Yes | ✅ Yes |

## Troubleshooting

### Console window briefly appears

If you see a brief console flash:
1. Ensure you're using the latest built exe
2. Check that PE header was patched to GUI subsystem during build
3. Verify the build log shows "✅ converted to GUI subsystem"

### Update UI doesn't appear

1. Check `%TEMP%\openkosmos-updater.log` for errors
2. Verify PowerShell execution policy allows script execution
3. Ensure ZIP file path is valid and file exists

### App doesn't restart after update

1. Check if `installPath` is correct
2. Verify the exe name detection in logs
3. Check Windows event viewer for any crash reports

### Files extracted to wrong directory (e.g., random "9" folder appears)

**Root Cause:** Windows 8.3 short path format vs long path mismatch.

`$env:TEMP` may return short path like `C:\Users\V-FUCH~1\AppData\Local\Temp` but `Get-ChildItem` returns files with long paths like `C:\Users\v-fuchenyu\AppData\Local\Temp\...`. 

When calculating relative paths with `Substring()`, the length mismatch causes incorrect path extraction:
- Short path `V-FUCH~1` = 8 characters
- Long path `v-fuchenyu` = 10 characters
- **Difference of 2 characters** causes wrong relative path calculation

**Fix (v1.20.9+):** All path operations now use `Get-LongPath` helper function to normalize paths to long format before any string manipulation.

```powershell
# Helper function to convert 8.3 short paths to long paths
function Get-LongPath {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return $Path }
    try {
        if (Test-Path $Path) {
            return (Get-Item -LiteralPath $Path).FullName
        }
        # For paths that don't exist yet, resolve parent and append leaf
        $parent = Split-Path $Path -Parent
        $leaf = Split-Path $Path -Leaf
        if ($parent -and (Test-Path $parent)) {
            return Join-Path (Get-Item -LiteralPath $parent).FullName $leaf
        }
    } catch { }
    return $Path
}
```
