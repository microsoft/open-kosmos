#!/usr/bin/env node
// @ts-nocheck

/**
 * color-snap — perceptual nearest-token snapping tool for the OpenKosmos design system.
 *
 * Governance requirement #3 (see ai.prompt/design-system.md): every raw color
 * literal should be migrated to the nearest already-managed token; a brand-new
 * token is only introduced when no managed color is perceptually close enough.
 * This tool makes that decision measurable and auditable.
 *
 * Pipeline (all pure, individually tested):
 *   1. Parse the SSOT (@theme block in globals.css) into a token table. Both
 *      sRGB-hex tokens (primary/warm/neutral/...) and OKLCH tokens (status ramps)
 *      are supported and unified onto CIELAB.
 *   2. Scan src/renderer for raw hex literals (the same surface the drift gate
 *      measures), recording file + line for each. The two sanctioned color homes
 *      are excluded so their token DEFINITIONS are never reported as migration
 *      candidates: code-styles.css (the `--syntax-*` registry, whole file) and the
 *      `--token:` definition lines of globals.css (the SSOT), plus the same
 *      sanctioned TSX carve-outs used by the hard gate. This mirrors
 *      scripts/check-design-tokens.js, so the advisory tool and the hard gate agree
 *      on what is a definition / carve-out vs. a usage.
 *   3. For every literal, convert to CIELAB and compute CIEDE2000 against every
 *      candidate token, picking the nearest.
 *   4. A semantic-role guard restricts candidates to the literal's own hue family
 *      (red->danger, green->success, amber->warning, blue->primary/accent,
 *      violet/indigo->secondary, gray->neutral/warm/white/black). A cross-family
 *      nearest match is downgraded to the `review` bucket regardless of distance,
 *      so a stray status color never silently snaps to a brand ramp.
 *   5. Bucket by CIEDE2000 distance (calibrated to JND units):
 *        auto   dE <= 1   imperceptible — safe codemod
 *        qa     dE <= 3   perceptible on inspection — migrate + visual QA
 *        review dE >  3   visible shift — owner sign-off (or new token)
 *
 * NOTE on metric choice: the todo says "OKLab"; we use CIEDE2000 over CIELAB
 * because the auto/qa/review buckets (<=1 / <=3) are calibrated in CIEDE2000 JND
 * units. OKLab Euclidean dE is on a ~50x smaller scale and would collapse every
 * literal into the `auto` bucket. The color pipeline still passes *through* OKLab
 * for the OKLCH status tokens (oklch -> oklab -> XYZ), so both spaces are used.
 *
 * Usage:
 *   node scripts/color-snap.mjs                 # console summary
 *   node scripts/color-snap.mjs --json out.json # write full mapping JSON
 *   node scripts/color-snap.mjs --bucket review # only print one bucket
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const BUCKETS = { AUTO: 'auto', QA: 'qa', REVIEW: 'review' };
export const BUCKET_THRESHOLDS = { auto: 1, qa: 3 };

// ---------------------------------------------------------------------------
// sRGB hex -> CIELAB
// ---------------------------------------------------------------------------

/** Parse #rgb/#rgba/#rrggbb/#rrggbbaa into {r,g,b} (0-255). Alpha is dropped.
 *  Returns null for anything that is not a valid hex color. */
export function parseHex(input) {
  if (typeof input !== 'string') return null;
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 4) h = h.slice(0, 3); // #rgba -> #rgb
  if (h.length === 8) h = h.slice(0, 6); // #rrggbbaa -> #rrggbb
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

/** sRGB channel (0-1) -> linear-light. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** {r,g,b} (0-255) -> CIE XYZ (D65, Y=1 for white). */
export function rgbToXyz({ r, g, b }) {
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);
  return {
    x: rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
    y: rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175,
    z: rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041
  };
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function labF(t) {
  const e = 216 / 24389; // (6/29)^3
  const k = 24389 / 27; // (29/3)^3
  return t > e ? Math.cbrt(t) : (k * t + 16) / 116;
}

/** CIE XYZ (D65) -> CIELAB. */
export function xyzToLab({ x, y, z }) {
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return xyzToLab(rgbToXyz(rgb));
}

// ---------------------------------------------------------------------------
// OKLCH -> CIELAB (for the status ramps, which are authored in OKLCH)
// ---------------------------------------------------------------------------

