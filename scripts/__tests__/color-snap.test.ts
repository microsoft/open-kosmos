import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  BUCKETS,
  BUCKET_THRESHOLDS,
  parseHex,
  srgbToLinear,
  rgbToXyz,
  xyzToLab,
  hexToLab,
  parseOklch,
  oklchToXyz,
  oklchToLab,
  colorToLab,
  ciede2000,
  bucketForDelta,
  tokenRole,
  rgbToHue,
  classifyRole,
  parseTokens,
  loadTokens,
  snapHex,
  isScannableFile,
  isSanctionedRegistryCss,
  isSsotDefinitionCss,
  isSanctionedTsxRegion,
  extractHexLiterals,
  walkFiles,
  scanRoot,
  summarize,
  buildConsoleReport,
  parseArgs,
  runSnap,
  main
} from '../color-snap.mjs';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'color-snap-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const approx = (got: number, exp: number, tol = 1e-4) => expect(Math.abs(got - exp)).toBeLessThan(tol);

// ---------------------------------------------------------------------------

describe('parseHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#0Ea5E9')).toEqual({ r: 14, g: 165, b: 233 });
  });

  it('expands 3-digit shorthand', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('drops the alpha channel of 4- and 8-digit hex', () => {
    expect(parseHex('#ff000080')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#f00f')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseHex('  #ffffff  ')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns null for invalid input', () => {
    expect(parseHex('ff0000')).toBeNull();
    expect(parseHex('#gggggg')).toBeNull();
    expect(parseHex('#12345')).toBeNull(); // 5 digits unsupported
    expect(parseHex('')).toBeNull();
    expect(parseHex(null as unknown as string)).toBeNull();
    expect(parseHex(123 as unknown as string)).toBeNull();
  });
});

describe('srgbToLinear', () => {
  it('uses the linear segment below the breakpoint', () => {
    approx(srgbToLinear(0), 0);
    approx(srgbToLinear(0.04045), 0.04045 / 12.92);
  });
  it('uses the gamma segment above the breakpoint', () => {
    approx(srgbToLinear(1), 1);
    approx(srgbToLinear(0.5), Math.pow((0.5 + 0.055) / 1.055, 2.4));
  });
});

describe('sRGB hex -> CIELAB', () => {
  it('maps white to L=100, a=b=0', () => {
    const lab = hexToLab('#ffffff')!;
    approx(lab.L, 100, 1e-3);
    approx(lab.a, 0, 1e-3);
    approx(lab.b, 0, 1e-3);
  });

  it('maps black to L=0', () => {
    const lab = hexToLab('#000000')!;
    approx(lab.L, 0, 1e-3);
  });

  it('matches textbook sRGB-D65 Lab for pure red/green/blue', () => {
    const red = hexToLab('#ff0000')!;
    approx(red.L, 53.241, 0.01);
    approx(red.a, 80.092, 0.01);
    approx(red.b, 67.203, 0.01);
    const green = hexToLab('#00ff00')!;
    approx(green.L, 87.735, 0.01);
    approx(green.a, -86.183, 0.01);
    const blue = hexToLab('#0000ff')!;
    approx(blue.b, -107.86, 0.01);
  });

  it('rgbToXyz/xyzToLab compose into hexToLab', () => {
    const direct = hexToLab('#3b82f6')!;
    const composed = xyzToLab(rgbToXyz(parseHex('#3b82f6')!));
    approx(direct.L, composed.L);
    approx(direct.a, composed.a);
    approx(direct.b, composed.b);
  });

  it('hexToLab returns null for invalid hex', () => {
    expect(hexToLab('nope')).toBeNull();
  });
});

