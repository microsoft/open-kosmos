# macOS Code Signing Configuration Guide

This document explains how to configure macOS code signing and notarization for Kosmos.

## Prerequisites

1. Apple Developer Account (paid account)
2. A valid Developer ID Application certificate
3. An App-Specific Password

## GitHub Secrets Configuration

The following environment variables need to be added in your GitHub repository under Settings > Secrets and variables > Actions:

### Required Environment Variables

| Variable Name | Description | How to Obtain |
|---------------|-------------|---------------|
| `APPLE_CERTIFICATE_P12` | Base64-encoded developer certificate (.p12 file) | Export the certificate from Keychain, then convert to Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | The password set when exporting the certificate |
| `APPLE_TEAM_ID` | Apple Developer Team ID | View in the Apple Developer Console |
| `APPLE_ID` | Apple ID email | The Apple ID used for notarization |
| `APPLE_ID_PASSWORD` | App-Specific Password | Generate on the Apple ID management page |

### Certificate Preparation Steps

1. **Obtain the Developer Certificate**

```bash
# 1. Export the P12 file
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities \
  -f pkcs12 \
  -o dev-id.p12

# 2. Convert to base64 and copy to clipboard
base64 < dev-id.p12 | pbcopy
```

If successful, the clipboard will contain a long base64 string that can be pasted directly into GitHub Secrets:

```
MAC_CERT_BASE64 = <your base64 string>
```

---

# ❤️ Tip: How to verify the base64 conversion was successful?

You can run:

```bash
pbpaste | head
```

You should see:

```
MIIK...
```

If so, it was successful.



1. **Generate an App-Specific Password**
   - Visit https://appleid.apple.com/account/manage
   - Sign in with your Apple ID
   - Generate an "App-Specific Password" under the "Security" section
   - Set the generated password as APPLE_ID_PASSWORD

2. **Obtain the Team ID**
   - Visit https://developer.apple.com/account/
   - Find the Team ID in the upper right corner

## Configuration Verification

After setup is complete, push code or manually trigger the GitHub Actions workflow and check whether the code signing step in the build log succeeds.

## Troubleshooting

### Common Issues

1. **Certificate Import Failure**
   - Verify that APPLE_CERTIFICATE_P12 is valid Base64 encoding
   - Confirm that the APPLE_CERTIFICATE_PASSWORD is correct

2. **Notarization Failure**
   - Verify that APPLE_ID and APPLE_ID_PASSWORD are correct
   - Ensure the App-Specific Password has not expired

3. **Build Failure**
   - Verify that the certificate is of the "Developer ID Application" type
   - Confirm the certificate has not expired

### Debugging Commands

```bash
# Check certificates in the keychain
security find-identity -v -p codesigning

# Verify signature
codesign -vvv --deep --strict /path/to/app

# Check notarization status
xcrun notarytool history --apple-id "your@email.com" --password "app-password"
```

## Security Considerations

- Regularly update App-Specific Passwords
- Monitor certificate expiration dates and renew in advance
- Only use certificates in trusted CI/CD environments
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

- `notarize: false` - Disable electron-builder's automatic notarization
- `afterSign: "scripts/notarize.js"` - Use a custom notarization script

### How the Notarization Script Works

`scripts/notarize.js` will:
1. Check if the build is running on the macOS platform
2. Verify required environment variables (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
3. If credentials are complete, execute notarization
4. If credentials are missing or notarization fails, log the event but do not interrupt the build

This approach allows:
- Building in a development environment without notarization credentials
- Automatic notarization when credentials are provided in CI/CD
- The build process to continue even if notarization fails

## Related Files

- `.github/workflows/release.yml` - CI/CD pipeline configuration
- `package.json` - electron-builder configuration
- `build/entitlements.mac.plist` - Application entitlements configuration
- `scripts/notarize.js` - Custom notarization script