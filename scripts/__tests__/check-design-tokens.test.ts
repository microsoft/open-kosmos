import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  normalizePath,
  isTestFile,
  isSanctionedRegistryCss,
  isSsotDefinitionCss,
  isSanctionedTsxRegion,
  countHexInText,
  countCssHexLiterals,
  countCssBorderRadiusLiterals,
  collectCssCustomPropertyDefinitions,
  countUndefinedCssVariableRefsInTexts,
  countRawStatusClassesInText,
  countRawBrandClassesInText,
  countRawBrandRgbColorsInText,
  countCssRawBrandRgbColors,
  collectCounts,
  evaluate,
  evaluateBaselineRatchet,
  buildMarkdownReport,
  parseArgs,
  readBaseline,
  ratchetBaseline,
  statusIcon,
  formatDelta,
  METRICS
} from '../check-design-tokens.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-gate-'));
  tmpDirs.push(dir);
  return dir;
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('a\\b\\c')).toBe('a/b/c');
  });
  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('a/b/c')).toBe('a/b/c');
  });
});

describe('isTestFile', () => {
  it('matches .test and .spec files', () => {
    expect(isTestFile('foo.test.ts')).toBe(true);
    expect(isTestFile('foo.spec.tsx')).toBe(true);
    expect(isTestFile('foo.test.jsx')).toBe(true);
  });
  it('does not match normal files', () => {
    expect(isTestFile('foo.ts')).toBe(false);
    expect(isTestFile('testing.ts')).toBe(false);
  });
});

describe('countHexInText', () => {
  it('counts 3/4/6/8-digit hex colors', () => {
    expect(countHexInText('#abc #abcd #aabbcc #aabbccdd')).toBe(4);
  });
  it('returns 0 when there are no hex colors', () => {
    expect(countHexInText('const x = 1; // plain text')).toBe(0);
  });
  it('does not double-count an 8-digit hex as a shorter one', () => {
    expect(countHexInText('#11223344')).toBe(1);
  });
  it('ignores 5-digit runs that are not valid colors', () => {
    expect(countHexInText('#12345')).toBe(0);
  });
  it('counts repeated occurrences (no stale lastIndex)', () => {
    expect(countHexInText('#fff #fff #fff')).toBe(3);
    expect(countHexInText('#fff #fff #fff')).toBe(3);
  });
  it('excludes HTML numeric character entities (not color literals)', () => {
    expect(countHexInText("str.replace(/'/g, '&#039;')")).toBe(0);
    expect(countHexInText('&#160;&#8217;')).toBe(0);
  });
  it('still counts a real hex adjacent to an entity', () => {
    expect(countHexInText('&#039; color: #abcdef')).toBe(1);
  });
});

describe('countCssBorderRadiusLiterals', () => {
  it('counts raw px and rem border-radius literals', () => {
    expect(countCssBorderRadiusLiterals('.a{border-radius:8px}')).toBe(1);
    expect(countCssBorderRadiusLiterals('.a{border-radius:0.5rem}')).toBe(1);
  });
  it('counts each raw part of a multi-corner shorthand', () => {
    expect(countCssBorderRadiusLiterals('.a{border-radius:8px 8px 0 0}')).toBe(2);
    expect(countCssBorderRadiusLiterals('.a{border-radius:12px 4px 12px 4px}')).toBe(4);
  });
  it('counts corner longhand and vendor-prefixed properties', () => {
    expect(countCssBorderRadiusLiterals('.a{border-bottom-right-radius:4px}')).toBe(1);
    expect(countCssBorderRadiusLiterals('.a{border-top-left-radius:12px}')).toBe(1);
    expect(countCssBorderRadiusLiterals('.a{-webkit-border-radius:6px}')).toBe(1);
  });
  it('ignores var(), 0, and geometric % values', () => {
    expect(countCssBorderRadiusLiterals('.a{border-radius:var(--radius-lg)}')).toBe(0);
    expect(countCssBorderRadiusLiterals('.a{border-radius:0}')).toBe(0);
    expect(countCssBorderRadiusLiterals('.a{border-radius:50%}')).toBe(0);
    expect(countCssBorderRadiusLiterals('.a{border-radius:9999px}')).not.toBe(0);
  });
  it('ignores calc() that wraps a radius token', () => {
    expect(
      countCssBorderRadiusLiterals('.a{border-radius:calc(var(--radius-md) / var(--mac-zoom-factor,1))}')
    ).toBe(0);
  });
  it('does not count border-radius values documented inside CSS comments', () => {
    expect(countCssBorderRadiusLiterals('/* spec: border-radius: 12px */\n.a{border-radius:var(--radius-xl)}')).toBe(0);
  });
  it('does not count --radius-* token DEFINITIONS', () => {
    expect(countCssBorderRadiusLiterals(':root{--radius-bubble:20px;--radius-card-xl:36px}')).toBe(0);
  });
});

