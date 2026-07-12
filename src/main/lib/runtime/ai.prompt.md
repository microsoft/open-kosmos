<!-- Last verified: 2026-07-11 -->
# Runtime Manager

> Main-process module that provisions and manages local execution runtimes (embedded `bun` + `uv`, the two-layer Python stack, and command shims). Exposes Runtime Settings and FRE status over IPC.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `RuntimeManager.ts` | Singleton owning runtime mode (system vs internal), tool install/self-heal, shims, Python install (`installPythonVersion` + in-flight `installLocks`), venv serialization (`recreateVenv`), Git status, and all `runtime:*` IPC handlers. Allowlisted in `scripts/file-length-allowlist.json`. | ~1600 lines |
| `pythonSelfHeal.ts` | Free functions extracted from RuntimeManager (to stay under the file-length budget) for the Python self-heal logic: `ensurePinnedPythonInstalled`, `ensureVenvMatchesPinnedPython`, `venvBaseInterpreterResolves`, `ensureVenvPipAvailable`, `doRecreateVenv`. Take a `PythonSelfHealCtx` satisfied by the manager. | medium |
| `pythonPackages.ts` | Free functions for managing third-party libraries in the venv: `listPythonPackages` / `installPythonPackages` / `uninstallPythonPackage` (via `uv pip list/install/uninstall --python <venv>`), re-exported package-spec parsing, and the shared `withVenvMutationLock` used by package mutations and venv recreation. Take a `PythonPackagesCtx`. Backs the Runtime Settings "Python packages" UI. | small |
| `LocalPythonMirror.ts` | Singleton local HTTP mirror started during `uv python install` to serve/stabilize interpreter + package downloads. | ~130 lines |
| `__tests__/` | Vitest coverage; many tests reach private methods via `(manager as any).method` and `vi.spyOn(manager, ...)`. | large |

## Architecture

**Singleton services.** `RuntimeManager` and `LocalPythonMirror` follow the `private static instance` + `getInstance()` pattern used throughout the main process.

### Python runtime (app-managed / internal mode)

**Two-layer Python.** Layer-1 is the real CPython installed by `uv python install <version>` under uv's python dir (`~/.local/share/uv/python/cpython-X.Y.Z-...`, NOT under userData), discovered by `listPythonVersionsFast()`. Layer-2 is the venv shell at `{userData}/python-venv` created by `uv venv`, which symlinks back to a layer-1 interpreter. `uv pip`/`python` fail if layer-1 is missing even when the venv's `pyvenv.cfg` still reads the right version (a "dangling" venv).

**Background self-heal chain.** `initializeInternalMode()` runs fire-and-forget (never `await`ed on the sign-in critical path). After uv/bun are installed and shims refreshed, when a `pinnedPythonVersion` is configured it runs, in order: `ensurePinnedPythonInstalled(pinned)` (install layer-1 if no matching major.minor is present) → `ensureVenvMatchesPinnedPython(pinned)` (rebuild the venv if missing, version-mismatched, dangling, or missing required venv entrypoints such as `bin/python3`; then verify/repair `python -m pip`). Everything is `.catch()`-guarded and non-fatal.

**Delegation split.** `pythonSelfHeal.ts` holds the implementations as free functions taking `PythonSelfHealCtx`. RuntimeManager keeps thin `private` delegators that pass `this.selfHealCtx` (a getter exposing the private fields/methods the helpers need). Helpers call back through the ctx (e.g. `ctx.recreateVenv`, `ctx.venvBaseInterpreterResolves`) so `vi.spyOn(manager, ...)` targets and `(manager as any).method` test references keep working unchanged.

**Install de-duplication.** `installPythonVersion` registers its promise in `installLocks` SYNCHRONOUSLY before any `await` (mirror start + `uv python install` + mirror stop all live inside that one promise). This closes a check-then-set race where two concurrent callers each yielded at `await mirror.start()` before the lock was set and both spawned `uv python install`. `recreateVenv` serializes concurrent rebuilds via `_venvCreationPromise` / `_venvCreationVersion`.

