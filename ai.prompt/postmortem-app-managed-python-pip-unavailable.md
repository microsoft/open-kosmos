# Postmortem: app-managed Python venv missing pip breaks `python -m pip`

<!-- Last verified: 2026-07-05 -->

**Date:** 2026-07-05 | **Severity:** P2 (recoverable task failure and poor agent UX) | **Affected:** App-managed runtime sessions where the model runs `python3 -m pip install ...` against `{userData}/python-venv`.

## Symptom

A user asked the agent to generate a graph of the third roots of unity. The task eventually succeeded, but the tool chain first hit:

```text
/Users/.../openkosmos-app/python-venv/bin/python3: No module named pip
```

The session showed this sequence:

1. `python3 -c "import matplotlib, numpy; ..."` failed because `matplotlib` was missing.
2. The agent tried `python3 -m pip install matplotlib numpy --quiet`.
3. The app-managed venv Python reported `No module named pip`.
4. The agent ran `python3 -m ensurepip --upgrade`, which installed `pip` and `setuptools`.
5. A second `python3 -m pip install ...` succeeded, and the graph was generated.

The result was technically successful, but the experience looked like a hang/failure in the middle of a simple task.

## Root cause

The app-managed runtime intentionally exposes Python through shims:

| Command | Shim target |
|---|---|
| `python` / `python3` | `uv run python ...` |
| `pip` / `pip3` | `uv pip ...` |

Runtime Settings package management already uses the robust path:

```text
uv pip install <packages> --python {userData}/python-venv/bin/python
```

However, the model naturally chose the common Python idiom:

```text
python3 -m pip install matplotlib numpy
```

That path bypassed the `pip` shim and asked the venv interpreter to import the `pip` module directly. The venv had been created by `uv venv --python ...` without `--seed`, so the interpreter existed but `pip` was not installed inside it.

This was a second entry point for the same class of issue that app-managed Python package management partially solved: package installation must target the app-managed venv consistently, and agent-authored shell commands can still take unsupported legacy routes unless the runtime hardens them.

## Contributing factors

- The venv health check validated the Python entrypoints and base interpreter, but did not validate `python -m pip`.
- New venv creation did not request pip seeding.
- Runtime Settings used `uv pip --python <venv>` correctly, but `execute_command` did not preflight or repair app-managed Python commands.
- The tool description did not explicitly steer models away from `python -m pip` / `ensurepip`.

## Fix

The fix has three layers:

1. **Seed new venvs:** `doRecreateVenv()` now runs `uv venv --seed --python <version> <venvPath>`, so new or rebuilt venvs include importable pip.
2. **Repair existing venvs non-destructively:** `ensureVenvMatchesPinnedPython()` verifies `python -m pip --version` after confirming the venv is otherwise healthy. If pip is missing, it repairs in place with `uv pip install pip setuptools wheel --python <venvPython>`. This preserves already-installed user packages.
3. **Recover shell commands:** `execute_command` waits for app-managed shims before Python/pip commands in internal mode. If a foreground Python/pip command returns `No module named pip`, the tool asks `RuntimeManager.ensurePythonPipAvailable()` to repair the venv once, then retries the original command exactly once.

The model-facing command guidance now says to prefer `pip install ...` or `uv pip install ...` in app-managed runtime and not to use `python -m pip` / `ensurepip` as the first attempt.

## Prevention / lessons

- **A shim is not the same as the module behind it.** Supporting `pip` as a command does not imply `python -m pip` works unless the venv is seeded or repaired.
- **Health checks must match model behavior, not only product UI behavior.** The Settings UI used the correct `uv pip --python` path, but chat agents use common shell idioms from training data.
- **Repair existing state in place.** Recreating `{userData}/python-venv` would remove user-installed packages. Missing pip should be repaired with `uv pip` against the existing interpreter.
- **Retry once, never loop.** Automatic command recovery should handle the known transient state and then stop; repeated hidden retries make real failures harder to diagnose.

## Related

- [Runtime Manager](../src/main/lib/runtime/ai.prompt.md) — app-managed Python self-heal and package-management invariants.
- [Built-in Tools](../src/main/lib/mcpRuntime/builtinTools/ai.prompt.md) — `execute_command` app-managed Python preflight and missing-pip retry behavior.
- `src/main/lib/runtime/pythonSelfHeal.ts` — venv seeding and pip repair.
- `src/main/lib/mcpRuntime/builtinTools/executeCommandTool.ts` — command preflight and retry-once recovery.
