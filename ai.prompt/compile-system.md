<!-- Last verified: 2026-04-19 -->

# Build System Documentation

## Current Status: Vite Primary, Webpack Fallback

The project has completed its migration to Vite for the development environment: the default `npm run dev` uses electron-vite. Webpack is retained as a fallback (the `dev:wp` script family). Production build/pack still uses Webpack as the primary path; the Vite-based build/pack is ready but still under validation.


---


# Webpack Build System (Current)

Built on webpack 5, paired with webpack-dev-server, HtmlWebpackPlugin, and various loaders.

**Config files:**
| File | Responsibility |
|------|----------------|
| `webpack.main.config.js` | Main-process build |
| `webpack.renderer.config.js` | Renderer-process build (includes 3 HTML entries) |

**npm scripts:**
```bash
npm run dev:wp            # Full Webpack dev mode (main + renderer watch + electron)
npm run dev:wp:main       # Main-process watch only
npm run dev:wp:render     # Renderer dev-server only
npm run dev:wp:electron   # Start electron after build is ready
npm run build             # Build (main + renderer, still using Webpack)
npm run start             # Webpack build and run
```

**Known issues:**
- Slow builds (production build ~71s, dev build ~39s)
- HMR does not work in the Electron environment
- Complex configuration, lengthy loader chains
- Webpack 5 ecosystem is aging; the community has shifted focus to Vite


---


# Vite Build System (Target)

Based on **electron-vite 5.x** (vite 7 + esbuild + rollup). Future smooth migration to vite 8 + rolldown is expected (another order-of-magnitude speedup).

### Performance Comparison

| Metric | Webpack | Vite | Notes |
|--------|---------|------|-------|
| Production build | ~71s | ~15s | ~4.7x speedup |
| Dev build | ~39s | 6~15s | Very fast on cache hit; ~15s on cold start or cache miss |

### Build Output Comparison (measured 2026-03-26)

**Build time:** Webpack 54.5s vs Vite 14.3s (3.8x speedup, including minification)

#### Main Process

| | Webpack | Vite | Notes |
|---|---------|------|-------|
| main.js | 9.8 MB (single file) | 1.2 MB + multiple chunks | Vite externalizes node_modules |
| preload.js | 62 KB | 101 KB | |
| preload.screenshot.js | 2.1 KB | 311 B | |
| **Directory total** | **10 MB** | **3.3 MB** | **67% reduction with Vite** |

> The core reason Vite main output is much smaller: `externalizeDeps` excludes all node_modules from the bundle (resolved at runtime by Node.js `require`), whereas Webpack bundled them into a single main.js.

Todo:
- Needs deeper investigation: will there be runtime issues when building the final app artifact with electron-builder?
- Main and preload should also enable split chunks, otherwise dynamic `import()` syntax has no effect

#### Renderer Process

| | Webpack | Vite | Notes |
|---|---------|------|-------|
| App JS (excluding Monaco) | 5.8 MB (CSS inlined in JS) | 5.3 MB | Vite slightly smaller; CSS extracted separately |
| CSS | (inlined in JS) | 0.5 MB (separate file) | Vite extracts to a standalone .css file |
| Monaco Editor | 13.1 MB (async-monaco single file) | 3.6 MB editor.main + 8.7 MB workers | Total 12.3 MB, slightly smaller |
| Other assets (SVG/TTF) | 1.4 MB | 1.4 MB | |
| **Directory total** | **31 MB** | **20 MB** | **35% reduction with Vite** |


### Configuration Architecture

**Core config:** `electron.vite.config.ts` — unified configuration for main / preload / renderer build targets

```
electron.vite.config.ts
├── main:      src/main/bootstrap.ts  → dist-vite/main/     (ESM)
├── preload:   src/preload/*.ts   → dist-vite/main/     (CJS, same directory as main)
└── renderer:  src/renderer/*.html    → dist-vite/renderer/  (React SPA)
```

**Helper scripts:**
| File | Responsibility |
|------|----------------|
| `scripts/vite/defines.ts` | Compile-time environment variable substitution (migrated from webpack DefinePlugin) |
| `scripts/vite/ejs-template-plugin.ts` | HTML template compatibility layer (reproduces HtmlWebpackPlugin behavior) |

**New dependencies:**
- `electron-vite` ^5.0.0
- `@vitejs/plugin-react` ^4.7.0
- `vite-plugin-monaco-editor` ^1.1.0

**npm scripts:**
```bash
npm run dev                # Default dev mode (electron-vite dev -w, now the primary)
npm run dev:full           # Equivalent to npm run dev (old name retained)
npm run build:vite         # Vite build
npm run start:vite         # Vite build and run
npm run pack:vite          # Run electron-builder --dir packaging on the Vite output (bun script)
```

