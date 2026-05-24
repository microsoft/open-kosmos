# Crash Bundle

## Purpose

Crash bundles live under `{userData}/crashes/` and are meant to preserve enough evidence to diagnose:

- renderer exceptions
- renderer process exits
- child process exits
- main-process uncaught exceptions
- recovered unclean exits detected on next launch

The goal is not full forensic capture. The goal is to keep the smallest artifact set that still answers: what crashed, what session it belonged to, what the app looked like right before failure, and whether Electron emitted a dump file.

## Bundle Layout

Every bundle now contains:

- `manifest.json`: top-level metadata for the capture
- `event.json` or `recovered-crash.json`: event-specific payload
- `system.json`: machine and process snapshot, including `crashDumpsDir`
- `breadcrumbs.json`: in-memory breadcrumbs recorded before capture
- `recent-main.log`: tail of the newest main log file
- `attachments.json`: manifest of copied attachments and whether each copy succeeded
- `README.txt`: quick guide to the bundle contents
- `state/current-run.json`: current session marker as of capture time

Recovered unclean-exit bundles also include:

- `previous-run.json`: the recovered previous session marker
- `state/previous-current-run.json`: raw previous run marker copied from `state/current-run.json`

Attachment directories:

- `recent-logs/`: tail samples of the newest log files under `{userData}/logs/`
- `crash-dumps/`: recent dump files copied from Electron `app.getPath('crashDumps')` when available and within capture limits

## Capture Rules

- Recent logs: copy the newest 3 log files, tailing up to 400 lines each.
- Crash dumps: copy up to 3 recent dump files.
- Large attachments are skipped instead of truncating binary files; the skip reason is recorded in `attachments.json`.
- Recovered unclean-exit bundles use the previous session `startedAt` as the lower bound when selecting recent crash dumps.

## Limitations

- A recovered unclean-exit bundle still cannot prove the exact kill reason for `SIGKILL`, Force Quit, power loss, or OS restart.
- Crashpad dumps may still be absent if Chromium did not emit one.
- Only the newest log samples are copied; full logs remain in the original `{userData}/logs/` directory.

## Verification

Unit coverage lives in `src/main/lib/crash/__tests__/CrashCaptureManager.test.ts`.

## Debug Info Export

The debug info zip export also includes `{userData}/state/current-run.json` at `state/current-run.json`, so recovered unclean-exit investigations still have the raw run marker even when no crash bundle was captured for the active session.