describe('OKLCH -> CIELAB', () => {
  it('parses percentage and unitless lightness', () => {
    expect(parseOklch('oklch(63.7% 0.237 25.331)')).toEqual({ L: 0.637, C: 0.237, h: 25.331 });
    expect(parseOklch('oklch(0.5 0.1 120)')).toEqual({ L: 0.5, C: 0.1, h: 120 });
  });

  it('returns null for non-oklch strings', () => {
    expect(parseOklch('rgb(1,2,3)')).toBeNull();
    expect(parseOklch('#fff')).toBeNull();
    expect(parseOklch(42 as unknown as string)).toBeNull();
  });

  it('maps oklch white to CIELAB white', () => {
    const lab = oklchToLab('oklch(100% 0 0)')!;
    approx(lab.L, 100, 0.1);
    approx(lab.a, 0, 0.1);
    approx(lab.b, 0, 0.1);
  });

  it('accepts a parsed object as well as a string', () => {
    const fromObj = oklchToLab({ L: 0.637, C: 0.237, h: 25.331 })!;
    const fromStr = oklchToLab('oklch(63.7% 0.237 25.331)')!;
    approx(fromObj.L, fromStr.L);
    approx(fromObj.a, fromStr.a);
  });

  it('oklchToXyz is exercised through oklchToLab and returns null for bad input', () => {
    expect(oklchToLab('oklch(bad)')).toBeNull();
    const xyz = oklchToXyz({ L: 0.5, C: 0.1, h: 30 });
    expect(typeof xyz.x).toBe('number');
  });
});

describe('colorToLab dispatch', () => {
  it('routes hex and oklch and rejects others', () => {
    expect(colorToLab('#000000')).not.toBeNull();
    expect(colorToLab('OKLCH(50% 0.1 200)')).not.toBeNull();
    expect(colorToLab('var(--x)')).toBeNull();
    expect(colorToLab(undefined as unknown as string)).toBeNull();
  });
});

describe('ciede2000', () => {
  // Sharma, Wu & Dalal (2005) reference test data.
  const vectors: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]
  ];

  it.each(vectors)('matches reference for %o vs %o', (a, b, expected) => {
    const got = ciede2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    approx(got, expected, 1e-4);
  });

  it('is zero for identical colors', () => {
    approx(ciede2000({ L: 50, a: 10, b: -20 }, { L: 50, a: 10, b: -20 }), 0);
  });
});

describe('bucketForDelta', () => {
  it('classifies by JND thresholds', () => {
    expect(bucketForDelta(0)).toBe(BUCKETS.AUTO);
    expect(bucketForDelta(BUCKET_THRESHOLDS.auto)).toBe(BUCKETS.AUTO);
    expect(bucketForDelta(1.0001)).toBe(BUCKETS.QA);
    expect(bucketForDelta(BUCKET_THRESHOLDS.qa)).toBe(BUCKETS.QA);
    expect(bucketForDelta(3.0001)).toBe(BUCKETS.REVIEW);
  });
});

describe('tokenRole', () => {
  it('maps families to role groups', () => {
    expect(tokenRole('danger')).toBe('danger');
    expect(tokenRole('success')).toBe('success');
    expect(tokenRole('warning')).toBe('warning');
    expect(tokenRole('primary')).toBe('brand');
    expect(tokenRole('accent')).toBe('brand');
    expect(tokenRole('info')).toBe('brand');
    expect(tokenRole('violet')).toBe('secondary');
    expect(tokenRole('indigo')).toBe('secondary');
    expect(tokenRole('neutral')).toBe('neutral');
    expect(tokenRole('warm')).toBe('neutral');
    expect(tokenRole('white')).toBe('neutral');
    expect(tokenRole('black')).toBe('neutral');
    expect(tokenRole('bg')).toBe('neutral');
    expect(tokenRole('text')).toBe('neutral');
    expect(tokenRole('border')).toBe('neutral');
    expect(tokenRole('code')).toBe('neutral');
    expect(tokenRole('selection')).toBe('neutral');
    expect(tokenRole('mystery')).toBe('other');
  });
});

describe('rgbToHue', () => {
  it('returns canonical hues for primaries and 0 for gray', () => {
    expect(rgbToHue({ r: 255, g: 0, b: 0 })).toBe(0);
    expect(rgbToHue({ r: 0, g: 255, b: 0 })).toBe(120);
    expect(rgbToHue({ r: 0, g: 0, b: 255 })).toBe(240);
    expect(rgbToHue({ r: 128, g: 128, b: 128 })).toBe(0);
  });
  it('handles green- and blue-max branches with wrap', () => {
    expect(rgbToHue({ r: 0, g: 255, b: 255 })).toBe(180); // cyan, green max
    expect(rgbToHue({ r: 255, g: 0, b: 255 })).toBe(300); // magenta, blue max
  });
});

