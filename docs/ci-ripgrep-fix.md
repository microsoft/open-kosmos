# CI Build @vscode/ripgrep 403 Error Fix

## Problem Description

When building in a GitHub Actions CI environment, the postinstall script for the `@vscode/ripgrep` package frequently fails with 403 errors:

```
npm error GET https://api.github.com/repos/microsoft/ripgrep-prebuilt/releases/tags/v13.0.0-13
npm error Error: Request failed: 403
npm error Downloading ripgrep failed after multiple retries
```

## Root Cause

1. **GitHub API rate limiting**
   - Unauthenticated requests: 60 per hour
   - Authenticated requests: 5,000 per hour
   - Multiple jobs in CI share the same IP, which can easily hit the limit

2. **How @vscode/ripgrep works**
   - During installation, the postinstall script fetches release information from the GitHub API
   - Downloads the prebuilt ripgrep binary
   - Retries 4 times on failure, with increasing intervals

3. **Why failures are intermittent**
   - GitHub Runners share an IP pool
   - Requests from other users may have already consumed the API quota
   - Network jitter or temporary API unavailability

## Solutions

### 1. Pass GitHub Token (primary fix)

Pass `GITHUB_TOKEN` in the CI `npm ci` step:

```yaml
- name: Install dependencies
  run: npm ci --prefer-offline --no-audit
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**How it works**:
- GitHub Actions automatically injects `secrets.GITHUB_TOKEN`
- The `@vscode/ripgrep` postinstall script detects and uses this token
- Authenticated requests get a higher rate limit (5,000 per hour)

### 2. Optimize npm install options

Add the following options to reduce unnecessary requests:

```yaml
npm ci --prefer-offline --no-audit
```

- `--prefer-offline`: prefer local cache
- `--no-audit`: skip security audit, reducing network requests

### 3. Use npm cache

GitHub Actions is configured with npm cache:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'
```

This caches the `~/.npm` directory, including downloaded ripgrep binaries.

### 4. .npmrc configuration

The project's `.npmrc` has the relevant note added:

```properties
# GitHub API configuration — for packages like @vscode/ripgrep
# CI environments automatically inject the GITHUB_TOKEN environment variable to avoid API rate limits
# Local development does not need this configuration
```

## Applied Fixes

### Mac CI (`.github/workflows/release.yml`)

```yaml
- name: Install dependencies
  run: |
    echo "Installing dependencies..."
    npm ci --prefer-offline --no-audit
    echo "Dependencies installation completed"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    npm_config_build_from_source: false
```

### Windows CI (`.github/workflows/release.yml`)

```yaml
- name: Install dependencies
  run: |
    Write-Host "Installing dependencies..." -ForegroundColor Green
    npm ci --prefer-offline --no-audit
    Write-Host "Dependencies installation completed" -ForegroundColor Green
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    npm_config_msvs_version: 2022
    npm_config_build_from_source: false
    npm_config_node_gyp: node_modules\.bin\node-gyp.cmd
  shell: powershell
```

## Verification Methods

1. **Check CI logs**: Confirm ripgrep installation has no 403 errors
2. **Check build time**: Should be reduced (using cache)
3. **Success rate monitoring**: Continuously monitor build success rate

## Fallback Options (if the issue persists)

If the above solutions still do not resolve the issue, consider:

### Option A: Pre-cache ripgrep

Manually download and cache ripgrep in CI:

```yaml
- name: Cache ripgrep binary
  uses: actions/cache@v3
  with:
    path: node_modules/@vscode/ripgrep/bin
    key: ripgrep-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Pre-download ripgrep if needed
  run: |
    if [ ! -f "node_modules/@vscode/ripgrep/bin/rg" ]; then
      npm install @vscode/ripgrep --ignore-scripts
      cd node_modules/@vscode/ripgrep
      node lib/postinstall.js
    fi
```

### Option B: Use npm mirror

Configure `.npmrc` to use a mirror (if needed):

```properties
registry=https://registry.npmmirror.com
```

### Option C: Pin ripgrep version

Pin a specific version in `package.json`:

```json
{
  "dependencies": {
    "@vscode/ripgrep": "1.15.14"
  },
  "resolutions": {
    "@vscode/ripgrep": "1.15.14"
  }
}
```

## References

- [GitHub API Rate Limiting](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api)
- [@vscode/ripgrep GitHub](https://github.com/microsoft/vscode-ripgrep)
- [ripgrep-prebuilt Releases](https://github.com/microsoft/ripgrep-prebuilt/releases)
- [npm ci documentation](https://docs.npmjs.com/cli/v10/commands/npm-ci)

## Changelog

- **2026-01-14**: Initial fix — added GITHUB_TOKEN and optimized npm options
