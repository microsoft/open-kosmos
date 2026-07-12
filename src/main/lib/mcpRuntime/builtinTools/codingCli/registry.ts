/**
 * Coding CLI registry + availability detection.
 *
 * The registry maps each CodingCliId to its adapter. Availability detection resolves the binary
 * on PATH (which/where). OpenKosmos never installs or updates these CLIs; it only reports whether they
 * are present and surfaces the install hint when they are not.
 */

import { execFile } from 'child_process';
import type { CodingCliId, CodingCliAdapter, CodingCliAvailability } from './types';
import { claudeAdapter, codexAdapter, geminiAdapter, copilotAdapter } from './adapters';

const PATH_DETECTION_TIMEOUT_MS = 2000;

/**
 * Windows extensions that `spawn` can actually launch. A `where` match without one of these
 * (e.g. a bare, extension-less POSIX wrapper) is NOT directly spawnable on Windows and fails with
 * ENOENT, so it must never win over a real shim.
 */
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

export const DEFAULT_CODING_CLI_ID: CodingCliId = 'claude';

export const CODING_CLI_ADAPTERS: Record<CodingCliId, CodingCliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  copilot: copilotAdapter,
};

/** Stable display order for Settings and availability listings. */
export const CODING_CLI_ORDER: CodingCliId[] = ['claude', 'codex', 'gemini', 'copilot'];

/** Resolve an adapter, falling back to the default CLI for unknown ids. */
export function getAdapter(id: CodingCliId | undefined): CodingCliAdapter {
  if (id && CODING_CLI_ADAPTERS[id]) {
    return CODING_CLI_ADAPTERS[id];
  }
  return CODING_CLI_ADAPTERS[DEFAULT_CODING_CLI_ID];
}

/**
 * Pick the best match from `where`/`which` output.
 *
 * On POSIX, `which` returns a single already-executable path, so the first line is taken as-is.
 *
 * On Windows, `where` lists EVERY name match on PATH in PATH order, regardless of whether the file
 * is launchable. That ordering can surface, ahead of the real npm-global shim:
 *   1. an extension-less POSIX wrapper that `spawn` cannot launch (ENOENT), and/or
 *   2. an editor-bundled copy (e.g. the VS Code Copilot Chat extension ships `copilot` under
 *      `globalStorage\github.copilot-chat\copilotCli` and injects it into the integrated terminal
 *      PATH) instead of the user's standalone install.
 * We therefore (a) EXCLUDE editor-bundled copies outright — those binaries are private to the
 * editor extension, are not a supported standalone CLI, and must never be driven by OpenKosmos — and
 * (b) keep only launchable candidates (those with a Windows executable extension). When nothing
 * survives both filters we return null: spawning an extension-less POSIX wrapper fails mid-execution
 * with a cryptic "The system cannot find the file specified." ENOENT, so it is better to report the
 * CLI as unavailable and surface the install hint instead. PATH order is preserved among survivors.
 */
function pickBestCliPath(stdout: string): string | null {
  const candidates = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (candidates.length === 0) return null;
  if (process.platform !== 'win32') return candidates[0];

  const usable = candidates.filter((candidate) => {
    const lower = candidate.toLowerCase();
    // Editor-bundled copies (VS Code extension's globalStorage) are never an acceptable target.
    if (lower.includes('\\globalstorage\\')) return false;
    // Only paths with a Windows executable extension can actually be spawned.
    return WINDOWS_EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });

  // First survivor in PATH order, or null when only excluded/non-launchable matches exist.
  return usable[0] ?? null;
}

/** Resolve a binary on PATH; returns its absolute path or null when not found. */
export function detectCliPath(binaryName: string): Promise<string | null> {
  const whichCommand = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(whichCommand, [binaryName], {
      encoding: 'utf-8',
      timeout: PATH_DETECTION_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      resolve(pickBestCliPath(stdout));
    });
  });
}

/** Availability for a single CLI id. */
export async function detectAvailability(id: CodingCliId): Promise<CodingCliAvailability> {
  const adapter = getAdapter(id);
  const path = await detectCliPath(adapter.binaryName);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    binaryName: adapter.binaryName,
    installHint: adapter.installHint,
    docsUrl: adapter.docsUrl,
    available: path !== null,
    path,
  };
}

/** Availability for every supported CLI, in display order. */
export function detectAllAvailability(): Promise<CodingCliAvailability[]> {
  return Promise.all(CODING_CLI_ORDER.map((id) => detectAvailability(id)));
}
