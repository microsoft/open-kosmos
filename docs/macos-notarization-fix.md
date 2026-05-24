# macOS Notarization Fix Notes

## Problem Diagnosis

The previous CI builds had serious issues:

1. ✅ **Codesign succeeded** — Code signing was completely normal
2. ❌ **Notarization was only submitted, not waited for** — `APPLE_NOTARIZE_WAIT=false`
3. ❌ **No stapled notarization ticket** — App was missing the notarization ticket
4. ❌ **Gatekeeper warning on user download** — "Apple could not verify OpenKosmos is free of malware"

### Key Log Evidence

```text
⏭️ Skipping wait for notarization completion (APPLE_NOTARIZE_WAIT=false)
Status: undefined
ℹ️ Notarization will continue in the background
```

This means:
- Only the notarization request was submitted; Apple's review was never waited for
- Status shows `undefined` — it is unknown whether Apple passed the check
- The packaged `.app`/`.dmg` was not truly notarized
- Gatekeeper warns users on download

---

## Fix

### 1️⃣ CI Pipeline Change

**File**: [.github/workflows/release.yml](.github/workflows/release.yml)

**Change locations**: 
- Line 403: `build-macos-kosmos` job

**Change**:
```diff
- # 🔑 Disable notarization wait to avoid GitHub Actions timeout
- # electron-builder will submit the notarization request but not wait for completion
- APPLE_NOTARIZE_WAIT: false
+ # ✅ Enable notarization wait to ensure the App is properly notarized and stapled
+ # Full flow: codesign → notarize (wait) → staple → package DMG/ZIP
+ APPLE_NOTARIZE_WAIT: true
```

### 2️⃣ Complete Notarization Flow

**File**: [scripts/notarize.js](../scripts/notarize.js)

The script already has full support (no changes needed):

1. **Codesign verification** (`verifyCodesign`)
   ```bash
   codesign --verify --deep --strict --verbose=2 "OpenKosmos.app"
   ```

2. **Compress App to ZIP**
   ```bash
   ditto -c -k --keepParent "OpenKosmos.app" "OpenKosmos.app.zip"
   ```

3. **Submit to Apple Notarization Service**
   ```bash
   xcrun notarytool submit "OpenKosmos.app.zip" \
     --apple-id "$APPLE_ID" \
     --team-id "$TEAM_ID" \
     --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --output-format json
   ```

4. **Poll status until complete** (30-second interval, up to 30 minutes)
   ```bash
   xcrun notarytool info "$SUBMISSION_ID" \
     --apple-id "$APPLE_ID" \
     --team-id "$TEAM_ID" \
     --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --output-format json
   ```

5. **Staple ticket to App**
   ```bash
   xcrun stapler staple "OpenKosmos.app"
   xcrun stapler validate "OpenKosmos.app"
   ```

6. **Package DMG/ZIP**
   - electron-builder will automatically package using the already-stapled App

---

## Verification

### Locally Verify a Signed and Notarized App

```bash
# 1. Verify code signing
codesign --verify --deep --strict --verbose=2 "OpenKosmos.app"

# 2. Verify Hardened Runtime
codesign -dv --verbose=4 "OpenKosmos.app" 2>&1 | grep -i runtime

# 3. Verify Staple ticket
xcrun stapler validate "OpenKosmos.app"

# 4. Verify Gatekeeper assessment
spctl -a -vvv -t execute "OpenKosmos.app"
```

### CI Build Log Checkpoints

Expect to see the following logs:

```text
🍎 Starting macOS notarization (using notarytool with polling)...
   App: /path/to/OpenKosmos.app
   Team ID: XXXXXXXXXX
   Apple ID: your-apple-id@example.com
   Wait for completion: YES (max 30 minutes)

🔏 Verifying codesign...
✓ Codesign verification passed

📦 Creating zip archive: /path/to/OpenKosmos.app.zip
✓ Zip archive created

📤 Submitting to Apple notarization service...
✓ Submission successful
   Submission ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   Status: In Progress

⏳ Polling notarization status...
   Interval: 30s
   Max wait time: 30 minutes

   [Poll 1] Checking status... (0s elapsed)
   Status: In Progress
   Waiting 30s before next poll...

   [Poll 2] Checking status... (30s elapsed)
   Status: Accepted

✅ Notarization accepted! (after 45s)

📎 Stapling notarization ticket...
✓ Stapling complete

✅ Notarization complete!

🧹 Cleaning up temporary zip file...
```

---

## FAQ

### Q1: Will CI time out?

**A**: Usually not. Apple notarization typically takes 1–5 minutes, up to 15 minutes. The script has a 30-minute timeout, which is more than sufficient. The GitHub Actions macOS runner default timeout is 60 minutes.

### Q2: What if Notarization fails?

**A**: The script will automatically retrieve and print detailed logs:

```bash
xcrun notarytool log "$SUBMISSION_ID" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

Common failure causes:
- Hardened Runtime not enabled
- Missing or incorrect Entitlements
- Dependent libraries not properly signed
- Use of disallowed APIs

### Q3: How do I manually check Notarization status?

**A**: Use the Submission ID from the CI logs:

```bash
xcrun notarytool info "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

### Q4: Users are still seeing warnings. What should I do?

**A**: Check the following:
1. Does the DMG/ZIP contain the already-stapled App?
2. Is the user downloading from the correct release channel?
3. Verify the released files:
   ```bash
   # Extract DMG/ZIP, then verify the App
   xcrun stapler validate "OpenKosmos.app"
   spctl -a -vvv -t execute "OpenKosmos.app"
   ```

---

## Pre-Release Checklist

- [ ] CI environment variables configured correctly:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
  - `APPLE_NOTARIZE_WAIT=true` ✅

- [ ] Build log shows the complete flow:
  - ✅ Codesign verification passed
  - ✅ Notarization accepted
  - ✅ Stapling complete
  - ✅ Notarization complete

- [ ] Pre-release local verification:
  ```bash
  xcrun stapler validate "OpenKosmos.app"
  spctl -a -vvv -t execute "OpenKosmos.app"
  ```

- [ ] Post-release user verification:
  - Download DMG/ZIP
  - Double-click to open; no Gatekeeper warning
  - Runs normally

---

## References

- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [notarytool Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow)
- [electron-builder Notarization](https://www.electron.build/configuration/mac.html#notarization)
- [Kosmos Project Instructions](../.github/copilot-instructions.md)

---

**Fix Date**: 2026-01-14  
**Fix Version**: Next release (v1.13.19+)  
**Scope**: macOS OpenKosmos builds
