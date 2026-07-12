import { describe, expect, it } from 'vitest';

import {
  parseArgs,
  pickFirstNonEmptyDiff,
  parseChangedFiles,
  parseFullFileRecords,
  scanRecords,
  filterBaselineFindings,
  getAddedBaselineEntries,
} from '../check-i18n.js';

describe('check-i18n', () => {
  it('parses --update-baseline', () => {
    expect(parseArgs(['--update-baseline']).updateBaseline).toBe(true);
  });

  it('prefers staged diff over PR fallback when the working tree is clean', () => {
    expect(pickFirstNonEmptyDiff('', 'staged diff', 'fallback diff')).toBe('staged diff');
  });

  it('scans full changed renderer files instead of only added lines', () => {
    const diff = [
      'diff --git a/src/renderer/components/Foo.tsx b/src/renderer/components/Foo.tsx',
      '--- a/src/renderer/components/Foo.tsx',
      '+++ b/src/renderer/components/Foo.tsx',
      '@@ -10,0 +11,1 @@',
      '+const touched = true;',
      '',
    ].join('\n');

    const files = parseChangedFiles(diff);
    const records = parseFullFileRecords(files, () => [
      'export function Foo() {',
      '  return <button>Legacy Copy</button>;',
      '}',
    ].join('\n'));

    const findings = scanRecords(records);

    expect(files).toEqual(['src/renderer/components/Foo.tsx']);
    expect(findings).toEqual([
      expect.objectContaining({
        file: 'src/renderer/components/Foo.tsx',
        lineNumber: 2,
        rule: 'hardcoded-jsx-text',
        value: 'Legacy Copy',
      }),
    ]);
  });

  it('filters findings that match the frozen baseline', () => {
    const findings = [
      {
        file: 'src/renderer/components/Foo.tsx',
        lineNumber: 2,
        rule: 'hardcoded-jsx-text',
        message: 'JSX text owned by the renderer must use t(...).',
        value: 'Legacy Copy',
        source: 'return <button>Legacy Copy</button>;',
      },
    ];

    const result = filterBaselineFindings(findings, [
      {
        file: 'src/renderer/components/Foo.tsx',
        rule: 'hardcoded-jsx-text',
        value: 'Legacy Copy',
        source: 'return <button>Legacy Copy</button>;',
      },
    ]);

    expect(result.unresolved).toEqual([]);
    expect(result.ignored).toHaveLength(1);
  });

  it('detects new baseline entries when the target branch already has a baseline', () => {
    const currentEntries = [
      {
        file: 'src/renderer/components/Foo.tsx',
        rule: 'hardcoded-jsx-text',
        value: 'Existing Copy',
        source: 'return <button>Existing Copy</button>;',
      },
      {
        file: 'src/renderer/components/Bar.tsx',
        rule: 'hardcoded-jsx-text',
        value: 'New Copy',
        source: 'return <button>New Copy</button>;',
      },
    ];

    const added = getAddedBaselineEntries(
      { baseRef: 'origin/main', headRef: 'HEAD', stagedOnly: false },
      currentEntries,
      () => JSON.stringify({
        findings: [currentEntries[0]],
      }),
    );

    expect(added).toEqual([currentEntries[1]]);
  });
});