All scripts support brand selection via the `--brand` flag. `npm run dev` specifies the entry via `ELECTRON_ENTRY=dist-vite/main/main.js`.


---


# Migration Compatibility Changes

### 1. Unified HTML Templates (compatible with Webpack + Vite)

The two HTML entries (`index.html`, `screenshot.html`) have been updated to use EJS template syntax:
- `<%= connectSrcExtra %>` — Injects `ws: wss:` into CSP in dev mode (required by Vite HMR WebSocket)
- `<%- entryScript %>` — In Vite mode, injects a `<script type="module">` entry; in Webpack mode outputs an empty string

The Webpack side passes empty values in `HtmlWebpackPlugin`'s `templateParameters` to maintain backward compatibility.

### 2. Dynamic require → Static import

Vite does not support runtime `require()`, so the following patterns were unified to ES Module static imports:

- **Brand icon loading**: The previous `` require(`../../assets/${BRAND_NAME}/app.svg`) `` pattern was replaced with a new module `src/renderer/lib/brandIcon.ts` that statically imports both brand SVGs and selects at runtime by `BRAND_NAME`. Related components (WindowsTitleBar, StartupPage, FreFirstAgentTutorialView, AboutAppContentView) all reference this module.
- **agentChatSessionCacheManager**: Multiple `require('...')` calls were replaced with a top-level `import { agentChatSessionCacheManager }` static import (AppLayout, ContentContainer, profileDataManager).
- **SchedulerIPC**: The `require('./lib/scheduler/SchedulerIPC')` in `main.ts` was changed to a top-level static import.

### 3. Dev Server URL Adaptation

In `src/main/main.ts` and `ScreenshotManager.ts`:
```typescript
// Before: hardcoded webpack-dev-server address
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
// After: prefer the environment variable injected by electron-vite
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || `http://localhost:${DEV_SERVER_PORT}`;
```

### 4. Preload Output Directory Design

Preload scripts are compiled to the same `dist-vite/main/` directory as main (`emptyOutDir: false`), ensuring `__dirname` relative paths match the Webpack layout and avoiding path resolution issues. Preload is forced to CJS format (ESM preload cannot `require('electron')`).

### 5. Buffer Polyfill

`import { Buffer } from 'buffer'` was added to the top of `src/renderer/screenshot/core/state/editor.ts` and `handlers.ts`, because Vite does not auto-polyfill Node.js built-in modules the way Webpack 5 does.

### 6. Environment Variable Handling Differences

Webpack `DefinePlugin` produces a JavaScript `undefined` when an environment variable is not set. In the Vite `define` config, `|| ''` is used uniformly to fall back to an empty string, preventing `TypeError` in string operations such as `.includes()`.


---


# Migration Plan and Progress

### Completed
- [x] electron-vite config file (main / preload / renderer three targets)
- [x] Environment variable replacement layer (defines.ts)
- [x] HTML EJS template compatibility layer (ejs-template-plugin.ts)
- [x] npm scripts (dev / dev:full / build:vite / start:vite / pack:vite)
- [x] Source code adaptations (dynamic require → static import, Buffer polyfill, Dev Server URL)
- [x] Webpack backward compatibility (empty templateParameters injection, dev:wp scripts retained as fallback)
- [x] .gitignore updated with dist-vite/
- [x] **Default dev mode switched to Vite** (`npm run dev` now uses electron-vite)

### Pending
- [ ] Full remediation of remaining `require` syntax
- [ ] Switch production build to Vite (current `npm run build` still uses Webpack)
- [ ] Build + Pack (electron-builder) integration testing (pack:vite script is ready, awaiting regression)
- [ ] E2E tests passing on the Vite build output
- [ ] Performance benchmarks (build time & output size comparison)
- [ ] Remove Webpack config and dependencies (final phase)

### Migration Strategy
1. ~~**Current phase**: Use Vite dev mode to improve development efficiency; Webpack remains the primary production build~~ ✅ Completed
2. **Current phase**: Get production build + pack working on Vite; functional regression of output artifacts
3. **Switchover phase**: Switch default build/pack to Vite; Webpack as fallback
4. **Cleanup phase**: Remove Webpack configuration, loader dependencies, and old npm scripts


---


# Design Decision Notes

| Decision | Rationale |
|----------|-----------|
| Output to `dist-vite/` instead of `dist/` | Avoids conflicts with Webpack output; enables parallel comparison |
| Preload and main share output directory | Ensures consistent `__dirname` path resolution |
| HTML templates use EJS compatibility layer | One HTML file serves both Webpack and Vite |
| Brand icons changed to static import map | Eliminates runtime require; Vite-friendly |
| Undefined environment variables fall back to empty string | Prevents runtime errors from undefined |
| Renderer dev server port 39017 | Distinguished from webpack-dev-server; avoids port conflicts |