**Mode transition guard.** `setRuntimeMode('internal')` only re-kicks `initializeInternalMode()` on an actual system→internal transition. Startup already inits once when persisted mode is internal; the FRE then re-issues `runtime:set-mode 'internal'` idempotently. Without the guard that second call spawned a parallel self-heal chain.

**Status IPC.** `runtime:check-status` is **FRE-only**. The settings Runtime tab uses granular `runtime:check-core` and `runtime:check-git-version` handlers so each row renders independently without blocking on the slowest probe.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change Python self-heal logic | `pythonSelfHeal.ts` (+ `RuntimeManager.ts` if the ctx shape changes) + `__tests__/RuntimeManager.pythonSelfHeal.test.ts` | Keep major.minor-only version compare; keep errors non-fatal. Helpers must call back through `ctx`, not other free functions, so spies fire. Preserve `python -m pip` availability in the app-managed venv. |
| Add a managed tool / shim | `RuntimeManager.ts` (`ensureShims`, install path) | Skip a shim when its dependency tool is absent. |
| Add a granular status row | `RuntimeManager.ts` (new `runtime:check-*` handler) + renderer settings rows | Keep `runtime:check-status` FRE-only; do not re-couple settings to it. |
| Touch venv rebuild | `pythonSelfHeal.ts` `doRecreateVenv` + `RuntimeManager.recreateVenv` | Serialization state stays on the manager; `doRecreateVenv` is the unserialized worker. |
| Manage venv packages | `pythonPackages.ts` + `RuntimeManager` delegators/IPC (`list/add/uninstall-python-package`) + `RuntimePythonPackagesRow.tsx` | Packages install into `{userData}/python-venv` (VIRTUAL_ENV target). Validate specs via the shared parser before they reach uv argv; keep package mutations and venv recreation under `withVenvMutationLock`. |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `pythonSelfHeal.ts` ctx shape | `RuntimeManager.selfHealCtx` getter + the delegator methods |

## Gotchas
- Do NOT `await` `initializeInternalMode()` (or its self-heal chain) on the sign-in/IPC critical path — it is background, fire-and-forget.
- Do NOT add an `await` between the `installLocks` get-check and set in `installPythonVersion`; that reopens the double-spawn race.
- Do NOT trust `pyvenv.cfg` `version_info` alone — a dangling venv reads the right version but is broken. Use `venvBaseInterpreterResolves()`, which must verify the active venv entrypoints (`bin/python` and `bin/python3` on Unix/macOS, `Scripts/python.exe` on Windows) and the base interpreter file.
- Venv repair commands (`uv python install`, `uv venv`) must not inherit a broken active `VIRTUAL_ENV`; clear it only for the self-heal command itself. Do not remove RuntimeManager's normal internal-mode `VIRTUAL_ENV` injection.
- `pip`/`pip3` shims route to `uv pip`, but agents often run `python -m pip`. New venvs must be created with `uv venv --seed`, and existing venvs must be repaired in place through `ensureVenvPipAvailable()` instead of deleting the venv and losing user packages. See [Postmortem: app-managed Python venv missing pip](../../../../ai.prompt/postmortem-app-managed-python-pip-unavailable.md).
- Layer-1 interpreters live under uv's python dir, NOT under `{userData}`. Deleting `{userData}/python-venv` does not remove the interpreter.
- RuntimeManager.ts is allowlisted for file length but capped at +50 net lines per PR. Prefer extracting into sibling modules (like `pythonSelfHeal.ts`) over growing the class.
- `withVenvMutationLock` is intentionally reentrant: package mutations call `ensureVenvReady()` inside the lock, and that may rebuild the venv through `RuntimeManager.recreateVenv()`. Do not replace it with a non-reentrant lock or package installs can deadlock during self-heal.
- Helpers in `pythonSelfHeal.ts` must route recursive calls through `ctx` (not call each other directly) so manager-level spies in tests still intercept them.

## Related
- Depended on by [MCP Runtime](../mcpRuntime/ai.prompt.md) and built-in tools that execute local commands.
- Drives the renderer `RuntimeSettingsContentView.tsx` / `RuntimeSystemDependencyRows.tsx` and the FRE `FreSettingUpView.tsx`.