/** Parse `oklch(L% C h)` / `oklch(L C h)` into {L,C,h} (L in 0-1, h in degrees). */
export function parseOklch(input) {
  if (typeof input !== 'string') return null;
  const m = /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/i.exec(input.trim());
  if (!m) return null;
  const rawL = m[1];
  const L = rawL.endsWith('%') ? parseFloat(rawL) / 100 : parseFloat(rawL);
  return { L, C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

/** {L,C,h} OKLCH -> CIE XYZ (D65), via OKLab (Ottosson). */
export function oklchToXyz({ L, C, h }) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    x: 1.2270138511 * l - 0.5577999807 * m + 0.281256149 * s,
    y: -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s,
    z: -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s
  };
}

export function oklchToLab(input) {
  const oklch = typeof input === 'string' ? parseOklch(input) : input;
  if (!oklch) return null;
  return xyzToLab(oklchToXyz(oklch));
}

/** Dispatch any supported CSS color value string -> CIELAB. */
export function colorToLab(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.startsWith('#')) return hexToLab(v);
  if (v.toLowerCase().startsWith('oklch(')) return oklchToLab(v);
  return null;
}

// ---------------------------------------------------------------------------
// CIEDE2000
// ---------------------------------------------------------------------------

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

function hueAngle(b, ap) {
  if (ap === 0 && b === 0) return 0;
  let h = rad2deg(Math.atan2(b, ap));
  if (h < 0) h += 360;
  return h;
}

/** CIEDE2000 color difference between two CIELAB colors. */
export function ciede2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hbarp - 30)) +
    0.24 * Math.cos(deg2rad(2 * hbarp)) +
    0.32 * Math.cos(deg2rad(3 * hbarp + 6)) -
    0.2 * Math.cos(deg2rad(4 * hbarp - 63));

  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(deg2rad(2 * dtheta)) * RC;

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH)
  );
}

export function bucketForDelta(deltaE) {
  if (deltaE <= BUCKET_THRESHOLDS.auto) return BUCKETS.AUTO;
  if (deltaE <= BUCKET_THRESHOLDS.qa) return BUCKETS.QA;
  return BUCKETS.REVIEW;
}

// ---------------------------------------------------------------------------
// Semantic-role guard
// ---------------------------------------------------------------------------

/**
 * Map a token family (e.g. `primary`, `danger`) to a role group used by the
 * in-role snap guard. Only the MANAGED ramps participate in in-role auto-snapping:
 * primary/accent/info -> brand, danger/success/warning -> themselves,
 * violet/indigo -> secondary, and the neutral family
 * (white/black/neutral/warm/bg/text/border/code/selection).
 *
 * Every OTHER family maps to `other` ON PURPOSE -- this is intentional isolation,
 * not a missing case. It covers external-identity colors (brand-microsoft-*,
 * brand-sharepoint-*, filetype-*, lang-*, illustration-*), single-role semantic
 * accents (request-accent, output-error), and the deliberately far-set primitives
 * (orange/rose/cyan/taupe/sky-soft, ...). `other` tokens are excluded from in-role
 * matching, so an arbitrary literal can never auto-fold onto an identity color
 * (e.g. a stray red snapping onto `--color-brand-microsoft-red` or a teal onto
 * `--color-filetype-*`). Any literal whose global nearest is an `other` token is
 * instead forced into the `review` bucket for human sign-off, with that nearest
 * token surfaced as `globalNearest`. Do NOT hue-map these families into a ramp;
 * that would break the isolation by design.
 */
export function tokenRole(family) {
  switch (family) {
    case 'danger':
      return 'danger';
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'primary':
    case 'accent':
    case 'info':
      return 'brand';
    case 'violet':
    case 'indigo':
      return 'secondary';
    case 'white':
    case 'black':
    case 'neutral':
    case 'warm':
    case 'bg':
    case 'text':
    case 'border':
    case 'code':
    case 'selection':
      return 'neutral';
    default:
      return 'other';
  }
}

