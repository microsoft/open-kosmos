# Postmortem: `rolldownOptions` typo silently disabled the main-process entry, dumping userData into `%APPDATA%\Electron\`

<!-- Last verified: 2026-07-07 -->

**Date:** 2026-07-07 | **Severity:** P1 (dev builds wrote to the wrong userData root; brand identity, native externals, and a renderer entry were all silently disabled) | **Affected:** every dev launch (`npm run dev`) and every `npm run build:vite` produced since commit `e1b4219d4` "build: upgrade to Vite 8 + electron-vite 6 + TypeScript 6".

## Symptom

`npm run dev` created runtime state under `%APPDATA%\Electron\` (Windows) / `~/Library/Application Support/Electron/` (macOS) instead of the brand folder `openkosmos-app`. Every dev launch reinitialized profiles, python-venv, bun bin, logs, crashes, native-modules, etc. under the default Electron directory. The previously "correct" `openkosmos-app` directory still existed on disk but was frozen in time; the app was reading and writing nothing there.

## The intended startup contract

Main-process bootstrap is a two-stage import chain:

```ts
// src/main/bootstrap.ts (the vite entry)
import './bootstrapUserData';   // Stage 1 — MUST run first
import './main';                // Stage 2 — reads app.getPath('userData') at load time
```

`bootstrapUserData.ts` calls `app.setName(process.env.APP_NAME)` and `app.setPath('userData', appData/USER_DATA_NAME)`. Vite `define` replaces those `process.env.*` reads with the brand-config literals at build time (`"OpenKosmos"`, `"openkosmos-app"`, `"com.openkosmos-ai-studio"`). The whole module is a stack of load-bearing side effects — no exports, only calls.

## Root cause

`electron.vite.config.ts` uses `rolldownOptions` in three places:

```ts
main: { build: {
  rolldownOptions: {                                          // ← NOT a valid Vite key
    external: ['bufferutil', 'utf-8-validate', /^@nut-tree-fork\//],
    input: { main: resolve(__dirname, 'src/main/bootstrap.ts') },
    output: { chunkFileNames: '[name].js' },
  },
} },
// same typo in renderer.build for the { index, screenshot } inputs
```

**Vite has no `rolldownOptions` config key.** Even in Vite 7/8 (which uses Rolldown under the hood) the key is still `build.rollupOptions` — verified against `node_modules/vite/dist/node/index.d.ts:2023` (`rollupOptions?: RollupOptions`). Unknown top-level `build.*` keys are silently ignored, so the entire block was dead config.

With `rollupOptions.input` unset, `electron-vite` v6 fell through to `findLibEntry(root, 'main')` (`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:246`), which searches for `src/main/{index,main}.{js,ts,mjs,cjs}` and returned `src/main/main.ts`. So the actual bundled entry was `main.ts`, not `bootstrap.ts` — the two-line import chain that pins the brand userData path was never in the bundle.

Evidence in the compiled artifact:

- `dist-vite/main/main.js.map`'s `sources[]` contained no `bootstrap*` files; the first source was `src/main/main.ts`.
- The 3.4 MB `dist-vite/main/main.js` had zero occurrences of `setName`, `setPath`, `setAppUserModelId`, `readRuntimeEnv`, or the literal string `"Setting App Name"` — all of which are unique to `bootstrapUserData.ts`.

Result: Electron booted with the default app name `"Electron"` and resolved `userData` from that name.

## The origin commit

`e1b4219d4 build: upgrade to Vite 8 + electron-vite 6 + TypeScript 6 (#584)`. The diff literally reads:

```
- Rename rollupOptions → rolldownOptions for Vite 8 Rolldown backend
```

The premise is wrong. Vite kept the `rollupOptions` name for compatibility even after switching its bundler to Rolldown; there is no `rolldownOptions` API surface. Renaming a valid config key to a made-up one is indistinguishable from deleting the block, and that is exactly what happened.

## Why it wasn't caught for months

- **Zero build/runtime errors.** Both `npm run dev` and `npm run build:vite` reported success. Silent config drop + fallback entry auto-detection meant every stage still produced a runnable bundle.
- **App still worked.** The FRE ran, profiles created, chat worked — just under the wrong root. Nothing crashed; it just looked like a fresh install on every branch.
- **Local users already had a populated `openkosmos-app`.** The symptom is "your old data is gone", not a crash. Most devs assumed they wiped it manually or that a migration ran, and moved on.
- **CI never asserts brand identity.** No smoke test checks that `app.getPath('userData')` ends with `openkosmos-app` (or that the bundle contains `app.setName`).
- **Other silently-dropped configs failed quietly too.** `@nut-tree-fork/*` was supposed to be external (the config even has a paragraph-long comment explaining why bundling it breaks Computer Use's `libnut.node` loader); the renderer's `screenshot.html` entry vanished. Neither surfaced as an obvious regression until someone hit the specific broken path.

## Fix

Rename `rolldownOptions` → `rollupOptions` in both the `main` and `renderer` config blocks of `electron.vite.config.ts`. That's it — no other change needed. The preload block was already using `build.lib.entry` and was never affected.

Post-fix rebuild verified in `dist-vite/main/main.js`:

```
[Bootstrap] Setting App Name to: OpenKosmos
readRuntimeEnv("OPENKOSMOS_USER_DATA_NAME") || "openkosmos-app"
electron.app.setAppUserModelId("com.openkosmos-ai-studio")
```

And `dist-vite/main/main.js.map`'s sources now include `../../src/main/bootstrap.ts` and `../../src/main/bootstrapUserData.ts`.

## Prevention / Lessons

- **Vite `build.*` accepts unknown keys silently.** Any typo in a `build.*` config key (`rolldownOptions`, `rollupOtions`, `rolluOptions`, …) is discarded without warning. Do not trust "the build succeeded" as evidence that a config block took effect. When adding or renaming a `build.*` key, verify against `node_modules/vite/dist/node/index.d.ts` — there is exactly one legal name.
- **Don't rename config keys based on "the backend changed" folklore.** Rolldown is Vite's *internal* bundler; Vite's *public* config API deliberately kept `rollupOptions` for compatibility. Before renaming any config field during a major-version upgrade, grep the upgrade guide and the target version's `.d.ts` for the new name. If it isn't there, it doesn't exist.
- **Post-config-change, verify the bundled entry, not just that the build succeeded.** The one-line check is: `Select-String -Path dist-vite/main/main.js -Pattern 'Setting App Name' -SimpleMatch` (or grep the source map's `sources[]` for `bootstrap.ts`). Both are cheap and deterministic. Whenever `electron.vite.config.ts` changes, run this before considering the change done.
- **`bootstrapUserData` is load-bearing side-effect code with no exports and no observable failure mode when dropped.** That is the worst combination for silent regressions: nothing crashes when it's absent, the fallback just picks a different directory. Any future change to the main entry chain (renaming `bootstrap.ts`, moving `bootstrapUserData.ts`, changing the import order, or touching the Vite entry config) must be paired with the post-build assertion above.
- **CI should assert brand identity in the built bundle.** A single guard — "`dist-vite/main/main.js` must contain `app.setName(` and the string `"openkosmos-app"`" — would have caught this at PR time. This is cheap enough to run in the existing build job; adding it is tracked as follow-up.
- **When electron-vite auto-detects an entry, that is a symptom, not a feature, for this repo.** `src/main/main.ts` exists as a *stage-2* module, not the entry. If `findLibEntry` ever resolves to it, the pin has failed. Consider renaming `main.ts` (e.g. `mainStage2.ts`) so the auto-detection heuristic can't accidentally land on it — deferred as a larger refactor, but worth noting the trap.

## Related

- `electron.vite.config.ts` — the fix site (three `rolldownOptions` → `rollupOptions` renames; preload already used `lib.entry` and was unaffected)
- `src/main/bootstrap.ts` / `src/main/bootstrapUserData.ts` — the two-stage entry chain that the missing config silently disabled
- `scripts/vite/defines.ts` — `USER_DATA_NAME` / `APP_NAME` / `APP_ID` build-time defines that `bootstrapUserData.ts` reads
- `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:246` — `findLibEntry`, the auto-detection that picked `main.ts` when `rollupOptions.input` was missing
- Commit `e1b4219d4` — the origin: "Rename rollupOptions → rolldownOptions for Vite 8 Rolldown backend"