describe('classifyRole', () => {
  it('assigns semantic roles by perceived hue', () => {
    expect(classifyRole('#ef4444')).toBe('danger'); // red
    expect(classifyRole('#f59e0b')).toBe('warning'); // amber
    expect(classifyRole('#fde047')).toBe('warning'); // yellow
    expect(classifyRole('#22c55e')).toBe('success'); // green
    expect(classifyRole('#0ea5e9')).toBe('brand'); // sky
    expect(classifyRole('#3b82f6')).toBe('brand'); // blue
    expect(classifyRole('#8b5cf6')).toBe('secondary'); // violet
    expect(classifyRole('#ec4899')).toBe('danger'); // pink wraps toward red
  });
  it('treats low-chroma colors as neutral', () => {
    expect(classifyRole('#808080')).toBe('neutral');
    expect(classifyRole('#171717')).toBe('neutral');
    expect(classifyRole('#f9fafb')).toBe('neutral');
  });
  it('returns other for invalid input', () => {
    expect(classifyRole('not-a-color')).toBe('other');
  });
});

describe('parseTokens', () => {
  it('parses hex and oklch declarations and skips var() aliases', () => {
    const css = `
      @theme {
        --color-primary-500: #0ea5e9;
        --color-danger-500: oklch(63.7% 0.237 25.331);
      }
      :root {
        --color-accent: var(--color-primary-500);
        --color-bg: #ffffff;
      }`;
    const tokens = parseTokens(css);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('--color-primary-500');
    expect(names).toContain('--color-danger-500');
    expect(names).toContain('--color-bg');
    expect(names).not.toContain('--color-accent'); // var() alias skipped
  });

  it('dedupes by name, keeping the first declaration', () => {
    const css = `--color-x: #ffffff; --color-x: #000000;`;
    const tokens = parseTokens(css);
    expect(tokens.filter((t) => t.name === '--color-x')).toHaveLength(1);
    expect(tokens[0].value).toBe('#ffffff');
  });

  it('derives family and role and a CIELAB value', () => {
    const tokens = parseTokens('--color-warm-accent: #ffe6d3; --color-danger-300: oklch(80.8% 0.114 19.571);');
    const warm = tokens.find((t) => t.name === '--color-warm-accent')!;
    expect(warm.family).toBe('warm');
    expect(warm.role).toBe('neutral');
    expect(warm.lab).toHaveProperty('L');
    const danger = tokens.find((t) => t.name === '--color-danger-300')!;
    expect(danger.family).toBe('danger');
    expect(danger.role).toBe('danger');
  });
});

describe('extractHexLiterals', () => {
  it('records 1-based line numbers and multiple matches per line', () => {
    const text = ['const a = "#ffffff";', '', 'x: "#000", y: "#abcdef"'].join('\n');
    const hits = extractHexLiterals(text);
    expect(hits).toEqual([
      { hex: '#ffffff', line: 1 },
      { hex: '#000', line: 3 },
      { hex: '#abcdef', line: 3 }
    ]);
  });
  it('returns empty for text with no hex', () => {
    expect(extractHexLiterals('no colors here')).toEqual([]);
  });
  it('skips CSS custom-property definition lines when skipCssDefLines is set', () => {
    const text = [
      '--color-request-accent: #0f766e;', // definition — skipped
      '  --color-output-error : #f48771 ;', // definition w/ spacing — skipped
      '.y { color: #0ea5e9; }', // usage — kept
      '/* note #abcdef */' // comment hex on a non-def line — kept
    ].join('\n');
    expect(extractHexLiterals(text, { skipCssDefLines: true })).toEqual([
      { hex: '#0ea5e9', line: 3 },
      { hex: '#abcdef', line: 4 }
    ]);
  });
  it('keeps every line by default (backward compatible)', () => {
    const text = ['--color-x: #0f766e;', '.y { color: #0ea5e9; }'].join('\n');
    expect(extractHexLiterals(text).map((h) => h.hex)).toEqual(['#0f766e', '#0ea5e9']);
  });
  it('excludes HTML numeric character entities (not color literals)', () => {
    expect(extractHexLiterals("str.replace(/'/g, '&#039;')")).toEqual([]);
    expect(extractHexLiterals('&#160;&#8217;')).toEqual([]);
  });
  it('still counts a real hex adjacent to an entity', () => {
    expect(extractHexLiterals('&#039; color: #abcdef')).toEqual([{ hex: '#abcdef', line: 1 }]);
  });
});