/** sRGB {r,g,b} (0-255) -> HSL hue in degrees (0-360). Returns 0 for achromatic. */
export function rgbToHue({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/**
 * Classify a hex literal into a semantic role group.
 *
 * Role intent follows perceived HSL *hue* (the way Tailwind palette names and
 * humans mean "red/amber/green/blue"), NOT CIELAB hue (which rotates red toward
 * ~40deg and would mislabel it). Grayness is judged with CIELAB chroma, which is
 * perceptually faithful. Distance/snapping still uses CIEDE2000 elsewhere.
 */
export function classifyRole(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 'other';
  const lab = xyzToLab(rgbToXyz(rgb));
  const chroma = Math.hypot(lab.a, lab.b);
  if (chroma < 15) return 'neutral'; // gray / near-gray
  const h = rgbToHue(rgb);
  if (h < 18 || h >= 340) return 'danger'; // red
  if (h >= 18 && h < 65) return 'warning'; // orange / amber / yellow
  if (h >= 65 && h < 170) return 'success'; // green
  if (h >= 170 && h < 235) return 'brand'; // cyan / blue / sky
  if (h >= 235 && h < 300) return 'secondary'; // indigo / violet / purple
  return 'danger'; // magenta / pink wraps toward red
}

// ---------------------------------------------------------------------------
// SSOT token parsing
// ---------------------------------------------------------------------------

/** Parse `--color-NAME: VALUE;` declarations with literal color values from a
 *  CSS string. var()-alias declarations are skipped. */
export function parseTokens(cssText) {
  const tokens = [];
  const seen = new Set();
  const re = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|oklch\([^)]*\))/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = `--color-${m[1]}`;
    if (seen.has(name)) continue;
    const value = m[2];
    const lab = colorToLab(value);
    if (!lab) continue;
    seen.add(name);
    const family = m[1].replace(/-\d+$/, '').replace(/-accent$/, '');
    tokens.push({ name, value, family, role: tokenRole(family), lab });
  }
  return tokens;
}

