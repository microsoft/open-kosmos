/**
 * getCrashStatusTool — L1 crash overview.
 *
 * Returns whether the previous run died unclean, plus a compact list of recent crash bundles
 * and native minidumps. The bundles' inner contents are NOT read here — the agent calls
 * read_crash_bundle on the most relevant one.
 *
 * Intentionally does not duplicate fields already in get_app_info (version/platform/arch/etc).
 */

import * as fs from 'fs';
import * as path from 'path';
import { crashCaptureManager } from '../../crash/CrashCaptureManager';

export const getCrashStatusToolDef = {
  type: 'function' as const,
  function: {
    name: 'get_crash_status',
    description: `Return crash-capture status for this machine: whether the previous launch ended unclean, a list of up to 10 most recent crash bundles (name + eventType + capturedAt + appVersion + size), and a list of up to 10 most recent native minidumps (binary; metadata only — Doctor cannot read them). Cheap; always call this once during the Collect phase. When hasRecoveredCrash is true OR a recentBundle matches the bug timeline, follow up with read_crash_bundle on the most relevant bundle.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const MAX_BUNDLES = 10;
const MAX_MINIDUMPS = 10;

interface BundleSummary {
  name: string;
  eventType?: string;
  capturedAt?: string;
  appVersion?: string;
  previousSessionId?: string;
  totalSizeBytes: number;
  mtime: string;
}

interface MinidumpSummary {
  name: string;
  sizeBytes: number;
  mtime: string;
}

export async function executeGetCrashStatus(): Promise<string> {
  const status = crashCaptureManager.getStatus();

  const recentBundles = listRecentBundles(status.crashRootDir);
  const minidumps = listMinidumps(status.crashDumpsDir);

  // Trim recoveredCrash to the fields useful to the LLM (skip absolute paths).
  const recoveredCrashSummary = status.recoveredCrash
    ? {
        previousSessionId: status.recoveredCrash.previousSessionId,
        startedAt: status.recoveredCrash.startedAt,
        appVersion: status.recoveredCrash.appVersion,
        bundleName: path.basename(status.recoveredCrash.bundlePath),
      }
    : null;

  const result: Record<string, unknown> = {
    hasRecoveredCrash: status.hasRecoveredCrash,
    recoveredCrash: recoveredCrashSummary,
    recentBundles,
    minidumps,
  };

  if (minidumps.length > 0) {
    result.minidumpsNote =
      'Native crash dumps are binary; their existence is a strong signal of a low-level crash, ' +
      'but Doctor cannot read their contents. Surface them in the Issue and ask developers to inspect locally.';
  }

  if (recentBundles.length === 0 && minidumps.length === 0 && !status.hasRecoveredCrash) {
    result.summary = 'No crash artifacts detected on this machine.';
  }

  return JSON.stringify(result, null, 2);
}

function listRecentBundles(crashRootDir: string): BundleSummary[] {
  if (!crashRootDir || !fs.existsSync(crashRootDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(crashRootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Bundle dir names start with a sortable timestamp token (YYYYMMDD-HHMMSS-mmm-...),
  // so sorting descending by name gives newest first without an extra stat() call.
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, MAX_BUNDLES);

  const summaries: BundleSummary[] = [];
  for (const name of dirs) {
    const dirPath = path.join(crashRootDir, name);
    summaries.push(summarizeBundle(name, dirPath));
  }
  return summaries;
}

function summarizeBundle(name: string, dirPath: string): BundleSummary {
  const summary: BundleSummary = {
    name,
    totalSizeBytes: 0,
    mtime: '',
  };

  try {
    const stat = fs.statSync(dirPath);
    summary.mtime = stat.mtime.toISOString();
  } catch {
    // leave defaults
  }

  // Total bundle size = sum of all file sizes within (one level deep is enough — the bundle
  // layout is shallow). Done with a try-block per file so a single permission error doesn't kill the summary.
  try {
    summary.totalSizeBytes = sumDirectorySize(dirPath);
  } catch {
    // ignore
  }

  // manifest.json — top-level capture metadata
  const manifest = readJsonSafe<{
    eventType?: string;
    appVersion?: string;
    capturedAt?: string;
  }>(path.join(dirPath, 'manifest.json'));
  if (manifest) {
    summary.eventType = manifest.eventType;
    summary.appVersion = manifest.appVersion;
    summary.capturedAt = manifest.capturedAt;
  }

  // recovered-unclean-exit bundles also have recovered-crash.json carrying the previous sessionId.
  const recovered = readJsonSafe<{ previousSessionId?: string; startedAt?: string }>(
    path.join(dirPath, 'recovered-crash.json'),
  );
  if (recovered?.previousSessionId) {
    summary.previousSessionId = recovered.previousSessionId;
  }

  return summary;
}

function sumDirectorySize(dirPath: string): number {
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const child = path.join(dirPath, e.name);
    try {
      if (e.isDirectory()) {
        total += sumDirectorySize(child);
      } else if (e.isFile()) {
        total += fs.statSync(child).size;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return total;
}

function listMinidumps(crashDumpsDir: string): MinidumpSummary[] {
  // Electron's crashDumps path actually contains a "completed" subdir with the .dmp files on macOS/Linux,
  // and varies by platform. To stay robust, search up to two levels deep for any *.dmp.
  if (!crashDumpsDir || !fs.existsSync(crashDumpsDir)) return [];

  const found: MinidumpSummary[] = [];
  collectDumps(crashDumpsDir, found, 2);
  return found
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, MAX_MINIDUMPS);
}

function collectDumps(dir: string, out: MinidumpSummary[], depthRemaining: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depthRemaining > 0) collectDumps(full, out, depthRemaining - 1);
      continue;
    }
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.dmp')) continue;
    try {
      const stat = fs.statSync(full);
      out.push({ name: e.name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() });
    } catch {
      // skip
    }
  }
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