describe('isScannableFile', () => {
  it('accepts ts/tsx/css source', () => {
    expect(isScannableFile('src/a.tsx')).toBe(true);
    expect(isScannableFile('src/a.ts')).toBe(true);
    expect(isScannableFile('src/a.css')).toBe(true);
  });
  it('rejects tests and other extensions', () => {
    expect(isScannableFile('src/a.test.tsx')).toBe(false);
    expect(isScannableFile('src/a.spec.ts')).toBe(false);
    expect(isScannableFile('src/__tests__/a.tsx')).toBe(false);
    expect(isScannableFile('src/a.js')).toBe(false);
    expect(isScannableFile('src/a.md')).toBe(false);
  });
  it('rejects the sanctioned --syntax-* registry but still scans the SSOT file', () => {
    // code-styles.css is whole-file exempt; globals.css is line-level (still scannable).
    expect(isScannableFile('src/renderer/styles/code-styles.css')).toBe(false);
    expect(isScannableFile('src/renderer/styles/globals.css')).toBe(true);
  });
  it('rejects the same sanctioned TSX carve-outs as the hard gate', () => {
    expect(isScannableFile('src/renderer/screenshot/core/fre/content.tsx')).toBe(false);
    expect(isScannableFile('src/renderer/index.tsx')).toBe(false);
    expect(isScannableFile('src/renderer/components/chat/MemexMemorySidepaneParts.tsx')).toBe(false);
    expect(isScannableFile('src/renderer/components/chat/Message.tsx')).toBe(true);
  });
});

describe('isSanctionedRegistryCss / isSsotDefinitionCss', () => {
  it('flags code-styles.css as the sanctioned registry (whole file)', () => {
    expect(isSanctionedRegistryCss('src/renderer/styles/code-styles.css')).toBe(true);
    expect(isSanctionedRegistryCss('/abs/src/renderer/styles/code-styles.css')).toBe(true);
    expect(isSanctionedRegistryCss('src/renderer/styles/globals.css')).toBe(false);
    expect(isSanctionedRegistryCss('src/renderer/components/A.css')).toBe(false);
  });
  it('flags globals.css as the line-level SSOT definition file', () => {
    expect(isSsotDefinitionCss('src/renderer/styles/globals.css')).toBe(true);
    expect(isSsotDefinitionCss('/abs/src/renderer/styles/globals.css')).toBe(true);
    expect(isSsotDefinitionCss('src/renderer/styles/code-styles.css')).toBe(false);
    expect(isSsotDefinitionCss('src/renderer/components/A.css')).toBe(false);
  });
  it('normalizes Windows-style path separators', () => {
    expect(isSanctionedRegistryCss('src\\renderer\\styles\\code-styles.css')).toBe(true);
    expect(isSsotDefinitionCss('src\\renderer\\styles\\globals.css')).toBe(true);
  });
});

describe('isSanctionedTsxRegion', () => {
  it('matches screenshot, renderer fallback, and content-excluded regions only', () => {
    expect(isSanctionedTsxRegion('src/renderer/screenshot/index.tsx')).toBe(true);
    expect(isSanctionedTsxRegion('/abs/src/renderer/index.tsx')).toBe(true);
    expect(isSanctionedTsxRegion('src/renderer/components/chat/MemexMemorySidepaneParts.tsx')).toBe(true);
    expect(isSanctionedTsxRegion('src/renderer/components/chat/MemexMemorySidepane.tsx')).toBe(false);
    expect(isSanctionedTsxRegion('src/renderer/components/screenshot/Foo.tsx')).toBe(false);
  });
});

