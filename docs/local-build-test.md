# macOS Local Build and Signing Test Guide

This document explains how to test macOS code signing and the build process locally, avoiding the need to push to CI/CD repeatedly to discover issues.

## Prerequisites

### 1. Developer Certificate
```bash
# Check installed certificates
security find-identity -v -p codesigning

# You should see output similar to:
# 1) F7227F21ACFEF41DA3A9995D83A4DDCEC67DF7E5 "Developer ID Application: Your Name (TEAM_ID)"
```

### 2. Environment Variable Configuration
Create a `.env.local` file (if you don't have one already):
```bash
# Apple developer account information (for notarization)
APPLE_ID=your@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID

# Code signing certificate (optional; electron-builder will auto-detect)
CSC_LINK=path/to/certificate.p12
CSC_KEY_PASSWORD=certificate_password

# Or use a base64-encoded certificate
CSC_LINK=data:application/x-pkcs12;base64,MIIKzAIBA...
```

## Local Test Procedures

### Option 1: Full Build Test (Recommended)

```bash
# 1. Clean previous build artifacts
rm -rf release/ dist/

# 2. Install dependencies
npm ci

# 3. Build the application
npm run build

# 4. Package and sign (without publishing)
npm run dist:mac

# 5. Verify signing
codesign -dv --verbose=4 ./release/mac/OpenKosmos.app

# 6. Verify entitlements
codesign -d --entitlements - ./release/mac/OpenKosmos.app

# 7. Verify Gatekeeper
spctl -a -vvv -t install ./release/mac/OpenKosmos.app
```

### Option 2: Quick Signing Test (Skip Notarization)

Create a temporary configuration file `electron-builder.test.yml`:
```yaml
appId: com.kosmos.app
productName: OpenKosmos
mac:
  icon: brands/kosmos/assets/mac/app.icns
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  type: distribution
  # Skip notarization; test signing only
  notarize: false
  target:
    - target: dmg
      arch: x64
```

Build with the test configuration:
```bash
npm run build
electron-builder --mac --config electron-builder.test.yml
```

### Option 3: Run GitHub Actions Locally with act

#### Install act
```bash
# macOS
brew install act

# Or use the official install script
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

#### Configure secrets
Create a `.secrets` file:
```env
APPLE_ID=your@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_CERTIFICATE_P12=<base64_encoded_certificate>
APPLE_CERTIFICATE_PASSWORD=cert_password
GITHUB_TOKEN=your_github_token
```

#### Run local CI/CD test
```bash
# Test the macOS build job
act -j build-macos --secret-file .secrets

# Or just validate workflow syntax
act -j build-macos --secret-file .secrets --dryrun
```

**Note**: act simulates GitHub Actions locally but may not fully replicate the CI/CD environment.

## Common Troubleshooting

### 1. Check Code Signing Status
```bash
# Detailed signing information
codesign -dvvv ./release/mac/OpenKosmos.app

# View signing identity
codesign -d --extract-certificates ./release/mac/OpenKosmos.app

# Verify signature validity
codesign --verify --deep --strict --verbose=2 ./release/mac/OpenKosmos.app
```

### 2. Check Entitlements
```bash
# View actual entitlements in use
codesign -d --entitlements :- ./release/mac/OpenKosmos.app

# Compare with config file
diff <(plutil -convert xml1 -o - build/entitlements.mac.plist) \
     <(codesign -d --entitlements :- ./release/mac/OpenKosmos.app)
```

### 3. Test Notarization (requires waiting)
```bash
# Submit for notarization manually
xcrun notarytool submit ./release/OpenKosmos-*.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

# View notarization log
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
```

### 4. Simulate CI/CD Environment
```bash
# Using Docker (if a macOS Docker image is available)
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e APPLE_ID="$APPLE_ID" \
  -e APPLE_APP_SPECIFIC_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD" \
  -e APPLE_TEAM_ID="$APPLE_TEAM_ID" \
  macos-builder:latest \
  /bin/bash -c "npm ci && npm run build && npm run dist:mac"
```

## Quick Verification Script

Create `scripts/verify-build.sh`:
```bash
#!/bin/bash
set -e

APP_PATH="./release/mac/OpenKosmos.app"

echo "🔍 Verifying build..."

# 1. Check if the app exists
if [ ! -d "$APP_PATH" ]; then
  echo "❌ App not found at $APP_PATH"
  exit 1
fi
echo "✅ App exists"

# 2. Check code signing
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
  echo "✅ Code signature is valid"
else
  echo "❌ Code signature verification failed"
  codesign -dvvv "$APP_PATH"
  exit 1
fi

# 3. Check signing type
SIGNATURE=$(codesign -dv "$APP_PATH" 2>&1)
if echo "$SIGNATURE" | grep -q "Signature=adhoc"; then
  echo "⚠️  Warning: App has adhoc signature (not signed with Developer ID)"
  exit 1
fi
echo "✅ App is signed with Developer ID"

# 4. Check Hardened Runtime
if echo "$SIGNATURE" | grep -q "flags=0x10000(runtime)"; then
  echo "✅ Hardened Runtime is enabled"
else
  echo "⚠️  Warning: Hardened Runtime may not be enabled"
fi

# 5. Check entitlements
echo "📋 Entitlements:"
codesign -d --entitlements :- "$APP_PATH" 2>/dev/null | head -20

echo ""
echo "✅ Build verification complete!"
```

Usage:
```bash
chmod +x scripts/verify-build.sh
npm run dist:mac && ./scripts/verify-build.sh
```

## Best Practices

1. **During development**: Use `npm run dist:mac` to build locally and test signing
2. **Before committing**: Run `verify-build.sh` to ensure signing is correct
3. **CI/CD testing**: Use `act` to simulate GitHub Actions (optional)
4. **Final verification**: A minor-version tag triggers a real CI/CD build

## Reference Resources

- [Electron Builder Code Signing](https://www.electron.build/code-signing)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [act - Local GitHub Actions](https://github.com/nektos/act)
