#!/bin/bash
set -e

APP_PATH="./release/mac/OpenKosmos.app"

echo "🔍 Verifying build..."
echo ""

# 1. Check if the app exists
if [ ! -d "$APP_PATH" ]; then
  echo "❌ App not found: $APP_PATH"
  echo "   Please run first: npm run dist:mac"
  exit 1
fi
echo "✅ App exists"

# 2. Check code signature
echo ""
echo "📝 Checking code signature..."
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
  echo "✅ Code signature verification passed"
else
  echo "❌ Code signature verification failed"
  echo ""
  echo "Details:"
  codesign -dvvv "$APP_PATH" 2>&1
  exit 1
fi

# 3. Check signature type
echo ""
echo "📝 Checking signature type..."
SIGNATURE=$(codesign -dv "$APP_PATH" 2>&1)
if echo "$SIGNATURE" | grep -q "Signature=adhoc"; then
  echo "⚠️  Warning: app uses adhoc signature (not signed with Developer ID)"
  echo "   This signature will cause notarization to fail in CI/CD"
  echo ""
  echo "Signature details:"
  echo "$SIGNATURE"
  exit 1
elif echo "$SIGNATURE" | grep -q "Developer ID Application"; then
  IDENTITY=$(echo "$SIGNATURE" | grep "Authority=Developer ID Application" | head -1)
  echo "✅ App is signed with Developer ID"
  echo "   $IDENTITY"
else
  echo "⚠️  Unknown signature type"
  echo ""
  echo "Signature details:"
  echo "$SIGNATURE"
fi

# 4. Check Hardened Runtime
echo ""
echo "📝 Checking Hardened Runtime..."
if echo "$SIGNATURE" | grep -q "flags=0x10000(runtime)"; then
  echo "✅ Hardened Runtime is enabled"
else
  echo "⚠️  Warning: Hardened Runtime may not be enabled"
  echo "   This may cause notarization to fail"
fi

# 5. Check entitlements
echo ""
echo "📝 Checking entitlements..."
ENTITLEMENTS=$(codesign -d --entitlements :- "$APP_PATH" 2>/dev/null)
if [ -n "$ENTITLEMENTS" ]; then
  echo "✅ Entitlements are set"
  echo ""
  echo "First 20 lines of entitlements:"
  echo "$ENTITLEMENTS" | head -20
  
  # Check for problematic entitlements
  if echo "$ENTITLEMENTS" | grep -q "com.apple.security.app-sandbox.*false"; then
    echo ""
    echo "⚠️  Warning: app-sandbox=false detected, this will cause notarization to fail"
  fi
  
  if echo "$ENTITLEMENTS" | grep -q "com.apple.security.get-task-allow"; then
    echo ""
    echo "⚠️  Warning: get-task-allow detected, this will cause notarization to fail"
  fi
else
  echo "⚠️  Warning: no entitlements found"
fi

# 6. Check Gatekeeper
echo ""
echo "📝 Checking Gatekeeper compatibility..."
if spctl -a -vvv -t install "$APP_PATH" 2>&1 | grep -q "accepted"; then
  echo "✅ Gatekeeper verification passed"
else
  echo "⚠️  Gatekeeper verification not passed (normal before notarization)"
fi

# 7. Check DMG files
echo ""
echo "📝 Checking DMG files..."
DMG_FILES=$(find ./release -name "OpenKosmos-*.dmg" -type f 2>/dev/null)
if [ -n "$DMG_FILES" ]; then
  echo "✅ DMG file(s) found:"
  echo "$DMG_FILES" | while read dmg; do
    SIZE=$(ls -lh "$dmg" | awk '{print $5}')
    echo "   $(basename "$dmg") ($SIZE)"
  done
else
  echo "⚠️  No DMG files found"
fi

echo ""
echo "================================"
echo "✅ Build verification complete!"
echo ""
echo "Next steps:"
echo "  1. If all checks passed, you can submit the code"
echo "  2. If there are warnings, fix the relevant issues first"
echo "  3. To test notarization manually, run:"
echo "     xcrun notarytool submit ./release/OpenKosmos-*.dmg \\"
echo "       --apple-id \"\$APPLE_ID\" \\"
echo "       --password \"\$APPLE_APP_SPECIFIC_PASSWORD\" \\"
echo "       --team-id \"\$APPLE_TEAM_ID\" \\"
echo "       --wait"
echo "================================"