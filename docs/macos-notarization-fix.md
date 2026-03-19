# macOS Notarization Fix Notes

## Problem Diagnosis

The previous CI builds had critical issues:

1. ✅ **Codesign Succeeded** - Code signing worked correctly
2. ❌ **Notarization was only submitted, not awaited** - `APPLE_NOTARIZE_WAIT=false`
3. ❌ **No Stapled Notarization Ticket** - App was missing the notarization ticket
4. ❌ **Gatekeeper Warning After User Download** - "Apple could not verify KOSMOS is free of malware"

### Key Log Evidence

```text
⏭️ Skipping wait for notarization completion (APPLE_NOTARIZE_WAIT=false)
Status: undefined
ℹ️ Notarization will continue in the background
```

This means:
- Only the notarization request was submitted; the process did not wait for Apple to complete the review
- Status shows `undefined` - it is unknown whether Apple passed the check
- The packaged `.app`/`.dmg` was not truly notarized
- Users will see a Gatekeeper warning upon download

---

## Fix

### 1️⃣ CI Pipeline Changes

**File**: [.github/workflows/release.yml](.github/workflows/release.yml)

**Modified Location**: 
- Line 403: `build-macos-kosmos` job

**Changes**:
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

The script already has full support (no modifications needed):

1. **Codesign Verification** (`verifyCodesign`)
   ```bash
   codesign --verify --deep --strict --verbose=2 "KOSMOS.app"
   ```

2. **Compress App to ZIP**
   ```bash
   ditto -c -k --keepParent "KOSMOS.app" "KOSMOS.app.zip"
   ```

3. **Submit to Apple Notarization Service**
   ```bash
   xcrun notarytool submit "KOSMOS.app.zip" \
     --apple-id "$APPLE_ID" \
     --team-id "$TEAM_ID" \
     --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --output-format json
   ```

4. **Poll Status Until Completion** (30-second intervals, up to 30 minutes)
   ```bash
   xcrun notarytool info "$SUBMISSION_ID" \
     --apple-id "$APPLE_ID" \
     --team-id "$TEAM_ID" \
     --password "$APPLE_APP_SPECIFIC_PASSWORD" \
     --output-format json
   ```

5. **Staple Ticket to App**
   ```bash
   xcrun stapler staple "KOSMOS.app"
   xcrun stapler validate "KOSMOS.app"
   ```

6. **Package DMG/ZIP**
   - electron-builder will automatically use the stapled App for packaging

---

## Verification Methods

### Locally Verify Signed and Notarized App

```bash
# 1. Verify code signature
codesign --verify --deep --strict --verbose=2 "KOSMOS.app"

# 2. Verify Hardened Runtime
codesign -dv --verbose=4 "KOSMOS.app" 2>&1 | grep -i runtime

# 3. Verify stapled ticket
xcrun stapler validate "KOSMOS.app"

# 4. Verify Gatekeeper assessment
spctl -a -vvv -t execute "KOSMOS.app"
```

### CI Build Log Checkpoints

Expected log output:

```text
🍎 Starting macOS notarization (using notarytool with polling)...
   App: /path/to/KOSMOS.app
   Team ID: XXXXXXXXXX
   Apple ID: your-apple-id@example.com
   Wait for completion: YES (max 30 minutes)

🔏 Verifying codesign...
✓ Codesign verification passed

📦 Creating zip archive: /path/to/KOSMOS.app.zip
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

## Frequently Asked Questions

### Q1: Will the CI time out?

**A**: Usually not. Apple notarization typically takes 1-5 minutes, 15 minutes at most. The script has a 30-minute timeout, which is more than sufficient. The GitHub Actions macOS runner has a default timeout of 60 minutes.

### Q2: What if notarization fails?

**A**: The script will automatically retrieve and print detailed logs:

```bash
xcrun notarytool log "$SUBMISSION_ID" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

Common failure reasons:
- Hardened Runtime not enabled
- Entitlements missing or incorrect
- Dependent libraries not properly signed
- Use of disallowed APIs

### Q3: How to manually check notarization status?

**A**: Use the Submission ID from the CI logs:

```bash
xcrun notarytool info "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

### Q4: What if users still report warnings?

**A**: Check the following:
1. Whether the DMG/ZIP contains the stapled App
2. Whether the user downloaded from the correct Release channel
3. Verify the released files:
   ```bash
   # Extract the DMG/ZIP and verify the App
   xcrun stapler validate "KOSMOS.app"
   spctl -a -vvv -t execute "KOSMOS.app"
   ```

---

## Next Release Checklist

- [ ] CI environment variables are correctly configured:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
  - `APPLE_NOTARIZE_WAIT=true` ✅

- [ ] Build logs show the complete flow:
  - ✅ Codesign verification passed
  - ✅ Notarization accepted
  - ✅ Stapling complete
  - ✅ Notarization complete

- [ ] Pre-release local verification:
  ```bash
  xcrun stapler validate "KOSMOS.app"
  spctl -a -vvv -t execute "KOSMOS.app"
  ```

- [ ] Post-release user verification:
  - Download the DMG/ZIP
  - Double-click to open, no Gatekeeper warning
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
**Scope of Impact**: macOS KOSMOS builds