describe('undefined CSS var() references', () => {
  it('collects custom-property definitions outside comments', () => {
    expect(
      Array.from(
        collectCssCustomPropertyDefinitions(
          ':root{--color-surface-default:#fff}\n/* --missing:#000 */\n.card{--local-token: red;}'
        )
      ).sort()
    ).toEqual(['--color-surface-default', '--local-token']);
  });

  it('counts unresolved var() references without fallbacks', () => {
    expect(
      countUndefinedCssVariableRefsInTexts([
        ':root{--color-surface-default:#fff}.a{color:var(--color-surface-default)}',
        '.b{border-color:var(--color-border-focus)}'
      ])
    ).toBe(1);
  });

  it('allows explicit fallbacks and ignores comments', () => {
    expect(
      countUndefinedCssVariableRefsInTexts([
        '/* .a{color:var(--comment-token)} */ .b{color:var(--missing-token, currentColor)}'
      ])
    ).toBe(0);
  });
});

describe('countRawStatusClassesInText', () => {
  it('counts raw red/green/amber utility classes', () => {
    expect(
      countRawStatusClassesInText('bg-red-600 text-green-500 border-amber-400')
    ).toBe(3);
  });
  it('counts raw yellow utility classes (routes to warning; tracked since Phase 30)', () => {
    expect(
      countRawStatusClassesInText('bg-yellow-50 text-yellow-700 hover:bg-yellow-100')
    ).toBe(3);
  });
  it('matches variant-prefixed classes (hover:, dark:, etc.)', () => {
    expect(countRawStatusClassesInText('hover:bg-red-700 dark:text-green-300')).toBe(2);
  });
  it('matches many utility properties', () => {
    expect(
      countRawStatusClassesInText('ring-red-500 from-green-200 divide-amber-100 fill-red-900')
    ).toBe(4);
  });
  it('ignores tokenized status classes (danger/success/warning)', () => {
    expect(
      countRawStatusClassesInText('bg-danger-600 text-success-500 border-warning-400')
    ).toBe(0);
  });
  it('ignores hues without a status mapping (emerald/rose/blue)', () => {
    expect(
      countRawStatusClassesInText('text-emerald-500 bg-rose-400 text-blue-600')
    ).toBe(0);
  });
  it('returns 0 when there are no status classes', () => {
    expect(countRawStatusClassesInText('flex items-center gap-2')).toBe(0);
  });
  it('counts repeated occurrences (no stale lastIndex)', () => {
    expect(countRawStatusClassesInText('bg-red-600 bg-red-600')).toBe(2);
    expect(countRawStatusClassesInText('bg-red-600 bg-red-600')).toBe(2);
  });
  it('matches directional border-color longhands and ring-offset (closes the Iteration-4 gap)', () => {
    expect(
      countRawStatusClassesInText(
        'border-l-red-500 border-t-green-600 border-x-amber-400 border-e-red-300 ring-offset-yellow-200'
      )
    ).toBe(5);
  });
  it('does not match width-only border/ring utilities that carry no color', () => {
    expect(countRawStatusClassesInText('border-l-2 border-t-4 ring-offset-2 border-2')).toBe(0);
  });
});