describe('snapHex', () => {
  const tokens = parseTokens(`
    --color-primary-500: #0ea5e9;
    --color-primary-600: #0284c7;
    --color-neutral-50: #fafafa;
    --color-neutral-900: #171717;
    --color-danger-500: oklch(63.7% 0.237 25.331);
    --color-success-500: oklch(72.3% 0.219 149.579);
    --color-violet-500: #8b5cf6;
  `);

  it('snaps an exact token value to dE 0 / auto', () => {
    const r = snapHex('#0ea5e9', tokens)!;
    expect(r.token).toBe('--color-primary-500');
    expect(r.deltaE).toBe(0);
    expect(r.bucket).toBe('auto');
    expect(r.roleMatch).toBe(true);
  });

  it('snaps a near cool-gray to the neutral ramp', () => {
    const r = snapHex('#f9fafb', tokens)!;
    expect(r.token).toBe('--color-neutral-50');
    expect(r.role).toBe('neutral');
    expect(r.bucket).toBe('auto');
  });

  it('keeps a red within the danger role', () => {
    const r = snapHex('#ef4444', tokens)!;
    expect(r.token).toBe('--color-danger-500');
    expect(r.role).toBe('danger');
    expect(r.roleMatch).toBe(true);
  });

  it('forces review when the global nearest crosses roles', () => {
    // A green hex with no success-role candidate near it; nearest overall is a
    // different role, so the guard downgrades it to review.
    const sparse = parseTokens('--color-primary-500: #0ea5e9; --color-neutral-900: #171717;');
    const r = snapHex('#22c55e', sparse)!;
    expect(r.roleMatch).toBe(false);
    expect(r.bucket).toBe('review');
  });

  it('returns null for an invalid hex', () => {
    expect(snapHex('#zzz', tokens)).toBeNull();
  });
});

describe('walkFiles + scanRoot + summarize', () => {
  function fixture(): { base: string; renderRoot: string } {
    const base = makeTmpDir();
    const renderRoot = path.join(base, 'renderer');
    const sub = path.join(renderRoot, 'components');
    fs.mkdirSync(sub, { recursive: true });
    // SSOT lives OUTSIDE the scanned renderer root.
    fs.writeFileSync(path.join(base, 'globals.css'), `
      @theme {
        --color-primary-500: #0ea5e9;
        --color-neutral-50: #fafafa;
        --color-danger-500: oklch(63.7% 0.237 25.331);
      }`);
    fs.writeFileSync(
      path.join(sub, 'A.tsx'),
      `const s = { color: '#0ea5e9', bg: '#f9fafb', err: '#ef4444' };`
    );
    fs.writeFileSync(path.join(sub, 'B.css'), `.x { color: #fafafa; }`);
    // excluded files
    fs.writeFileSync(path.join(sub, 'A.test.tsx'), `const z = '#123456';`);
    fs.mkdirSync(path.join(sub, '__tests__'));
    fs.writeFileSync(path.join(sub, '__tests__', 'C.tsx'), `const z = '#654321';`);
    return { base, renderRoot };
  }

  it('walkFiles skips tests and node_modules and finds source', () => {
    const { renderRoot } = fixture();
    fs.mkdirSync(path.join(renderRoot, 'node_modules'));
    fs.writeFileSync(path.join(renderRoot, 'node_modules', 'dep.tsx'), `'#000000'`);
    const files = walkFiles(renderRoot).map((f) => path.basename(f)).sort();
    expect(files).toEqual(['A.tsx', 'B.css']);
  });

  it('scanRoot snaps every literal and summarize buckets them', () => {
    const { base, renderRoot } = fixture();
    const tokens = loadTokens(path.join(base, 'globals.css'));
    const results = scanRoot(renderRoot, tokens);
    // #0ea5e9, #f9fafb, #ef4444 (A.tsx) + #fafafa (B.css) = 4 literals
    expect(results).toHaveLength(4);
    const s = summarize(results);
    expect(s.total).toBe(4);
    expect(s.byBucket.auto + s.byBucket.qa + s.byBucket.review).toBe(4);
    expect(s.distinct.length).toBe(4);
  });
});