export function loadTokens(globalsCssPath) {
  const css = fs.readFileSync(globalsCssPath, 'utf8');
  return parseTokens(css);
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** Find the nearest token to a hex literal, honoring the role guard. */
export function snapHex(hex, tokens) {
  const lab = hexToLab(hex);
  if (!lab) return null;
  const role = classifyRole(hex);

  let best = null;
  let bestInRole = null;
  for (const tok of tokens) {
    const dE = ciede2000(lab, tok.lab);
    if (!best || dE < best.deltaE) best = { token: tok, deltaE: dE };
    if (tok.role === role && (!bestInRole || dE < bestInRole.deltaE)) {
      bestInRole = { token: tok, deltaE: dE };
    }
  }
  if (!best) return null;

  // Prefer the nearest in-role token; flag when the global nearest crosses roles.
  const chosen = bestInRole || best;
  const roleMatch = bestInRole != null && bestInRole.token.name === best.token.name;
  let bucket = bucketForDelta(chosen.deltaE);
  if (!roleMatch) bucket = BUCKETS.REVIEW; // role mismatch always needs sign-off

  return {
    hex: hex.toLowerCase(),
    role,
    token: chosen.token.name,
    tokenValue: chosen.token.value,
    deltaE: Number(chosen.deltaE.toFixed(4)),
    globalNearest: best.token.name,
    globalDeltaE: Number(best.deltaE.toFixed(4)),
    roleMatch,
    bucket
  };
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

const HEX_RE = /(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

/**
 * The two sanctioned color-definition homes (mirrors scripts/check-design-tokens.js).
 * These are where raw values legitimately live, so the snapper must NOT report their
 * token DEFINITIONS as migration candidates:
 *  - code-styles.css: the independent `--syntax-*` registry (whole file is definitions).
 *  - globals.css: the `@theme`/`:root` token SSOT -- only its `--token: <value>;`
 *    definition lines are skipped, so a raw `color: #abc` USAGE inside an `@layer`
 *    rule (genuine drift) is still scanned and reported.
 */
const SANCTIONED_REGISTRY_CSS = ['/styles/code-styles.css'];
const SSOT_DEFINITION_CSS = ['/styles/globals.css'];
const SANCTIONED_TSX_REGIONS = [
  '/renderer/screenshot/',
  '/renderer/index.tsx',
  '/components/chat/MemexMemorySidepaneParts.tsx'
];
/** A CSS custom-property declaration line, e.g. `  --color-filetype-pdf: #e5252a;`. */
const CSS_CUSTOM_PROP_DEF = /^\s*--[A-Za-z0-9-]+\s*:/;

function normalizeScanPath(file) {
  return file.replace(/\\/g, '/');
}

export function isSanctionedRegistryCss(file) {
  const p = normalizeScanPath(file);
  return SANCTIONED_REGISTRY_CSS.some((suffix) => p.endsWith(suffix));
}

export function isSsotDefinitionCss(file) {
  const p = normalizeScanPath(file);
  return SSOT_DEFINITION_CSS.some((suffix) => p.endsWith(suffix));
}

export function isSanctionedTsxRegion(file) {
  const p = normalizeScanPath(file);
  return SANCTIONED_TSX_REGIONS.some((frag) =>
    frag.endsWith('/') ? p.includes(frag) : p.endsWith(frag)
  );
}

export function isScannableFile(file) {
  if (/\.(test|spec)\.[tj]sx?$/.test(file)) return false;
  if (file.includes('__tests__')) return false;
  if (isSanctionedTsxRegion(file)) return false;
  if (isSanctionedRegistryCss(file)) return false; // code-styles.css = the --syntax-* registry
  return SCAN_EXTENSIONS.has(path.extname(file));
}

/**
 * Extract hex literals with 1-based line numbers from a file's text. When
 * `skipCssDefLines` is set (the SSOT file globals.css), `--token: <value>;`
 * definition lines are skipped so the managed token DEFINITIONS are not reported
 * as drift; usage hexes on other lines (e.g. inside `@layer` rules) still count.
 */
export function extractHexLiterals(text, { skipCssDefLines = false } = {}) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (skipCssDefLines && CSS_CUSTOM_PROP_DEF.test(lines[i])) continue;
    const matches = lines[i].match(HEX_RE);
    if (!matches) continue;
    for (const hex of matches) out.push({ hex, line: i + 1 });
  }
  return out;
}

export function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walkFiles(full, acc);
    } else if (isScannableFile(full)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Scan a renderer root, returning one snap result per literal occurrence. */
export function scanRoot(rendererRoot, tokens) {
  const results = [];
  for (const file of walkFiles(rendererRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const skipCssDefLines = isSsotDefinitionCss(file);
    for (const { hex, line } of extractHexLiterals(text, { skipCssDefLines })) {
      const snapped = snapHex(hex, tokens);
      if (!snapped) continue;
      results.push({ file: path.relative(REPO_ROOT, file), line, ...snapped });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function summarize(results) {
  const byBucket = { auto: 0, qa: 0, review: 0 };
  const distinct = new Map();
  for (const r of results) {
    byBucket[r.bucket]++;
    const key = r.hex;
    if (!distinct.has(key)) {
      distinct.set(key, { hex: r.hex, token: r.token, deltaE: r.deltaE, bucket: r.bucket, count: 0 });
    }
    distinct.get(key).count++;
  }
  return { total: results.length, byBucket, distinct: [...distinct.values()] };
}

export function buildConsoleReport(results) {
  const s = summarize(results);
  const lines = [];
  lines.push('color-snap — nearest-token classification');
  lines.push(`  literals scanned: ${s.total}  (distinct: ${s.distinct.length})`);
  lines.push(`  auto   (dE<=1):  ${s.byBucket.auto}`);
  lines.push(`  qa     (dE<=3):  ${s.byBucket.qa}`);
  lines.push(`  review (dE>3):   ${s.byBucket.review}`);
  const review = s.distinct.filter((d) => d.bucket === 'review').sort((a, b) => b.deltaE - a.deltaE);
  if (review.length) {
    lines.push('  review candidates:');
    for (const d of review.slice(0, 20)) {
      lines.push(`    ${d.hex} -> ${d.token}  dE=${d.deltaE}  (x${d.count})`);
    }
  }
  return lines.join('\n');
}

export function parseArgs(argv) {
  const args = { json: null, bucket: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') args.json = argv[++i] || 'color-snap-report.json';
    else if (argv[i] === '--bucket') args.bucket = argv[++i] || null;
  }
  return args;
}

/** Load tokens, scan a renderer root, optionally filter by bucket. */
export function runSnap(globalsCssPath, rendererRoot, bucketFilter = null) {
  const tokens = loadTokens(globalsCssPath);
  let results = scanRoot(rendererRoot, tokens);
  if (bucketFilter) results = results.filter((r) => r.bucket === bucketFilter);
  return { tokens, results };
}

export function main(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  const globalsCss = path.join(REPO_ROOT, 'src/renderer/styles/globals.css');
  const rendererRoot = path.join(REPO_ROOT, 'src/renderer');
  const { tokens, results } = runSnap(globalsCss, rendererRoot, args.bucket);

  if (args.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      tokenCount: tokens.length,
      summary: summarize(results),
      results
    };
    fs.writeFileSync(path.resolve(REPO_ROOT, args.json), JSON.stringify(payload, null, 2));
    io.log(`wrote ${args.json} (${results.length} literals, ${tokens.length} tokens)`);
  } else {
    io.log(buildConsoleReport(results));
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main());
}
