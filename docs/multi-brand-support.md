# OpenKosmos Multi-Brand Architecture

## 1. Overview

Kosmos supports a **multi-brand architecture** that allows generating application versions with different names, icons, and identifiers from a single codebase through configuration. This enables community contributors and organizations to create customized builds while sharing the same core codebase.

**Current Brand:**
- **OpenKosmos** (Default, folder: `brands/openkosmos`)

> **Adding Your Own Brand:** See [Section 6](#6-adding-a-new-brand) for instructions on creating a custom brand.

## 2. Core Strategy: Build-time Injection

The build system uses **Build-time Injection** alongside **Environment Variables**.
Brand configurations reside in the `brands/` directory. During the build process (Webpack & Electron Builder), the specific brand's assets and constants are injected based on the `BRAND` environment variable.

### How It Works

1. `scripts/brand-config.js` reads `BRAND` env var (default: `'openkosmos'`)
2. Loads `brands/{brand}/config.json` for the selected brand
3. Webpack injects brand constants (`APP_NAME`, `APP_ID`, etc.) into the bundle
4. Electron Builder uses brand-specific icons, names, and identifiers for packaging

## 3. Directory Structure

Each brand has its own directory under `brands/` containing a configuration file and assets:

```text
brands/
├── openkosmos/                  # Default brand
│   ├── config.json          # Brand configuration (name, IDs, etc.)
│   ├── assets/
│   │   ├── mac/
│   │   │   └── app.icns     # macOS app icon
│   │   ├── win/
│   │   │   ├── app.ico      # Windows app icon
│   │   │   └── icon_round_*.png
│   │   └── dmg-background.png
├── your-brand/              # Custom brand (you create this)
│   ├── config.json
│   └── assets/ ...          # Same structure as above
```

## 4. Brand Configuration

### `config.json` Structure

Each brand's `config.json` defines the following properties:

| Property | Description | Example |
|----------|-------------|---------|
| `appId` | Unique application identifier | `com.openkosmos.app` |
| `productName` | Display name of the application | `OpenKosmos` |
| `userDataName` | User data folder name (no spaces) | `openkosmos-app` |
| `filenamePrefix` | Executable file prefix (no spaces) | `OpenKosmos` |
| `shortcutName` | Start menu / dock shortcut name | `OpenKosmos` |
| `brandName` | Brand identifier (matches folder name) | `openkosmos` |

### Build-time Injection

These values are injected into the app via:
- **Webpack `DefinePlugin`**: Injects `process.env.APP_NAME`, `process.env.BRAND_NAME`, etc. into the source code
- **Electron Builder**: Uses values for packaging (icons, installer names, code signing)
- **HTML Template**: Sets the window `<title>` dynamically

## 5. Building with a Brand

### Using Environment Variable

```bash
# Build with default brand (openkosmos)
npm run build

# Build with a specific brand
BRAND=your-brand npm run build

# Package with a specific brand
npm run dist --brandname=your-brand
```

### Using npm config

```bash
npm run dist --brandname=openkosmos
npm run build --brandname=openkosmos
```

The `scripts/brand-config.js` checks `process.env.npm_config_brandname` first, then falls back to `process.env.BRAND`, defaulting to `'openkosmos'`.

## 6. Adding a New Brand

To create a custom brand:

1. **Create brand directory:**
   ```bash
   mkdir -p brands/your-brand/assets/{mac,win}
   ```

2. **Create `config.json`:**
   ```json
   {
     "appId": "com.your-brand.app",
     "productName": "YourBrand",
     "userDataName": "your-brand-app",
     "filenamePrefix": "YourBrand",
     "shortcutName": "YourBrand",
     "brandName": "your-brand"
   }
   ```

3. **Add icon assets:**
   - `assets/mac/app.icns` — macOS app icon
   - `assets/win/app.ico` — Windows app icon
   - `assets/dmg-background.png` — macOS DMG installer background (optional)

4. **Build:**
   ```bash
   BRAND=your-brand npm run build
   BRAND=your-brand npm run dist
   ```

### Important Notes

- **User Data Isolation**: Each brand gets its own user data directory (`%APPDATA%\<userDataName>` on Windows, `~/Library/Application Support/<userDataName>` on macOS), so different brands never share data.
- **Windows Executable**: The `filenamePrefix` must **not** contain spaces — spaces in `.exe` filenames cause CMD parsing errors and update failures.
- **Auto-Update**: Different brands require separate update channels/repositories. Ensure the `publish` field in `electron-builder.config.js` is configured appropriately for your brand.
- **Code Signing**: If your brand requires different signing certificates, update the signing configuration in `electron-builder.config.js`.

## 7. Key Files

| File | Purpose |
|------|---------|
| `scripts/brand-config.js` | Brand configuration loader — reads `BRAND` env var, loads `config.json` |
| `electron-builder.config.js` | Electron Builder config — uses brand config for packaging |
| `webpack.main.config.js` | Webpack main process — injects brand env vars via `DefinePlugin` |
| `webpack.renderer.config.js` | Webpack renderer — sets HTML `<title>` dynamically |
| `src/main/bootstrap.ts` | App entry point — sets `userData` path based on brand |
| `brands/openkosmos/config.json` | OpenKosmos brand configuration (reference example) |