describe('scanRoot excludes the SSOT definitions and the syntax registry', () => {
  it('skips globals.css --token defs + code-styles.css, keeps real usages', () => {
    const base = makeTmpDir();
    const renderRoot = path.join(base, 'renderer');
    const styles = path.join(renderRoot, 'styles');
    fs.mkdirSync(styles, { recursive: true });
    // The token SSOT lives at styles/globals.css INSIDE the scanned root.
    fs.writeFileSync(
      path.join(styles, 'globals.css'),
      [
        '@theme {',
        '  --color-primary-500: #0ea5e9;', // definition — skipped
        '  --color-request-accent: #0f766e;', // definition — skipped (the iter-2 false positive)
        '}',
        '@layer base {',
        '  .brand { color: #0284c7; }', // USAGE — kept
        '}'
      ].join('\n')
    );
    // The --syntax-* registry is exempt as a whole file.
    fs.writeFileSync(path.join(styles, 'code-styles.css'), ':root { --syntax-key: #4f46e5; }');
    const tokens = loadTokens(path.join(styles, 'globals.css'));
    const reported = scanRoot(renderRoot, tokens).map((r) => r.hex);
    // Only the @layer usage hex is reported.
    expect(reported).toEqual(['#0284c7']);
    // The teal SSOT def (#0f766e) — the iteration-2 cross-role false positive — is gone.
    expect(reported).not.toContain('#0f766e');
    // The exact-match registry value never surfaces as a candidate.
    expect(reported).not.toContain('#4f46e5');
  });
});

describe('buildConsoleReport', () => {
  it('renders counts and lists review candidates', () => {
    const tokens = parseTokens('--color-primary-500: #0ea5e9; --color-neutral-900: #171717;');
    const results = scanResultsFor(['#0ea5e9', '#22c55e'], tokens);
    const report = buildConsoleReport(results);
    expect(report).toContain('literals scanned: 2');
    expect(report).toContain('review candidates:');
  });

  it('omits the review section when there are none', () => {
    const tokens = parseTokens('--color-primary-500: #0ea5e9;');
    const results = scanResultsFor(['#0ea5e9'], tokens);
    expect(buildConsoleReport(results)).not.toContain('review candidates:');
  });
});

function scanResultsFor(hexes: string[], tokens: ReturnType<typeof parseTokens>) {
  return hexes.map((hex, i) => ({ file: 'f.tsx', line: i + 1, ...snapHex(hex, tokens)! }));
}

describe('parseArgs', () => {
  it('parses --json and --bucket with values', () => {
    expect(parseArgs(['--json', 'out.json', '--bucket', 'review'])).toEqual({
      json: 'out.json',
      bucket: 'review'
    });
  });
  it('falls back to defaults when values are omitted', () => {
    expect(parseArgs(['--json'])).toEqual({ json: 'color-snap-report.json', bucket: null });
    expect(parseArgs([])).toEqual({ json: null, bucket: null });
  });
});

describe('runSnap', () => {
  it('loads tokens, scans, and filters by bucket', () => {
    const base = makeTmpDir();
    const renderRoot = path.join(base, 'renderer');
    fs.mkdirSync(renderRoot);
    fs.writeFileSync(path.join(base, 'globals.css'), '--color-primary-500: #0ea5e9;');
    fs.writeFileSync(path.join(renderRoot, 'a.tsx'), `'#0ea5e9'; '#22c55e';`);
    const all = runSnap(path.join(base, 'globals.css'), renderRoot);
    expect(all.tokens).toHaveLength(1);
    expect(all.results).toHaveLength(2);
    const review = runSnap(path.join(base, 'globals.css'), renderRoot, 'review');
    expect(review.results.every((r) => r.bucket === 'review')).toBe(true);
  });
});

describe('main', () => {
  it('prints the console report against the real repo SSOT', () => {
    const logs: string[] = [];
    const code = main([], { log: (m: string) => logs.push(String(m)) });
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('color-snap');
  });

  it('writes a JSON report when --json is given', () => {
    const out = path.join(makeTmpDir(), 'report.json');
    const logs: string[] = [];
    const code = main(['--json', out], { log: (m: string) => logs.push(String(m)) });
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(payload).toHaveProperty('summary');
    expect(payload).toHaveProperty('results');
    expect(payload.tokenCount).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('wrote');
  });
});
