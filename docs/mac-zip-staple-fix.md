# macOS ZIP Auto-Update "App Damaged" Issue Fix

## Problem Description

Multiple Mac users reported that after auto-updating, the application failed to launch with an "app damaged" error. This is because the app does not have a stapled notarization ticket and is blocked by macOS Gatekeeper.

### Symptoms

- DMG installation works normally with no warnings
- After auto-update, launch shows "app damaged" or "Apple could not verify..."
- Issue only affects users who updated via ZIP

## Root Cause Analysis

### Root Cause

**The ZIP file was generated before stapling, so the .app inside the ZIP does not have a notarization ticket!**

### CI Pipeline Timing Issue

| Stage | Job | Operation | Issue |
|-------|-----|-----------|-------|
| Stage 1 | `build-macos-*` | Build + Codesign + **Generate ZIP** + Submit notarization | ZIP has no staple at this point |
| Stage 2 | `notarize-macos-*` | Wait for notarization to complete | - |
| Stage 3 | `package-macos-*` | **Staple app** + Generate DMG + **Upload old ZIP** | ❌ Directly uploads the ZIP from Stage 1 |

### Code Flow

1. [electron-builder.config.js](../electron-builder.config.js#L187) configures `target: ['dmg', 'zip']`
2. Stage 1's `npm run dist:mac:arm64` generates both DMG and **ZIP file**
3. At this point, the .app inside the ZIP **only has codesign, no staple**
4. Stage 3 only staples the .app, then re-creates the DMG
5. **But the ZIP file comes directly from Stage 1's artifact and is not repackaged!**

```yaml
# Problematic code - directly uploads the old ZIP
ZIP_FILE=$(find release/mac-arm64 -name "*-arm64.zip" | head -n 1)
gh release upload "$TAG" "$ZIP_FILE" --clobber
```

### Why Does DMG Work Fine?

The DMG is **re-created** in Stage 3 using the already stapled .app:

```yaml
npx electron-builder --mac dmg --arm64 --prepackaged "$APP_PATH" ...
```

## Fix

### New `scripts/repack-zip.js`

After stapling, repackage the ZIP file:

```javascript
// 1. Verify the app has been stapled
execSync(`xcrun stapler validate "${appPath}"`);

// 2. Delete the old ZIP
fs.unlinkSync(oldZipPath);

// 3. Create a new ZIP using ditto (preserves macOS extended attributes and symlinks)
execSync(`ditto -c -k --keepParent "${appName}" "${zipFilename}"`);

// 4. Generate blockmap to support differential updates
execSync(`npx electron-builder blockmap --input="${zipPath}"`);
```

### CI Pipeline Modifications

Add a "Repack ZIP with stapled app" step to the 4 package jobs:

```yaml
- name: Repack ZIP with stapled app
  env:
    BRAND: openkosmos
  run: |
    APP_PATH=$(find release/mac-arm64 -name "*.app" -maxdepth 1 | head -n 1)
    node scripts/repack-zip.js "$APP_PATH" "release/mac-arm64" "arm64"
```

### Modified Jobs

- `package-macos-openkosmos` (arm64)
- `package-macos-openkosmos-x64`

## Post-Fix Pipeline

| Stage | Job | Operation | Status |
|-------|-----|-----------|--------|
| Stage 1 | `build-macos-*` | Build + Codesign + Generate ZIP + Submit notarization | ZIP has no staple yet |
| Stage 2 | `notarize-macos-*` | Wait for notarization to complete | ✅ |
| Stage 3 | `package-macos-*` | Staple app + **Repackage ZIP** + Generate DMG + Upload | ✅ ZIP includes staple |

## Verification

### CI Build Verification

Build logs should show:

```text
📦 Repacking ZIP with stapled app...
   App: release/mac-arm64/OpenKosmos.app
   This ensures the ZIP contains the stapled notarization ticket
   Without this, auto-update would show 'App Damaged' error
🔍 Verifying staple before repacking...
✅ Staple verification passed
📦 Creating new ZIP: release/mac-arm64/OpenKosmos-1.x.x-mac-arm64.zip
✅ ZIP created successfully
   Path: release/mac-arm64/OpenKosmos-1.x.x-mac-arm64.zip
   Size: xxx.xx MB
📊 Generating blockmap for differential updates...
✅ Blockmap generated
✅ ZIP repacked with stapled app
```

### Local Verification of Downloaded ZIP

```bash
# 1. Download and extract the ZIP
unzip OpenKosmos-xxx-mac-arm64.zip

# 2. Verify staple
xcrun stapler validate "OpenKosmos.app"
# Expected: The validate action worked!

# 3. Verify Gatekeeper
spctl -a -vvv -t execute "OpenKosmos.app"
# Expected: OpenKosmos.app: accepted / source=Notarized Developer ID
```

## Related Files

- [scripts/repack-zip.js](../scripts/repack-zip.js) - ZIP repackaging script
- [scripts/staple-app.js](../scripts/staple-app.js) - Staple script
- [.github/workflows/release.yml](../.github/workflows/release.yml) - CI pipeline

## References

- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [macOS Gatekeeper](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
- [electron-builder Mac Notarization](https://www.electron.build/configuration/mac.html#notarization)

---

**Fix Date**: 2026-02-05  
**Fix Branch**: `user/yanhu/fix-mac-zip-codesign`  
**Affected Versions**: Next release  
**Affected Products**: OpenKosmos macOS edition

