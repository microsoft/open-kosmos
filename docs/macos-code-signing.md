# macOS Code Signing Configuration Guide

This document explains how to configure macOS code signing and notarization for Kosmos.app.

## Prerequisites

1. Apple Developer Account (paid account)
2. A valid Developer ID Application certificate
3. An App-Specific Password

## GitHub Secrets Configuration

The following environment variables need to be added in the GitHub repository under Settings > Secrets and variables > Actions:

### Required Environment Variables

| Variable | Description | How to Obtain |
|--------|------|----------|
| `APPLE_CERTIFICATE_P12` | Base64-encoded developer certificate (.p12 file) | Export certificate from Keychain, then convert to Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | Password set when exporting the certificate |
| `APPLE_TEAM_ID` | Apple Developer Team ID | View in Apple Developer Console |
| `APPLE_ID` | Apple ID email | Apple ID used for notarization |
| `APPLE_ID_PASSWORD` | App-Specific Password | Generate on the Apple ID management page |

### Certificate Preparation Steps

1. **Obtain the developer certificate**

```bash
# 1. Export the P12 file
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities \
  -f pkcs12 \
  -o dev-id.p12

# 2. Convert to Base64 and copy to clipboard
base64 < dev-id.p12 | pbcopy
```

If successful, your clipboard will contain a long Base64 string that can be pasted directly into GitHub Secrets:

```
MAC_CERT_BASE64 = <your base64 string>
```

---

# ❤️ Tip: How to verify if Base64 encoding succeeded

You can run:

```bash
pbpaste | head
```

You should see:

```
MIIK...
```

If so, it worked.



1. **Generate an App-Specific Password**
   - Visit https://appleid.apple.com/account/manage
   - Sign in with your Apple ID
   - Generate an "App-Specific Password" in the "Security" section
   - Set the generated password as APPLE_ID_PASSWORD

2. **Obtain the Team ID**
   - Visit https://developer.apple.com/account/
   - View the Team ID in the upper-right corner

## Configuration Verification

After setup, push code or manually trigger the GitHub Actions workflow and check the build log to confirm the code signing step succeeds.

## Troubleshooting

### Common Issues

1. **Certificate import failure**
   - Check that APPLE_CERTIFICATE_P12 is valid Base64-encoded data
   - Confirm the APPLE_CERTIFICATE_PASSWORD is correct

2. **Notarization failure**
   - Verify APPLE_ID and APPLE_ID_PASSWORD are correct
   - Ensure the App-Specific Password has not expired

3. **Build failure**
   - Check that the certificate is of type "Developer ID Application"
   - Confirm the certificate has not expired

### Debug Commands

```bash
# Check certificates in Keychain
security find-identity -v -p codesigning

# Verify signing
codesign -vvv --deep --strict /path/to/app

# Check notarization status
xcrun notarytool history --apple-id "your@email.com" --password "app-password"
```

## Security Notes

- Rotate App-Specific Passwords regularly
- Monitor certificate expiration and renew in advance
- Use certificates only in trusted CI/CD environments
- Rotate GitHub Secrets periodically

## Configuration Details

### package.json Configuration

In the `build.mac` section of `package.json`:

```json
{
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "type": "distribution",
    "notarize": false,
    "afterSign": "scripts/notarize.js"
  }
}
```

- `notarize: false` — Disables electron-builder's automatic notarization
- `afterSign: "scripts/notarize.js"` — Uses a custom notarization script

### How the Notarization Script Works

`scripts/notarize.js` will:
1. Check whether the build is on macOS
2. Verify the required environment variables (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
3. If credentials are complete, perform notarization
4. If credentials are missing or notarization fails, log the issue but do not interrupt the build

This approach allows:
- Building in a development environment without notarization credentials
- Automatic notarization when credentials are provided in CI/CD
- Notarization failures do not completely block the build process

## Related Files

- `.github/workflows/release.yml` — CI/CD pipeline configuration
- `package.json` — electron-builder configuration
- `build/entitlements.mac.plist` — Application entitlements configuration
- `scripts/notarize.js` — Custom notarization script
