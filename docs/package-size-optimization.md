# Package Size Optimization Guide

## 📊 Current Problem Analysis

Your installation package reaching 200 MB is mainly due to the following dependencies:

### Large Dependencies (Sorted by Size)

1. **playwright (80–100 MB)** ⚠️ Biggest issue
   - Includes complete Chromium/Firefox/WebKit browser engines
   - Recommendation: if only basic web scraping is needed, consider replacing with a lightweight alternative

2. **@xenova/transformers (50–80 MB)** ⚠️
   - AI model library, includes pre-trained model files
   - Recommendation: load models on demand; do not bundle all of them

3. **neo4j-driver (20–30 MB)**
   - Graph database driver
   - Can be removed if graph database functionality is not used

4. **jsdom (15–20 MB)**
   - DOM parsing library
   - Consider whether a full DOM implementation is truly needed

5. **@vscode/ripgrep + sqlite3 (10–15 MB each)**
   - Native modules; required functional dependencies

## 🎯 Optimization Options

### Option 1: Use Optimized Configuration (Expected reduction: 30–50 MB)

```bash
# Package with the optimized configuration
npm run build && electron-builder --config electron-builder.optimized.yml
```

An optimized configuration has been created at `electron-builder.optimized.yml`, with the following main optimizations:
- Exclude all source maps
- Exclude test files and sample code
- Exclude documentation files
- Use maximum compression
- Exclude Playwright browser engines

### Option 2: Remove/Replace Large Dependencies (Expected reduction: 100–150 MB)

#### 2.1 Playwright Alternatives

If only basic web scraping is needed:

```bash
# Remove playwright
npm uninstall playwright

# Use a lightweight alternative
npm install puppeteer-core  # ~5 MB, does not include browser
# or
npm install cheerio axios   # ~2 MB, HTML parsing only
```

#### 2.2 Transformers Optimization

```bash
# If local AI models are not needed, remove the package
npm uninstall @xenova/transformers

# Or configure for on-demand loading (dynamic import in code)
```

#### 2.3 Neo4j Optimization

```bash
# If graph database is not used
npm uninstall neo4j-driver
```

### Option 3: On-Demand Loading Strategy

Modify the `files` configuration in [`package.json`](package.json:169):

```json
{
  "build": {
    "files": [
      "dist/**/*",
      "resources/**/*",
      "package.json",
      "!**/*.map",
      "!**/node_modules/playwright*/.local-browsers/**",
      "!**/node_modules/@xenova/transformers/models/**"
    ]
  }
}
```

### Option 4: Split Optional Features

Set large dependencies as `optionalDependencies`:

```json
{
  "optionalDependencies": {
    "playwright": "^1.56.1",
    "@xenova/transformers": "^2.17.2",
    "neo4j-driver": "^5.28.2"
  }
}
```

Then check for availability in code and load dynamically.

## 🔧 Concrete Implementation Steps

### Step 1: Test with Optimized Configuration

```bash
# First test the effect of the optimized configuration
npm run build
electron-builder --config electron-builder.optimized.yml --win --x64
```

Check the generated installation package size; expected reduction is 30–50 MB.

### Step 2: Inspect Dependency Usage

```bash
# Analyze which dependencies are actually used
npx webpack-bundle-analyzer dist/renderer/main.js
```

### Step 3: Remove Unnecessary Dependencies

Based on actual usage, remove the following dependencies (if not needed):

```bash
# Check if Playwright is used
npx grep-search "playwright" src --exclude-dir=node_modules

# Check if Transformers is used
npx grep-search "@xenova/transformers" src --exclude-dir=node_modules

# Check if Neo4j is used
npx grep-search "neo4j" src --exclude-dir=node_modules
```

### Step 4: Code-Level Optimization

If these libraries are required, consider lazy loading:

```typescript
// Bad practice
import playwright from 'playwright';

// Good practice — load on demand
async function useBrowser() {
  const playwright = await import('playwright');
  // use playwright
}
```

## 📉 Expected Results

| Optimization Option | Expected Size Reduction | Effort | Risk |
|---------|------------|--------|------|
| Optimized configuration | 30–50 MB | Low | Low |
| Remove Playwright | 80–100 MB | Medium | Medium |
| Remove Transformers | 50–80 MB | Medium | Medium |
| Remove Neo4j | 20–30 MB | Low | Low |
| Combined optimization | 100–150 MB | High | Medium |

## ⚠️ Notes

1. **Functional verification**: Before removing any dependency, ensure it won't affect core functionality
2. **Testing**: Perform a full test after each optimization
3. **Incremental optimization**: Start with the optimized configuration before considering removing dependencies
4. **Backup**: Back up the current `package.json` before optimizing

## 🚀 Quick Start

1. First test the effect with the optimized configuration:
   ```bash
   npm run build && electron-builder --config electron-builder.optimized.yml
   ```

2. Check the generated installation package size

3. Decide whether to remove large dependencies based on actual needs

4. Test and verify incrementally

## 📝 Follow-up Recommendations

- Consider moving large resources such as AI models and browser engines to cloud downloads
- Implement a lazy-loading mechanism that downloads required components on first launch
- Periodically audit dependencies and remove packages that are no longer used