describe('countRawBrandClassesInText', () => {
  it('counts raw blue/sky utility classes', () => {
    expect(countRawBrandClassesInText('bg-blue-600 text-sky-500 border-blue-400')).toBe(3);
  });
  it('matches variant-prefixed classes (hover:, dark:, etc.)', () => {
    expect(countRawBrandClassesInText('hover:bg-blue-700 dark:text-sky-300')).toBe(2);
  });
  it('matches many utility properties', () => {
    expect(
      countRawBrandClassesInText('ring-blue-500 from-sky-200 divide-blue-100 fill-sky-900')
    ).toBe(4);
  });
  it('ignores the tokenized brand class (primary)', () => {
    expect(
      countRawBrandClassesInText('bg-primary-600 text-primary-500 border-primary-400')
    ).toBe(0);
  });
  it('ignores unrelated hues (indigo/cyan/slate/red)', () => {
    expect(
      countRawBrandClassesInText('bg-indigo-600 text-cyan-500 bg-slate-400 text-red-600')
    ).toBe(0);
  });
  it('returns 0 when there are no brand classes', () => {
    expect(countRawBrandClassesInText('flex items-center gap-2')).toBe(0);
  });
  it('counts repeated occurrences (no stale lastIndex)', () => {
    expect(countRawBrandClassesInText('bg-blue-600 bg-blue-600')).toBe(2);
    expect(countRawBrandClassesInText('bg-blue-600 bg-blue-600')).toBe(2);
  });
  it('matches directional border-color longhands and ring-offset (closes the Iteration-4 gap)', () => {
    expect(
      countRawBrandClassesInText(
        'border-r-blue-500 border-b-sky-600 border-y-blue-400 border-s-sky-300 ring-offset-blue-100'
      )
    ).toBe(5);
  });
});

describe('countRawBrandRgbColorsInText', () => {
  it('counts raw Tailwind blue and sky RGB(A) function literals', () => {
    expect(
      countRawBrandRgbColorsInText(
        'rgba(59, 130, 246, 0.1) rgb(37, 99, 235) rgba(14, 165, 233, 0.2) rgb(2, 132, 199)'
      )
    ).toBe(4);
  });

  it('counts blue/sky 300 and 400 RGB(A) steps', () => {
    expect(
      countRawBrandRgbColorsInText(
        'rgba(96, 165, 250, 0.5) rgb(147, 197, 253) rgba(56, 189, 248, 0.5) rgb(125, 211, 252)'
      )
    ).toBe(4);
  });

  it('counts modern rgb() space/slash syntax for raw brand channels', () => {
    expect(
      countRawBrandRgbColorsInText('rgb(59 130 246 / 0.1) rgb(14 165 233 / 30%) rgb(2 132 199)')
    ).toBe(3);
  });

  it('still counts raw brand channels when only the alpha is tokenized', () => {
    expect(countRawBrandRgbColorsInText('rgb(14 165 233 / var(--alpha))')).toBe(1);
  });

  it('ignores tokenized channel variables and unrelated RGB(A) colors', () => {
    expect(
      countRawBrandRgbColorsInText(
        'rgb(var(--color-accent-rgb) / 0.1) rgba(16, 185, 129, 0.1) rgb(39, 35, 32)'
      )
    ).toBe(0);
  });
});

describe('countCssRawBrandRgbColors', () => {
  it('skips SSOT custom-property definition lines but counts usage lines', () => {
    expect(
      countCssRawBrandRgbColors(
        'src/renderer/styles/globals.css',
        [
          '  --color-accent-ring: rgba(14, 165, 233, 0.1);',
          '  .focus { box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }'
        ].join('\n')
      )
    ).toBe(1);
  });
});

