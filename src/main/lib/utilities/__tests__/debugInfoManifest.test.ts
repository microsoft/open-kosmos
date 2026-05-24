import { buildDebugInfoManifest } from '../debugInfoManifest';
import * as path from 'path';

describe('buildDebugInfoManifest', () => {
  it('includes crash capture status and latest bundle summary', () => {
    const manifest = buildDebugInfoManifest({
      appName: 'OpenKosmos',
      appVersion: '2.7.3',
      exportedAt: '2026-04-07T12:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      crashStatus: {
        currentSessionId: 'session-current',
        crashRootDir: '/tmp/userData/crashes',
        crashDumpsDir: '/tmp/crashDumps',
        hasRecoveredCrash: true,
        recoveredCrash: {
          eventType: 'recovered-unclean-exit',
          sessionId: 'session-current',
          previousSessionId: 'session-prev',
          detectedAt: '2026-04-07T11:00:00.000Z',
          startedAt: '2026-04-07T01:00:00.000Z',
          pid: 123,
          appVersion: '2.7.2',
          bundlePath: '/tmp/userData/crashes/20260407-110000-recovered-unclean-exit-session-current',
        },
      },
      crashBundleNames: [
        '20260407-090000-renderer-error-session-a',
        '20260407-110000-recovered-unclean-exit-session-current',
      ],
    });

    expect(manifest.crashCapture).toEqual({
      currentSessionId: 'session-current',
      crashRootDir: '/tmp/userData/crashes',
      crashDumpsDir: '/tmp/crashDumps',
      hasRecoveredCrash: true,
      recoveredCrash: expect.objectContaining({ previousSessionId: 'session-prev' }),
      latestBundle: {
        name: '20260407-110000-recovered-unclean-exit-session-current',
        path: path.join('/tmp/userData/crashes', '20260407-110000-recovered-unclean-exit-session-current'),
      },
    });
  });

  it('sets latestBundle to null when no bundles exist', () => {
    const manifest = buildDebugInfoManifest({
      appName: 'OpenKosmos',
      appVersion: '2.7.3',
      exportedAt: '2026-04-07T12:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      crashStatus: {
        currentSessionId: 'session-current',
        crashRootDir: '/tmp/userData/crashes',
        crashDumpsDir: '/tmp/crashDumps',
        hasRecoveredCrash: false,
        recoveredCrash: null,
      },
      crashBundleNames: [],
    });

    expect(manifest.crashCapture.latestBundle).toBeNull();
  });
});
