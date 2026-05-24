import * as path from 'path';

interface RecoveredCrashInfo {
  eventType: 'recovered-unclean-exit';
  sessionId: string;
  previousSessionId: string;
  detectedAt: string;
  startedAt: string;
  pid: number;
  appVersion: string;
  bundlePath: string;
}

export interface DebugInfoCrashStatus {
  currentSessionId: string;
  crashRootDir: string;
  crashDumpsDir: string;
  hasRecoveredCrash: boolean;
  recoveredCrash: RecoveredCrashInfo | null;
}

export interface DebugInfoManifest {
  appName: string;
  appVersion: string;
  exportedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  crashCapture: {
    currentSessionId: string;
    crashRootDir: string;
    crashDumpsDir: string;
    hasRecoveredCrash: boolean;
    recoveredCrash: RecoveredCrashInfo | null;
    latestBundle: {
      name: string;
      path: string;
    } | null;
  };
}

export function buildDebugInfoManifest(input: {
  appName: string;
  appVersion: string;
  exportedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  crashStatus: DebugInfoCrashStatus;
  crashBundleNames: string[];
}): DebugInfoManifest {
  const latestBundleName = [...input.crashBundleNames].sort().at(-1) ?? null;

  return {
    appName: input.appName,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    platform: input.platform,
    arch: input.arch,
    crashCapture: {
      currentSessionId: input.crashStatus.currentSessionId,
      crashRootDir: input.crashStatus.crashRootDir,
      crashDumpsDir: input.crashStatus.crashDumpsDir,
      hasRecoveredCrash: input.crashStatus.hasRecoveredCrash,
      recoveredCrash: input.crashStatus.recoveredCrash,
      latestBundle: latestBundleName
        ? {
            name: latestBundleName,
            path: path.join(input.crashStatus.crashRootDir, latestBundleName),
          }
        : null,
    },
  };
}