describe('formatDelta', () => {
  it('formats positive, negative and zero deltas', () => {
    expect(formatDelta(5)).toBe('+5');
    expect(formatDelta(-3)).toBe('-3');
    expect(formatDelta(0)).toBe('0');
  });
});

describe('statusIcon', () => {
  it('maps statuses to icons', () => {
    expect(statusIcon('fail')).toBe('🔴');
    expect(statusIcon('improved')).toBe('✅');
    expect(statusIcon('ok')).toBe('🟢');
  });
});

describe('evaluate', () => {
  it('flags a metric above baseline as fail', () => {
    const result = evaluate(
      { hardcodedHexLiterals: 730, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    expect(result.failed).toBe(true);
    expect(result.improved).toBe(false);
    const hex = result.metrics.find(m => m.key === 'hardcodedHexLiterals');
    expect(hex?.status).toBe('fail');
    expect(hex?.delta).toBe(1);
  });

  it('flags a metric below baseline as improved (not failed)', () => {
    const result = evaluate(
      { hardcodedHexLiterals: 700, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    expect(result.failed).toBe(false);
    expect(result.improved).toBe(true);
    expect(result.metrics.find(m => m.key === 'hardcodedHexLiterals')?.status).toBe('improved');
  });

  it('reports ok when current equals baseline', () => {
    const result = evaluate(
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    expect(result.failed).toBe(false);
    expect(result.improved).toBe(false);
    expect(result.metrics.every(m => m.status === 'ok')).toBe(true);
  });

  it('treats missing keys as zero', () => {
    const result = evaluate({}, {});
    expect(result.failed).toBe(false);
    expect(result.metrics).toHaveLength(METRICS.length);
    expect(result.metrics.every(m => m.current === 0 && m.baseline === 0)).toBe(true);
  });
});

describe('evaluateBaselineRatchet', () => {
  it('fails when a PR baseline is raised above the base branch baseline', () => {
    const result = evaluateBaselineRatchet(
      { hardcodedHexLiterals: 1, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 0, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    expect(result.failed).toBe(true);
    const hex = result.metrics.find(m => m.key === 'hardcodedHexLiterals');
    expect(hex?.status).toBe('fail');
    expect(hex?.delta).toBe(1);
  });

  it('allows a PR baseline to ratchet down from the base branch baseline', () => {
    const result = evaluateBaselineRatchet(
      { hardcodedHexLiterals: 0, rendererCssFiles: 68, uiDirectoryCssFiles: 0 },
      { hardcodedHexLiterals: 0, rendererCssFiles: 73, uiDirectoryCssFiles: 0 }
    );
    expect(result.failed).toBe(false);
    expect(result.improved).toBe(true);
    const cssFiles = result.metrics.find(m => m.key === 'rendererCssFiles');
    expect(cssFiles?.status).toBe('improved');
    expect(cssFiles?.delta).toBe(-5);
  });
});

describe('buildMarkdownReport', () => {
  it('renders a FAILED report with a regressions section', () => {
    const evaluation = evaluate(
      { hardcodedHexLiterals: 730, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    const md = buildMarkdownReport(evaluation);
    expect(md).toContain('Design System Check FAILED');
    expect(md).toContain('### 🔴 Regressions');
    expect(md).toContain('Action required');
  });

  it('renders a PASSED report at baseline with no drift note', () => {
    const evaluation = evaluate(
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    const md = buildMarkdownReport(evaluation);
    expect(md).toContain('Design System Check PASSED');
    expect(md).toContain('No design-system drift');
    expect(md).not.toContain('🔴 Regressions');
  });

  it('renders an improvements section when below baseline', () => {
    const evaluation = evaluate(
      { hardcodedHexLiterals: 700, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    const md = buildMarkdownReport(evaluation);
    expect(md).toContain('Design System Check PASSED');
    expect(md).toContain('Improvements');
    expect(md).toContain('--update-baseline');
  });

  it('renders baseline increases from a reference baseline as failures', () => {
    const evaluation = evaluate(
      { hardcodedHexLiterals: 1, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 1, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    const baselineRatchet = evaluateBaselineRatchet(
      { hardcodedHexLiterals: 1, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      { hardcodedHexLiterals: 0, rendererCssFiles: 73, uiDirectoryCssFiles: 1 }
    );
    const md = buildMarkdownReport(evaluation, baselineRatchet);
    expect(md).toContain('Design System Check FAILED');
    expect(md).toContain('### 🔴 Baseline increases');
    expect(md).toContain('PR baseline 1, base baseline 0');
  });

  it('renders legal baseline ratchets from a reference baseline', () => {
    const evaluation = evaluate(
      { hardcodedHexLiterals: 0, rendererCssFiles: 68, uiDirectoryCssFiles: 0 },
      { hardcodedHexLiterals: 0, rendererCssFiles: 68, uiDirectoryCssFiles: 0 }
    );
    const baselineRatchet = evaluateBaselineRatchet(
      { hardcodedHexLiterals: 0, rendererCssFiles: 68, uiDirectoryCssFiles: 0 },
      { hardcodedHexLiterals: 0, rendererCssFiles: 73, uiDirectoryCssFiles: 0 }
    );
    const md = buildMarkdownReport(evaluation, baselineRatchet);
    expect(md).toContain('Design System Check PASSED');
    expect(md).toContain('Baseline ratchets in this PR');
    expect(md).toContain('baseline ratcheted down from 73 to 68');
  });
});

describe('parseArgs', () => {
  it('defaults to no flags', () => {
    expect(parseArgs([])).toEqual({
      outputPath: null,
      measure: false,
      updateBaseline: false,
      referenceBaselinePath: null
    });
  });
  it('parses --measure and --update-baseline', () => {
    expect(parseArgs(['--measure'])).toMatchObject({ measure: true });
    expect(parseArgs(['--update-baseline'])).toMatchObject({ updateBaseline: true });
  });
  it('parses --output with a value', () => {
    expect(parseArgs(['--output', 'report.md'])).toMatchObject({ outputPath: 'report.md' });
  });
  it('parses --reference-baseline with a value', () => {
    expect(parseArgs(['--reference-baseline', '/tmp/base.json'])).toMatchObject({
      referenceBaselinePath: '/tmp/base.json'
    });
  });
  it('throws when --output has no value', () => {
    expect(() => parseArgs(['--output'])).toThrow('Missing value for --output');
    expect(() => parseArgs(['--output', '--measure'])).toThrow('Missing value for --output');
  });
  it('throws when --reference-baseline has no value', () => {
    expect(() => parseArgs(['--reference-baseline'])).toThrow('Missing value for --reference-baseline');
    expect(() => parseArgs(['--reference-baseline', '--measure'])).toThrow('Missing value for --reference-baseline');
  });
});

describe('collectCounts (real fs walk over a temp tree)', () => {
  it('counts hex literals and css files, excluding tests and respecting ui/', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    // 2 hex + 3 raw status classes + 2 raw brand classes + 1 raw brand RGB(A) in a normal component
    write(
      path.join(renderer, 'components', 'Foo.tsx'),
      'const a="#fff"; const b="#aabbcc"; const cls="bg-red-600 text-green-500 border-amber-400 bg-blue-600 text-sky-500"; const style="rgba(59, 130, 246, 0.1)";'
    );
    // hex + status class + brand class inside __tests__ must be ignored
    write(path.join(renderer, 'components', '__tests__', 'Foo.test.tsx'), 'const c="#123456"; const k="bg-red-500 bg-blue-500";');
    // hex inside a .spec file must be ignored
    write(path.join(renderer, 'components', 'Bar.spec.tsx'), 'const d="#654321";');
    // a .ts file with one hex
    write(path.join(renderer, 'lib', 'util.ts'), 'export const c = "#abcd";');
    // css files: one under styles, one under components/ui
    write(path.join(renderer, 'styles', 'globals.css'), 'body{color:#000;background:#fff}');
    write(path.join(renderer, 'components', 'ui', 'ExperimentTag.css'), '.x{color:#111}');
    // a non-renderer file must not be walked
    write(path.join(root, 'src', 'main', 'main.ts'), 'const z="#999999";');

    const counts = collectCounts({ rendererDir: renderer });
    expect(counts.hardcodedHexLiterals).toBe(3); // Foo.tsx(2) + util.ts(1); tests excluded
    expect(counts.rendererCssFiles).toBe(2);
    expect(counts.uiDirectoryCssFiles).toBe(1);
    expect(counts.rawStatusPaletteClasses).toBe(3); // Foo.tsx only; __tests__ excluded
    expect(counts.rawBrandColorClasses).toBe(2); // Foo.tsx blue+sky; __tests__ excluded
    expect(counts.rawBrandRgbColors).toBe(1); // Foo.tsx only; __tests__ excluded
    expect(counts.cssHexLiterals).toBe(3); // globals.css(2) + ExperimentTag.css(1)
  });

  it('excludes the sanctioned syntax registry (styles/code-styles.css) from css metrics', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    // One normal component css (counts) and the sanctioned registry (exempt).
    write(path.join(renderer, 'styles', 'globals.css'), 'body{color:#000;background:#fff}');
    write(
      path.join(renderer, 'styles', 'code-styles.css'),
      ':root{--syntax-surface:#1e1e1e;--syntax-block-text:#abb2bf;--syntax-keyword:#569cd6}'
    );

    const counts = collectCounts({ rendererDir: renderer });
    // globals.css counts; code-styles.css is exempt from BOTH file count and hex sum.
    expect(counts.rendererCssFiles).toBe(1);
    expect(counts.cssHexLiterals).toBe(2); // globals.css(2) only; registry's 3 hex excluded
    expect(isSanctionedRegistryCss(path.join(renderer, 'styles', 'code-styles.css'))).toBe(true);
    expect(isSanctionedRegistryCss(path.join(renderer, 'styles', 'globals.css'))).toBe(false);
  });

  it('exempts globals.css --token DEFINITION lines but counts its usage/comment hexes', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    // globals.css: 3 token DEFS (exempt) + 1 usage hex in an @layer rule (counts) +
    // 1 comment hex (counts). The literal alias def is exempt too.
    write(
      path.join(renderer, 'styles', 'globals.css'),
      [
        ':root{',
        '  --color-filetype-pdf: #e5252a;',
        '  --color-brand-microsoft-blue: #00a4ef;',
        '  --color-filetype-image: var(--color-violet-500);',
        '  --color-lang-css: #264de4;',
        '}',
        '/* drift hex in a comment #112233 still counts */',
        '@layer base { body { color: #445566; } }'
      ].join('\n')
    );
    // A component css defining a local --x: #hex is NOT the SSOT, so it still counts.
    write(path.join(renderer, 'styles', 'Agent.css'), '.a{--local:#778899;color:#aabbcc}');

    const counts = collectCounts({ rendererDir: renderer });
    // globals.css: 3 def-line hexes exempt; the comment(#112233) + @layer usage(#445566) count = 2.
    // Agent.css (non-SSOT): both hexes count = 2. Total 4.
    expect(counts.cssHexLiterals).toBe(4);
  });

  it('isSsotDefinitionCss matches only globals.css', () => {
    const renderer = path.join('x', 'src', 'renderer');
    expect(isSsotDefinitionCss(path.join(renderer, 'styles', 'globals.css'))).toBe(true);
    expect(isSsotDefinitionCss(path.join(renderer, 'styles', 'code-styles.css'))).toBe(false);
    expect(isSsotDefinitionCss(path.join(renderer, 'styles', 'Agent.css'))).toBe(false);
  });

  it('countCssHexLiterals exempts def lines only for the SSOT file', () => {
    const ssot = '/a/src/renderer/styles/globals.css';
    const other = '/a/src/renderer/styles/Agent.css';
    const text = '  --color-x: #123456;\n  color: #abcdef;';
    // SSOT: def line exempt, usage line counts -> 1
    expect(countCssHexLiterals(ssot, text)).toBe(1);
    // non-SSOT: both count -> 2
    expect(countCssHexLiterals(other, text)).toBe(2);
  });

  it('counts raw .css border-radius literals via the real walk, excluding the registry', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    // globals.css: a --radius DEFINITION (not a border-radius property) + a var() usage -> 0
    write(
      path.join(renderer, 'styles', 'globals.css'),
      ':root{--radius-lg:8px}\n.panel{border-radius:var(--radius-lg)}'
    );
    // component css: one single literal (10px) + a 4-part shorthand with two raw px = 3
    write(
      path.join(renderer, 'styles', 'Agent.css'),
      '.a{border-radius:10px}\n.b{border-radius:8px 8px 0 0}'
    );
    // sanctioned registry: raw radius here is exempt (whole-file)
    write(path.join(renderer, 'styles', 'code-styles.css'), '.c{border-radius:5px}');

    const counts = collectCounts({ rendererDir: renderer });
    expect(counts.cssBorderRadiusLiterals).toBe(3); // Agent.css(1 + 2); globals var()/def + registry excluded
  });

  it('counts undefined CSS variable references while accepting registry definitions', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    write(path.join(renderer, 'styles', 'globals.css'), '.panel{color:var(--syntax-keyword)}');
    write(path.join(renderer, 'styles', 'Agent.css'), '.card{border-color:var(--missing-token)}');
    write(path.join(renderer, 'styles', 'code-styles.css'), ':root{--syntax-keyword:#569cd6}');

    const counts = collectCounts({ rendererDir: renderer });
    expect(counts.undefinedCssVariableRefs).toBe(1);
  });

  it('returns zeros for a missing renderer dir', () => {
    const counts = collectCounts({ rendererDir: path.join(os.tmpdir(), 'does-not-exist-xyz') });
    expect(counts).toEqual({
      hardcodedHexLiterals: 0,
      rendererCssFiles: 0,
      uiDirectoryCssFiles: 0,
      rawStatusPaletteClasses: 0,
      rawBrandColorClasses: 0,
      rawBrandRgbColors: 0,
      cssHexLiterals: 0,
      sanctionedTsxHexLiterals: 0,
      cssBorderRadiusLiterals: 0,
      undefinedCssVariableRefs: 0
    });
  });
});

describe('sanctioned .tsx carve-out regions', () => {
  it('isSanctionedTsxRegion matches the three forced carve-outs, not normal renderer files', () => {
    const r = path.join('x', 'src', 'renderer');
    // screenshot BrowserWindow subtree (prefix match anywhere under it)
    expect(isSanctionedTsxRegion(path.join(r, 'screenshot', 'index.tsx'))).toBe(true);
    expect(isSanctionedTsxRegion(path.join(r, 'screenshot', 'core', 'toolbar', 'tools.tsx'))).toBe(true);
    // app entry fatal-error fallback (exact-suffix match)
    expect(isSanctionedTsxRegion(path.join(r, 'index.tsx'))).toBe(true);
    // content-excluded Memex file (exact-suffix match)
    expect(isSanctionedTsxRegion(path.join(r, 'components', 'chat', 'MemexMemorySidepaneParts.tsx'))).toBe(true);
    // normal renderer files are NOT sanctioned
    expect(isSanctionedTsxRegion(path.join(r, 'components', 'Foo.tsx'))).toBe(false);
    expect(isSanctionedTsxRegion(path.join(r, 'components', 'chat', 'MemexMemorySidepane.tsx'))).toBe(false);
    // a non-entry index.tsx in a feature dir must NOT match the entry suffix
    expect(isSanctionedTsxRegion(path.join(r, 'components', 'mcp', 'index.tsx'))).toBe(false);
  });

  it('routes carve-out hex to sanctionedTsxHexLiterals and normal hex to hardcodedHexLiterals', () => {
    const root = makeTmpDir();
    const renderer = path.join(root, 'src', 'renderer');
    // Normal component: 2 hex -> hardcodedHexLiterals
    write(path.join(renderer, 'components', 'Foo.tsx'), 'const a="#fff"; const b="#aabbcc";');
    // Screenshot window: 3 hex -> sanctioned (separate BrowserWindow, no globals.css)
    write(
      path.join(renderer, 'screenshot', 'core', 'presets', 'assets.tsx'),
      'const s=["#F8312F","#F70A8D","#CA0B4A"];'
    );
    // App entry fatal-error fallback: 2 hex -> sanctioned
    write(path.join(renderer, 'index.tsx'), 'const e={bg:"#1a1a1a",fg:"#ccc"};');
    // Content-excluded Memex: 1 hex -> sanctioned
    write(path.join(renderer, 'components', 'chat', 'MemexMemorySidepaneParts.tsx'), 'const m="#EEF2FF";');

    const counts = collectCounts({ rendererDir: renderer });
    expect(counts.hardcodedHexLiterals).toBe(2); // Foo.tsx only
    expect(counts.sanctionedTsxHexLiterals).toBe(6); // 3 + 2 + 1
  });
});

describe('readBaseline / ratchetBaseline', () => {
  function writeBaseline(metrics: Record<string, number>): string {
    const root = makeTmpDir();
    const file = path.join(root, 'baseline.json');
    fs.writeFileSync(file, JSON.stringify({ metrics }, null, 2), 'utf8');
    return file;
  }

  it('reads the metrics object from a baseline file', () => {
    const file = writeBaseline({ hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 });
    expect(readBaseline(file)).toEqual({
      hardcodedHexLiterals: 729,
      rendererCssFiles: 73,
      uiDirectoryCssFiles: 1
    });
  });

  it('ratchets a metric DOWN when current is lower', () => {
    const file = writeBaseline({ hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 });
    const changes = ratchetBaseline(
      { hardcodedHexLiterals: 700, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      file
    );
    expect(changes).toEqual([{ key: 'hardcodedHexLiterals', from: 729, to: 700 }]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).metrics.hardcodedHexLiterals).toBe(700);
  });

  it('never raises a baseline when current is higher', () => {
    const file = writeBaseline({ hardcodedHexLiterals: 729, rendererCssFiles: 73, uiDirectoryCssFiles: 1 });
    const changes = ratchetBaseline(
      { hardcodedHexLiterals: 999, rendererCssFiles: 73, uiDirectoryCssFiles: 1 },
      file
    );
    expect(changes).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).metrics.hardcodedHexLiterals).toBe(729);
  });
});

describe('METRICS metadata', () => {
  it('exposes the governed metrics with labels and hints', () => {
    expect(METRICS.map(m => m.key)).toEqual([
      'hardcodedHexLiterals',
      'rendererCssFiles',
      'uiDirectoryCssFiles',
      'rawStatusPaletteClasses',
      'rawBrandColorClasses',
      'rawBrandRgbColors',
      'cssHexLiterals',
      'sanctionedTsxHexLiterals',
      'cssBorderRadiusLiterals',
      'undefinedCssVariableRefs'
    ]);
    expect(METRICS.every(m => m.label && m.hint)).toBe(true);
  });
});
