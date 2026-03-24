# GitHub Secrets Configuration Guide - macOS Code Signing and Notarization

This document explains how to properly configure GitHub Secrets to support macOS application code signing and notarization.

## Problem Diagnosis

If the CI/CD build shows the following error:

```
Authority=Apple Development: Hu Yan (S233332A43)
❌ Notarization failed: Error: Failed to notarize via notarytool
{"status":"Invalid","message":"Processing complete"}
```

This indicates that an **Apple Development** certificate was used instead of a **Developer ID Application** certificate.

## Certificate Type Descriptions

### Apple Development (Development Certificate) ❌
- **Usage**: Only for local development and internal team testing
- **Limitations**: 
  - Cannot be used for notarization
  - Cannot be distributed to users outside the team
  - Can only run on developer devices
- **Signing Identity**: `Apple Development: Your Name (TEAM_MEMBER_ID)`

### Developer ID Application (Distribution Certificate) ✅
- **Usage**: For distributing applications outside the App Store
- **Capabilities**:
  - Can pass notarization
  - Can be distributed to any user
  - Verified by Gatekeeper
- **Signing Identity**: `Developer ID Application: Your Name (TEAM_ID)`

## Configuration Steps

### 1. Obtain a Developer ID Application Certificate

#### Method A: Create a New Certificate from the Apple Developer Website

1. Visit [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list)
2. Click "+" to create a new certificate
3. Select "Developer ID Application"
4. Upload a Certificate Signing Request (CSR)
5. Download the certificate and double-click to install it in Keychain

#### Method B: Export from Existing Keychain

1. Open **Keychain Access**
2. Select "login" or "My Certificates" in the left sidebar
3. Find the **Developer ID Application** certificate
   - ✅ Correct: "Developer ID Application: Your Name (TEAM_ID)"
   - ❌ Incorrect: "Apple Development: Your Name (MEMBER_ID)"
4. Right-click the certificate → **Export "Developer ID Application: ..."**
5. Select file format: **.p12**
6. Set a password (remember this password; it will be needed later)
7. Save as `certificate.p12`

### 2. Convert the Certificate to Base64

Run the following in the terminal:

```bash
# Convert the certificate to base64 and copy to clipboard
base64 -i certificate.p12 | pbcopy

# Or save to a file
base64 -i certificate.p12 > certificate.base64.txt
```

### 3. Configure GitHub Secrets

Go to your GitHub repository settings:
```
https://github.com/microsoft/open-kosmos/settings/secrets/actions
```

Configure the following Secrets:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `APPLE_CERTIFICATE_P12` | `<base64-encoded certificate content>` | The base64 string generated in Step 2 |
| `APPLE_CERTIFICATE_PASSWORD` | `<certificate password>` | The password set when exporting the .p12 file |
| `APPLE_ID` | `your@email.com` | Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` | App-specific password (see below) |
| `APPLE_TEAM_ID` | `XXXXXXXXXX` | 10-character Team ID |

### 4. Obtain an Apple App-Specific Password

1. Visit the [Apple ID Account Page](https://appleid.apple.com/)
2. After signing in, go to the "Security" section
3. Under "App-Specific Passwords," click "Generate Password"
4. Enter a label name (e.g., "Kosmos App Notarization")
5. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)
6. Save it to the GitHub Secret `APPLE_APP_SPECIFIC_PASSWORD`

### 5. Obtain the Team ID

#### Method A: From Certificate Information
```bash
# View certificate details
security find-identity -v -p codesigning | grep "Developer ID Application"

# Example output:
# 1) XXXXX "Developer ID Application: Your Name (XXXXXXXXXX)"
#                                                    ^^^^^^^^^^
#                                                    This is the Team ID
```

#### Method B: From the Apple Developer Website
1. Visit [Apple Developer Membership](https://developer.apple.com/account/#/membership/)
2. Find the "Team ID" field
3. Copy the 10-character Team ID

### 6. Verify Configuration

#### Verify Certificate Locally
```bash
# Verify certificate type
security find-identity -v -p codesigning

# You should see:
# ✅ "Developer ID Application: Your Name (TEAM_ID)"
# You should NOT see:
# ❌ "Apple Development: Your Name (MEMBER_ID)"
```

#### CI/CD Verification
1. Push code or create a new tag
2. Wait for GitHub Actions to run
3. Check the signing information in the build logs:
   ```
   Authority=Developer ID Application: Your Name (TEAM_ID)  ✅
   ```

## FAQ

### Q: I have multiple certificates. Which one should I use?
A: Use the **Developer ID Application** certificate, not the Apple Development certificate.

### Q: What should I do if the certificate has expired?
A: 
1. Revoke the old certificate on the Apple Developer website
2. Create a new Developer ID Application certificate
3. Re-export and update the GitHub Secret

### Q: How do I verify that the GitHub Secret is correct?
A: Run CI/CD and check the signing information in the build logs. The logs will show the certificate type being used.

### Q: Notarization still fails with status "Invalid"
A: 
1. Check whether `build/entitlements.mac.plist` contains disallowed entitlements
2. Use `xcrun notarytool log <submission-id>` to view detailed errors
3. Confirm the application is properly signed and uses a Developer ID Application certificate

## Security Notice

⚠️ **Important**: 
- Certificates and passwords are sensitive information and should only be configured in GitHub Secrets
- Do not commit certificates or passwords to the code repository
- Rotate app-specific passwords regularly
- Update certificates promptly before they expire

## References

- [Apple: Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Apple: Creating Distribution-Signed Code](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/resolving_common_notarization_issues)
- [Electron Builder: Code Signing](https://www.electron.build/code-signing)
- [GitHub: Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

## Related Documentation

- [Local Build Testing Guide](./local-build-test.md)
- [macOS Code Signing Documentation](./macos-code-signing.md)
