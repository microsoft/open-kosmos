# KOSMOS Visual Updater

A visual update program for the Windows platform, providing a user-friendly installation experience.

## Features

### User Interface
- 🎨 **Modern UI**: Dark theme with frosted glass effect
- 📊 **Real-Time Progress**: Precise progress bar and percentage display
- 🔄 **Status Animations**: Loading animations, success/failure icon animations
- 🖱️ **Frameless Window**: Draggable custom title bar
- 🌈 **Gradient Effects**: Gradient colors for progress bar and buttons

### Update Process
1. **Waiting for Application to Close** (0% - 10%)
   - Detects the main application process
   - Waits for the process to fully exit
   - Waits for file handles to be released

2. **Extracting Update Package** (10% - 30%)
   - Cleans up old temporary directories
   - Extracts ZIP file to a temporary directory

3. **Installing Update** (30% - 90%)
   - Counts the number of files
   - Copies files one by one with real-time progress display
   - Intelligently handles locked files

4. **Cleaning Up Temporary Files** (90% - 95%)
   - Deletes the temporary extraction directory

5. **Completion and Launch** (95% - 100%)
   - Displays completion status
   - Automatically launches the updated application

### Error Handling
- ❌ **Error Recovery**: Displays error messages and provides a retry button
- 🔄 **File Lock Handling**: Automatically skips locked files
- 📝 **Detailed Logging**: Records the complete update process

## Project Structure

```
updater-electron/
├── src/
│   └── main.ts           # Electron main process
├── index.html            # UI interface
├── styles.css            # Stylesheet
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
└── README.md             # Documentation
```

## Build

### Standalone Build
```bash
cd updater-electron
npm install
npm run dist:win
```

### Build via Main Project
```bash
# In the main project root directory
npm run build:visual-updater
```

Build artifacts:
- `kosmos-updater-x64.exe` - Windows x64
- `kosmos-updater-arm64.exe` - Windows ARM64

## CDN Deployment

Upload build artifacts to CDN:
```
<CDN_BASE_URL>/updaters/kosmos-updater-x64.exe
<CDN_BASE_URL>/updaters/kosmos-updater-arm64.exe
```

Update `updaters.json`:
```json
{
  "latest": "1.0.0",
  "downloadUrls": {
    "visual-win32-x64": "kosmos-updater-x64.exe",
    "visual-win32-arm64": "kosmos-updater-arm64.exe"
  }
}
```

## Integration Guide

### Main Application Integration
The visual updater is integrated into the main application's update workflow:

1. **Download Phase**
   - The main application automatically downloads the visual updater when checking for updates
   - Saved to `<userData>/assets/updater/kosmos-updater-<arch>.exe`

2. **Installation Phase**
   - ZIP updates preferentially use the visual updater
   - Falls back to the command-line updater if the visual updater is unavailable

### Code Locations
- **Download Logic**: `src/main/lib/autoUpdate/updaterFetcher.ts`
- **Launch Logic**: `src/main/lib/autoUpdate/updateManager.ts`

## Logs

Log files are saved at:
```
%TEMP%\kosmos-updater-visual.log
```

## Tech Stack

- **Framework**: Electron 28
- **Language**: TypeScript
- **UI**: Native HTML/CSS
- **Extraction**: extract-zip

## Comparison with Command-Line Updater

| Feature | Visual Updater | Command-Line Updater |
|---------|---------------|---------------------|
| User Interface | ✅ Yes | ❌ No |
| Progress Display | ✅ Real-time | ❌ Log only |
| Error Prompts | ✅ Graphical | ❌ Log only |
| File Size | ~70MB | ~10MB |
| Startup Speed | Slower | Faster |
| Use Case | User experience priority | Silent updates |

## Configuration Options

### electron-builder Configuration
```json
{
  "build": {
    "win": {
      "target": [
        {
          "target": "portable",
          "arch": ["x64", "arm64"]
        }
      ]
    }
  }
}
```

### Window Configuration
```typescript
mainWindow = new BrowserWindow({
  width: 500,
  height: 350,
  frame: false,        // Frameless
  transparent: true,   // Transparent background
  resizable: false,    // Not resizable
  center: true,        // Centered display
  alwaysOnTop: true,   // Always on top
});
```
