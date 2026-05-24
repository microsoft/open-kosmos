# Workflows

Reference: `CLAUDE.md`, `.github/prompts/gitpush.prompt.md`, `playwright.config.ts`, `electron-builder.config.js`

---

## Git Conventions

**Branch naming:** `user/<alias>/<feature-name>`
- Example: `user/alice/add-tool-execution-logs`

**Commit message format** — conventional commits:
```
type(scope): concise description

- Detailed change 1
- Detailed change 2
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Pull requests:**
- Titles must be written in English, under 70 characters
- Use the body/description for details, not the title
- Automated PR workflow: `.github/prompts/gitpush.prompt.md`
- Process: create branch from `main` → make changes → open PR → request review → merge after approval

---

## Testing Strategy

### vitest (Unit / Integration)
- Runner: ts-vitest, node environment
- Test files co-located with implementation: `*.test.ts`
- Path aliases: `@shared/*`, `@renderer/*`
- Main process tests require Electron mocking
- Test roots: `src/` and `tests/`
- Commands:
  ```bash
  npm test           # run all vitest tests
  npm run lint       # check code style
  npm run lint:fix   # auto-fix linting issues
  ```

### Playwright E2E
- Location: `tests/e2e/`
- Config: `playwright.config.ts` — 60s timeout, single-worker serial execution
- Fixtures: custom Electron fixtures via `_electron.launch()`, isolated via `OpenKosmos_TEST_USER_DATA_PATH`
- Test suites: `startup.e2e.ts` (9 tests), `auth.e2e.ts` (6 tests), `chat.e2e.ts` (4 tests)
- Covers full lifecycle: startup → authentication → chat interaction
- Commands:
  ```bash
  npm run test:e2e           # run all E2E tests
  npm run test:e2e:headed    # E2E with visible browser
  npm run test:e2e:ui        # Playwright UI mode
  npm run test:e2e:debug     # debug mode
  npm run test:e2e:report    # open HTML report
  ```

---

## Release Process

```bash
# Prepare releases (updates version, changelog)
npm run prepare:release         # interactive
npm run prepare:release:patch   # x.x.1
npm run prepare:release:minor   # x.1.0
npm run prepare:release:major   # 1.0.0

# Build installers
npm run dist            # current platform
npm run dist:win        # Windows (NSIS + ZIP)
npm run dist:mac        # macOS (DMG + ZIP)
npm run dist:linux      # Linux (AppImage)
npm run dist:all        # all platforms

# Architecture-specific
npm run dist:win:x64
npm run dist:win:arm64
npm run dist:mac:x64
npm run dist:mac:arm64
npm run dist:mac:universal

# Publish to GitHub Releases (gim-home/Kosmos)
npm run dist:publish        # build + publish
npm run dist:publish:win
npm run dist:publish:mac
```

macOS builds use hardened runtime and notarization via `scripts/notarize.js`.

Release workflow note:
- Windows release jobs are split by architecture.
- Windows x64 builds run on `windows-latest`.
- Windows ARM64 builds run on `windows-11-arm`.
- Each Windows release job publishes only its own target architecture instead of cross-building both architectures on one runner.
- `windows-11-arm` availability depends on the repository's GitHub Actions plan and runner entitlement; if unavailable, the release workflow must either use a self-hosted ARM64 runner or temporarily fall back to x64 cross-build plus the sharp `afterPack` guard.

---

## Dependency Management

> **Warning:** electron-builder ONLY packages `dependencies` and `optionalDependencies`. Packages in `devDependencies` are silently excluded from the production build.

**Critical incident:** Moving `playwright` to `devDependencies` (commit `7ea925e`) broke all browser automation (CDP auth, web search) in production builds while appearing to work fine in development.

**Verify after changing dependency categories:**
```bash
npx asar list <app.asar> | grep <module>
```

**Native packaging verification for `sharp@0.34+`:**
- `sharp` no longer loads Windows binaries from `sharp/build/Release`.
- Packaged builds must include the unpacked platform package under `app.asar.unpacked/node_modules/@img/`.
- For Windows ARM64, verify `app.asar.unpacked/node_modules/@img/sharp-win32-arm64/lib/sharp-win32-arm64.node` exists.
- For Windows x64, verify `app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node` exists.
- On Windows, also verify the companion DLLs in the same `lib/` directory because the `.node` binary depends on them at runtime.

| Category | Packaged? | When to use |
|----------|-----------|-------------|
| `dependencies` | Yes | Runtime modules needed by main process (e.g., `playwright-core`, `sharp`, `better-sqlite3`) |
| `optionalDependencies` | Yes | Platform-specific or on-demand native modules (e.g., `whisper-addon`, `sherpa-onnx`) |
| `devDependencies` | No | Build tools, test frameworks, webpack-bundled renderer-only modules (e.g., `mermaid`, `monaco-editor`, `@playwright/test`) |

**`playwright` vs `playwright-core`:**
- `playwright-core` → `dependencies`, ~8MB, API-only library used at runtime for CDP auth and web search
- `playwright` → `devDependencies`, ~280MB, test-runner wrapper with bundled browsers, used only by E2E tests

---

## Environment Variables

Configured via `.env.local` (copy from `.env.example`). Injected at build time via webpack `DefinePlugin`, except where noted.

| Variable | Scope | Description |
|----------|-------|-------------|
| `NODE_ENV` | Both | `development` / `production` |
| `HISTORY_PROMPT_QUEUE_SIZE` | Both | Prompt history ring buffer size (default: 20) |
| `RELEASE_CDN_URL` | Both | Custom CDN URL for auto-updates |
| `DEVELOPMENT_BASE_CDN_URL` | Both | Dev CDN for assets (default: `https://cdn.kosmos-ai.com/dev`) |
| `PRODUCTION_BASE_CDN_URL` | Both | Prod CDN for assets (default: `https://cdn.kosmos-ai.com`) |
| `PRESET_MODEL_GPT4O_*` | Both | Pre-configured Azure OpenAI GPT-4o settings (ENDPOINT, DEPLOYMENT, API_KEY, API_VERSION, MODEL_NAME) |
| `PRESET_MODEL_GPT41_*` | Both | Pre-configured Azure OpenAI GPT-4.1 settings (ENDPOINT, DEPLOYMENT, API_KEY, API_VERSION, MODEL_NAME) |
| `UNWRAP_ACCESS_TOKEN` | Both | Token unwrapping configuration |
| `ACTIVE_USER_THRESHOLD_MIN` | Main | Active user tracking threshold in minutes (default: 5) |

---

## Known Limitations

- **Python 3.10+** required for some MCP servers
- **GitHub Copilot subscription** required for the primary AI provider
- **Native module support** varies by platform (Windows / macOS / Linux)
- **Memory system** requires local sqlite-vec setup; gated by `kosmosFeatureMemory` feature flag
- **Browser control** is Windows-only; gated by `browserControl` feature flag
- **Voice input** is dev-only by default; gated by `kosmosFeatureVoiceInput` feature flag
- **Native modules** are not bundled in the installer — downloaded on demand at runtime (~127MB whisper-addon, ~13MB sherpa-onnx)
