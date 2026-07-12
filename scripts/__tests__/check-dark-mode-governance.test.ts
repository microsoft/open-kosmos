import { describe, expect, it, vi } from 'vitest';

import {
  GIT_DIFF_MAX_BUFFER,
  collectAddedRawStatusRgbaViolations,
} from '../check-dark-mode-governance.js';

describe('check-dark-mode-governance', () => {
  it('bounds large diffs and excludes deleted files from the scan', () => {
    const oversizedAddedLine = `+// ${'x'.repeat(1024 * 1024 + 1)}`;
    const gitRunner = vi.fn(() => [
      'diff --git a/src/renderer/Foo.tsx b/src/renderer/Foo.tsx',
      '+++ b/src/renderer/Foo.tsx',
      '@@ -0,0 +1,2 @@',
      oversizedAddedLine,
      '+const color = \"rgba(245, 158, 11, 0.4)\";',
    ].join('\n'));

    const result = collectAddedRawStatusRgbaViolations(gitRunner, 'origin/main');

    expect(gitRunner).toHaveBeenCalledWith(
      'git',
      ['diff', '--diff-filter=AMR', '--unified=0', 'origin/main', '--', 'src/renderer'],
      expect.objectContaining({ maxBuffer: GIT_DIFF_MAX_BUFFER }),
    );
    expect(GIT_DIFF_MAX_BUFFER).toBeGreaterThan(1024 * 1024);
    expect(result).toEqual({
      error: null,
      violations: ['src/renderer/Foo.tsx:2'],
    });
  });

  it('reports git failures without throwing', () => {
    const result = collectAddedRawStatusRgbaViolations(
      () => {
        throw new Error('git failed');
      },
      'origin/main',
    );

    expect(result.error).toContain('git failed');
    expect(result.violations).toEqual([]);
  });
});
