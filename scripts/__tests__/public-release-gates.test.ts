import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PATTERN_FAMILIES,
  REMOVED_PATHS,
  readArguments,
  scanContent,
} from '../check-public-release.js';
import {
  WORKSTREAMS,
  finalCommands,
  parseArguments,
  reportFor,
} from '../run-public-release-integration-gate.js';

const ROOT = path.resolve(__dirname, '../..');

describe('public release static gate', () => {
  it('parses worktree, ref, and artifact modes', () => {
    expect(readArguments([]).mode).toBe('worktree');
    expect(readArguments(['--mode', 'refs']).mode).toBe('refs');
    expect(readArguments(['--mode', 'artifacts', '--root', 'release'])).toMatchObject({
      mode: 'artifacts',
      roots: ['release'],
    });
    expect(() => readArguments(['--mode', 'artifacts'])).toThrow(
      'requires at least one --root',
    );
  });

  it('finds prohibited content and honors a reviewed exact-line exclusion', () => {
    const endpoint = ['cdn', ['kos', 'mos-ai'].join(''), 'com'].join('.');
    const content = `download from https://${endpoint}/asset`;
    const findings = scanContent('fixture.txt', content, []);
    expect(findings.some((finding: { family: string }) => (
      finding.family === 'LEGACY_CDN'
    ))).toBe(true);

    const exclusions = [{
      family: 'LEGACY_CDN',
      path: 'fixture.txt',
      lineRegex: /^download from /,
    }, {
      family: 'LEGACY_BRAND',
      path: 'fixture.txt',
      lineRegex: /^download from /,
    }];
    expect(scanContent('fixture.txt', content, exclusions)).toEqual([]);
  });

  it('keeps pattern-family identifiers unique', () => {
    const ids = PATTERN_FAMILIES.map((family: { id: string }) => family.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prevents the retired public IndexedDB test harness from returning', () => {
    expect(REMOVED_PATHS).toContain('public/indexeddb-test.html');
  });

  it('accepts OpenKosmos identity without accepting the retired standalone brand', () => {
    expect(scanContent('fixture.txt', 'OpenKosmos openkosmos-app open-kosmos', [])).toEqual([]);
    const retiredName = ['Kos', 'mos'].join('');
    expect(scanContent('fixture.txt', `retired ${retiredName} identity`, [])).toEqual([
      expect.objectContaining({ family: 'LEGACY_BRAND' }),
    ]);
  });

  it('detects retired Doctor product contracts without flagging benign language', () => {
    const runtimeFindings = scanContent(
      'src/example.ts',
      "ipcMain.handle('doctor:getStatus', () => DoctorManager.getStatus())",
      [],
    );
    expect(runtimeFindings.length).toBeGreaterThanOrEqual(1);
    expect(runtimeFindings.every(({ family }: { family: string }) => family === 'DOCTOR')).toBe(true);

    const issueFindings = scanContent(
      'src/example.ts',
      "await fetch('/github/issue-token'); create_github_issue(payload);",
      [],
    );
    expect(issueFindings).toHaveLength(2);
    expect(issueFindings.every(({ family }: { family: string }) => family === 'DOCTOR')).toBe(true);
    expect(scanContent(
      'fixture.txt',
      'The doctor reviewed the diagnostics report before publication.',
      [],
    )).toEqual([]);
  });

  it('detects retired analytics controls without flagging generic usage analytics', () => {
    const retiredControl = ['DISABLE', 'ANALYTICS'].join('_');
    expect(scanContent('fixture.yml', `${retiredControl}: 'true'`, [])).toEqual([
      expect.objectContaining({ family: 'AZURE_HOSTED' }),
    ]);
    expect(scanContent('fixture.txt', 'Usage analytics are computed locally.', [])).toEqual([]);
  });

  it('allows only the explicit user-data migration compatibility paths', () => {
    const line = `const LEGACY_USER_DATA_NAME = '${['kosmos', 'app'].join('-')}';`;
    expect(scanContent('src/main/bootstrapUserData.ts', line, [])).toEqual([]);
    expect(scanContent('src/example.ts', line, [])).toEqual([
      expect.objectContaining({ family: 'LEGACY_BRAND' }),
    ]);
  });

  it('allows Microsoft contact emails and inert persisted metadata', () => {
    expect(scanContent('src/example.ts', 'Contact: owner@microsoft.com', [])).toEqual([]);
    expect(scanContent(
      'src/main/lib/userDataADO/profileSanitizer.ts',
      "source: value.source === 'IN-LIBRARY' ? 'IN-LIBRARY' : 'ON-DEVICE'",
      [],
    )).toEqual([]);
    expect(scanContent('src/example.ts', "fetchLibrary('IN-LIBRARY')", [])).toEqual([
      expect.objectContaining({ family: 'REMOTE_LIBRARY' }),
    ]);
  });

  it('allows obvious synthetic credential fixtures without accepting realistic secrets', () => {
    expect(scanContent(
      'src/example/__tests__/fixture.test.ts',
      "accessToken: 'provider-token'",
      [],
    )).toEqual([]);
    expect(scanContent(
      'src/example/__tests__/fixture.test.ts',
      "accessToken: 'ghp_1234567890abcdef1234567890abcdef'",
      [],
    )).toEqual([
      expect.objectContaining({ family: 'SECRET_MATERIAL' }),
    ]);
  });

  it('allows only compiled equivalents of reviewed compatibility and third-party worker text', () => {
    expect(scanContent(
      'dist-vite/main/main.js',
      'if (storedMigrationVersion < 7) delete profileCopy.remoteChannels;',
      [],
    )).toEqual([]);
    expect(scanContent(
      'dist-vite/renderer/assets/editor.worker-hash.js',
      'this._remoteChannels = new Map();',
      [],
    )).toEqual([]);
    expect(scanContent(
      'release/app-asar-audit/dist/main/main.js',
      'if (storedMigrationVersion < 7) delete profileCopy.remoteChannels;',
      [],
    )).toEqual([]);
    expect(scanContent(
      'release/app-asar-audit/node_modules/example/README.md',
      "clientSecret: 'example-secret'",
      [],
    )).toEqual([]);
    expect(scanContent(
      'dist-vite/renderer/assets/product.js',
      'connect(profile.remoteChannels);',
      [],
    )).toEqual([
      expect.objectContaining({ family: 'REMOTE_CHANNEL' }),
    ]);
  });
});

describe('OSR evidence mapping', () => {
  it('covers every OSR checkbox exactly once', () => {
    const record = fs.readFileSync(
      path.join(ROOT, 'docs/open-source-release-cleanup.md'),
      'utf8',
    );
    const matrix = record
      .split('### Dependency-aware merge ledger')[0]
      .split('| Checkbox IDs |')[1];
    const ranges = [...matrix.matchAll(
      /`OSR-(\d{3})(?:\.\.(?:OSR-)?(\d{3}))?`/g,
    )].map((match) => [
      Number(match[1]),
      Number(match[2] ?? match[1]),
    ]);
    const counts = new Map<number, number>();
    for (const [start, end] of ranges) {
      for (let id = start; id <= end; id += 1) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    expect([...Array(134)].map((_, index) => counts.get(index + 1))).toEqual(
      Array(134).fill(1),
    );
  });

  it('uses unique, dependency-ordered stable evidence IDs', () => {
    const workstreams = Object.values(WORKSTREAMS) as Array<{
      evidenceId: string;
      order: number;
    }>;
    expect(new Set(workstreams.map(({ evidenceId }) => evidenceId)).size).toBe(
      workstreams.length,
    );
    expect(workstreams.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('integration evidence harness', () => {
  it('requires a known workstream', () => {
    expect(() => parseArguments([])).toThrow('--workstream must be one of');
    expect(parseArguments(['--workstream', 'tenant']).workstream).toBe('tenant');
  });

  it('adds E2E and artifact checks only when explicitly requested', () => {
    const withoutOptional = finalCommands('origin/main', 'HEAD', ['README.md'], {
      includeE2e: false,
      includeArtifacts: false,
    });
    const withOptional = finalCommands('origin/main', 'HEAD', ['README.md'], {
      includeE2e: true,
      includeArtifacts: true,
    });
    const names = (commands: Array<{ name: string }>) => (
      commands.map(({ name }) => name)
    );

    expect(names(withoutOptional)).not.toContain('Retained Electron E2E suite');
    expect(names(withOptional)).toEqual(expect.arrayContaining([
      'Retained Electron E2E suite',
      'Unpacked application artifact',
      'Artifact content audit',
    ]));
  });

  it('renders the stable evidence ID and command status', () => {
    const report = reportFor({
      workstream: WORKSTREAMS.tenant,
      base: 'before',
      head: 'after',
      files: ['src/example.ts'],
      dryRun: false,
      results: [{
        name: 'Example check',
        label: 'npm test',
        status: 'PASS',
        durationMs: 12,
        output: 'passed',
      }],
    });

    expect(report.failed).toBe(false);
    expect(report.content).toContain('EV-INT-01-TENANT');
    expect(report.content).toContain('`before..after`');
    expect(report.content).toContain('| Example check | `npm test` | PASS |');
  });
});
