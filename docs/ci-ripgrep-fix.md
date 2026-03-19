# CI Build @vscode/ripgrep 403 Error Fix

## Problem Description

During builds in the GitHub Actions CI environment, the `@vscode/ripgrep` package's postinstall script frequently fails with a 403 error:

```
npm error GET https://api.github.com/repos/microsoft/ripgrep-prebuilt/releases/tags/v13.0.0-13
npm error Error: Request failed: 403
npm error Downloading ripgrep failed after multiple retries
```

## Root Cause

1. **GitHub API Rate Limiting**
   - Unauthenticated requests: 60 per hour
   - Authenticated requests: 5,000 per hour
   - In CI environments, multiple jobs share the same IP, making it easy to hit the limit

2. **How @vscode/ripgrep Works**
   - During installation, the postinstall script fetches release information from the GitHub API
   - Downloads precompiled ripgrep binaries
   - Retries up to 4 times on failure with increasing intervals

3. **Intermittent Failure Causes**
   - GitHub Runners share an IP pool
   - Other users' requests may have already consumed the API quota
   - Network jitter or temporary API unavailability

## Solution

### 1. Pass GitHub Token (Primary Fix)

Pass `GITHUB_TOKEN` in the CI `npm ci` step:

```yaml
- name: Install dependencies
  run: npm ci --prefer-offline --no-audit
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**How It Works**:
- GitHub Actions automatically injects `secrets.GITHUB_TOKEN`
- The `@vscode/ripgrep` postinstall script detects and uses this token
- Authenticated requests receive a higher rate limit (5,000 per hour)

### 2. Optimize npm Install Options

Add the following options to reduce unnecessary requests:

```yaml
npm ci --prefer-offline --no-audit
```

- `--prefer-offline`: Prefer using local cache
- `--no-audit`: Skip security audit to reduce network requests

### 3. Leverage npm Cache

GitHub Actions already has npm caching configured:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'
```

This caches the `~/.npm` directory, including already-downloaded ripgrep binaries.

### 4. .npmrc Configuration

The project's `.npmrc` already includes relevant notes:

```properties
# GitHub API configuration - for dependencies like @vscode/ripgrep
# CI environments automatically inject the GITHUB_TOKEN environment variable to avoid API rate limiting
# This configuration is not needed for local development
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

## Verification

1. **Check CI Logs**: Confirm ripgrep installation has no 403 errors
2. **Check Build Time**: Should be somewhat reduced (leveraging cache)
3. **Success Rate Monitoring**: Continuously monitor build success rate

## Alternative Solutions (If the Issue Persists)

If the above solution still does not resolve the issue, consider the following:

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

### Option B: Use npm Mirror

Configure `.npmrc` to use a China mirror (if needed):

```properties
registry=https://registry.npmmirror.com
```

### Option C: Pin ripgrep Version

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

- **2026-01-14**: Initial fix - Added GITHUB_TOKEN and optimized npm options
