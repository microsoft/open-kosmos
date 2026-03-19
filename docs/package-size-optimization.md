# Package Size Optimization Guide

## 📊 Current Problem Analysis

Your installer reaches 200MB mainly due to the following dependencies:

### Large Dependencies (Sorted by Size)

1. **playwright (80-100MB)** ⚠️ Biggest issue
   - Contains complete browser engines for Chromium/Firefox/WebKit
   - Recommendation: If you only need web scraping, consider replacing with a lightweight alternative

2. **@xenova/transformers (50-80MB)** ⚠️
   - AI model library, includes pre-trained model files
   - Recommendation: Load models on demand instead of bundling all of them

3. **neo4j-driver (20-30MB)**
   - Graph database driver
   - Can be removed if graph database features are not needed

4. **jsdom (15-20MB)**
   - DOM parsing library
   - Consider whether a full DOM implementation is really necessary

5. **@vscode/ripgrep + sqlite3 (10-15MB each)**
   - Native modules, essential functional dependencies

## 🎯 Optimization Plans

### Plan 1: Use Optimized Configuration (Estimated Reduction: 30-50MB)

```bash
# Build with the optimized configuration
npm run build && electron-builder --config electron-builder.optimized.yml
```

The optimized configuration has been created at `electron-builder.optimized.yml`, with the following key optimizations:
- Exclude all source maps
- Exclude test files and sample code
- Exclude documentation files
- Use maximum compression
- Exclude Playwright browser engines

### Plan 2: Remove/Replace Large Dependencies (Estimated Reduction: 100-150MB)

#### 2.1 Playwright Alternatives

If you only need basic web scraping functionality:

```bash
# Remove playwright
npm uninstall playwright

# Use lightweight alternatives
npm install puppeteer-core  # ~5MB, does not include a browser
# or
npm install cheerio axios   # ~2MB, HTML parsing only
```

#### 2.2 Transformers Optimization

```bash
# If local AI models are not needed, remove it
npm uninstall @xenova/transformers

# Or configure on-demand loading (dynamic import in code)
```

#### 2.3 Neo4j Optimization

```bash
# If graph database is not used
npm uninstall neo4j-driver
```

### Plan 3: On-Demand Loading Strategy

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

### Plan 4: Split Optional Features

Move large dependencies to `optionalDependencies`:

```json
{
  "optionalDependencies": {
    "playwright": "^1.56.1",
    "@xenova/transformers": "^2.17.2",
    "neo4j-driver": "^5.28.2"
  }
}
```

Then check availability in code and load dynamically.

## 🔧 Implementation Steps

### Step 1: Test with the Optimized Configuration

```bash
# First, test the effect of the optimized configuration
npm run build
electron-builder --config electron-builder.optimized.yml --win --x64
```

Check the generated installer size; an estimated reduction of 30-50MB is expected.

### Step 2: Analyze Dependency Usage

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

If these libraries are essential, consider lazy loading:

```typescript
// Bad practice
import playwright from 'playwright';

// Good practice - load on demand
async function useBrowser() {
  const playwright = await import('playwright');
  // Use playwright
}
```

## 📉 Expected Results

| Optimization Plan | Estimated Size Reduction | Effort | Risk |
|-------------------|--------------------------|--------|------|
| Optimized Configuration | 30-50MB | Low | Low |
| Remove Playwright | 80-100MB | Medium | Medium |
| Remove Transformers | 50-80MB | Medium | Medium |
| Remove Neo4j | 20-30MB | Low | Low |
| Combined Optimization | 100-150MB | High | Medium |

## ⚠️ Important Notes

1. **Feature Validation**: Before removing any dependency, ensure it does not affect core functionality
2. **Testing**: Perform thorough testing after each optimization
3. **Incremental Optimization**: Start with the optimized configuration, then consider removing dependencies
4. **Backup**: Back up the current `package.json` before optimizing

## 🚀 Quick Start

1. First, test the effect using the optimized configuration:
   ```bash
   npm run build && electron-builder --config electron-builder.optimized.yml
   ```

2. Check the generated installer size

3. Decide whether to remove large dependencies based on actual needs

4. Test and verify incrementally

## 📝 Future Recommendations

- Consider moving large resources such as AI models and browser engines to cloud-based downloads
- Implement a lazy loading mechanism to download required components on first launch
- Regularly audit dependencies and remove packages that are no longer used