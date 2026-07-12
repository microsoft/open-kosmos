#!/usr/bin/env node
'use strict';

/**
 * Design-system drift ratchet gate.
 *
 * Governance engine for the OpenKosmos design system (see
 * ai.prompt/design-system.md). It measures repo-wide drift signals and compares
 * them against frozen baselines in scripts/design-system-baseline.json. Counts may
 * only ratchet DOWN: the gate fails when any current count exceeds its baseline.
 *
 * Metrics:
 *  - hardcodedHexLiterals: raw hex colors (#rgb/#rgba/#rrggbb/#rrggbbaa) in
 *    src/renderer TS/TSX (excluding __tests__ and *.test/*.spec, and the sanctioned
 *    carve-out regions below). Must move to tokens — this is the hard-zero target.
 *  - sanctionedTsxHexLiterals: raw hex colors in the .tsx carve-out regions (see
 *    SANCTIONED_TSX_REGIONS) that physically/policy CANNOT reference globals.css
 *    var(): the screenshot BrowserWindow, index.tsx's fatal-error fallback, and the
 *    content-excluded Memex file. Tracked as its own BOUNDED metric so these can never
 *    grow, without mislabeling them as migratable drift under hardcodedHexLiterals.
 *  - rendererCssFiles: .css files under src/renderer (legacy styling; should shrink).
 *  - uiDirectoryCssFiles: .css files under src/renderer/components/ui (primitives must
 *    be Tailwind-only; the lone ExperimentTag.css is debt to migrate).
 *  - rawStatusPaletteClasses: raw Tailwind red/green/amber/yellow utility classes (e.g.
 *    `bg-red-600`, `text-green-500`) in src/renderer TS/TSX. These map to semantic status
 *    tokens (red->danger, green->success, amber->warning, yellow->warning); new code should
 *    use the token. `yellow` shares the `warning` token (warning aliases amber) and was added
 *    after Phase 29 migrated the last raw `yellow-*` usages, to stop the hue drifting back.
 *  - rawBrandColorClasses: raw Tailwind blue/sky utility classes (e.g. `bg-blue-600`,
 *    `text-sky-500`) in src/renderer TS/TSX. Brand color is governed by the `primary`
 *    token; `blue-*` was the migrated drift and raw `sky-*` bypasses the token.
 *  - rawBrandRgbColors: raw Tailwind blue/sky RGB(A) function literals (e.g.
 *    `rgba(59, 130, 246, .1)` or `rgba(14, 165, 233, .1)`) in renderer TS/TSX/CSS.
 *    These must use tokenized RGB channels (`rgb(var(--color-accent-rgb) / alpha)`)
 *    so alpha variants cannot bypass the brand token ratchet.
 *  - cssHexLiterals: raw hex colors in src/renderer .css files (the .css twin of
 *    hardcodedHexLiterals). Component CSS should reference CSS variables / tokens
 *    (var(--token)) rather than hardcode hex; this locks in the CSS color consolidation.
 *    Two sanctioned definition homes are exempt because they ARE the managed source of
 *    truth for raw values: (1) whole-file registries (see SANCTIONED_REGISTRY_CSS, e.g.
 *    styles/code-styles.css, the independent syntax registry); (2) the `--token:` DEFINITION
 *    lines of the SSOT file globals.css (see SSOT_DEFINITION_CSS) — its @theme/:root token
 *    defs are the central color manager, so a `--color-x: #hex;` def is sanctioned while a
 *    raw `color: #hex` usage anywhere (incl. globals.css @layer rules / comments) still counts.
 *  - cssBorderRadiusLiterals: raw px/rem `border-radius` literals in src/renderer .css
 *    files (the radius analogue of cssHexLiterals). Corner radius is governed by the
 *    `--radius-*` scale in globals.css (@theme + :root), so component CSS should
 *    reference `var(--radius-*)`. Geometric `0`/`50%` and `calc(var(--radius-*) / ...)`
 *    are not counted; the `--radius-*:` token DEFINITIONS are custom-property
 *    declarations (not `border-radius` properties), so they are excluded automatically.
 *  - undefinedCssVariableRefs: CSS `var(--token)` references with no fallback whose
 *    token is not defined in renderer CSS. Browsers drop the whole declaration when
 *    such a reference is unresolved, so dark-mode/tokenized styling can silently vanish.
 *
 * Usage:
 *   node scripts/check-design-tokens.js                 # check against baseline
 *   node scripts/check-design-tokens.js --output rep.md # also write a PR markdown report
 *   node scripts/check-design-tokens.js --reference-baseline /tmp/base.json
 *                                                        # CI: also prove the PR baseline was not raised
 *   node scripts/check-design-tokens.js --measure       # print current counts as JSON
 *   node scripts/check-design-tokens.js --update-baseline  # ratchet baseline DOWN to current
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const UI_DIR_FRAGMENT = '/components/ui/';
const BASELINE_PATH = path.join(__dirname, 'design-system-baseline.json');
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'dist-vite', '.webpack', 'out', 'build', 'release', '.git']);

/**
 * Sanctioned token-DEFINITION registries: pure `:root` token files that ARE the
 * managed home for raw color values, so they are exempt from the .css drift
 * metrics (rendererCssFiles / cssHexLiterals). Matched by path suffix.
 *  - styles/code-styles.css: the independent syntax / code-rendering registry
 *    (`--syntax-*`). See ai.prompt/design-system.md and the file header.
 */
const SANCTIONED_REGISTRY_CSS = ['/styles/code-styles.css'];

function isSanctionedRegistryCss(fullPath) {
  const p = normalizePath(fullPath);
  return SANCTIONED_REGISTRY_CSS.some(suffix => p.endsWith(suffix));
}

/**
 * The single source-of-truth token-DEFINITION file. Unlike code-styles.css (a
 * whole-file registry), globals.css mixes the sanctioned token-definition region
 * (the `@theme` block + the `:root` custom-primitive / semantic tier — every line
 * of the form `--token: <value>;`) with ordinary `@layer` usage rules. The
 * definition lines ARE the managed home for raw color values (the SSOT every other
 * file references via `var(--token)`), so they are exempt from cssHexLiterals;
 * any hex OUTSIDE a `--token:` definition line (e.g. a raw `color: #abc` inside an
 * `@layer` rule, or a hex in a comment) still counts as drift. Matched by suffix.
 */
const SSOT_DEFINITION_CSS = ['/styles/globals.css'];

function isSsotDefinitionCss(fullPath) {
  const p = normalizePath(fullPath);
  return SSOT_DEFINITION_CSS.some(suffix => p.endsWith(suffix));
}

/**
 * Sanctioned .tsx carve-out regions: renderer code where raw hex literals are either
 * physically / policy forced or intentionally bounded user/asset color data. These
 * regions are counted under the separate `sanctionedTsxHexLiterals` metric
 * (bounded, ratchet-down-only) instead of the main `hardcodedHexLiterals` hard-zero
 * target — so they can never grow, yet aren't mislabeled as ordinary migratable drift:
 *  - `/renderer/screenshot/`**: the screenshot overlay renders in a SEPARATE Electron
 *    BrowserWindow. Its app chrome does load globals.css through screenshot.tsx and
 *    should use `var(--color-*)`; the remaining sanctioned literals are predominantly
 *    illustration assets (multi-color preset SVG icons) and the user-facing drawing-color
 *    palette — user content / fixed assets, not app chrome token candidates.
 *  - `/renderer/index.tsx`: the React fatal-error fallback renders with inline styles
 *    that must work even when the app (and all its CSS) fails to mount; depending on the
 *    token system would defeat the fallback's purpose. (Its colors are a dark error
 *    screen unrelated to the light app ramp.)
 *  - `MemexMemorySidepaneParts.tsx`: excluded by the org content-exclusion policy
 *    (uneditable), so its single hex cannot be migrated.
 * Everything OUTSIDE these regions (and the two registries) must reach hard-zero raw hex.
 */
const SANCTIONED_TSX_REGIONS = [
  '/renderer/screenshot/',
  '/renderer/index.tsx',
  '/components/chat/MemexMemorySidepaneParts.tsx'
];

function isSanctionedTsxRegion(fullPath) {
  const p = normalizePath(fullPath);
  return SANCTIONED_TSX_REGIONS.some(frag =>
    frag.endsWith('/') ? p.includes(frag) : p.endsWith(frag)
  );
}

/** A CSS custom-property declaration line, e.g. `  --color-filetype-pdf: #e5252a;`. */
const CSS_CUSTOM_PROP_DEF = /^\s*--[A-Za-z0-9-]+\s*:/;
const CSS_CUSTOM_PROP_DEF_ANYWHERE = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
const CSS_VAR_REF = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;

const METRICS = [
  {
    key: 'hardcodedHexLiterals',
    label: 'Hardcoded hex colors in renderer .ts/.tsx (outside sanctioned regions)',
    hint: 'Replace with semantic Tailwind tokens (see tailwind.config.js). Hard-zero target.'
  },
  {
    key: 'rendererCssFiles',
    label: '.css files under src/renderer',
    hint: 'Prefer Tailwind utilities + tokens; migrate legacy CSS opportunistically.'
  },
  {
    key: 'uiDirectoryCssFiles',
    label: '.css files under components/ui',
    hint: 'Primitives must be Tailwind-only; migrate ExperimentTag.css out of ui/.'
  },
  {
    key: 'rawStatusPaletteClasses',
    label: 'Raw red/green/amber/yellow Tailwind classes in renderer .ts/.tsx',
    hint: 'Use the semantic status tokens: red->danger, green->success, amber/yellow->warning.'
  },
  {
    key: 'rawBrandColorClasses',
    label: 'Raw blue/sky Tailwind classes in renderer .ts/.tsx',
    hint: 'Use the primary brand token (primary-*); blue-* is drift and raw sky-* bypasses the token.'
  },
  {
    key: 'rawBrandRgbColors',
    label: 'Raw blue/sky RGB(A) color functions in renderer source',
    hint: 'Use tokenized RGB channels such as rgb(var(--color-accent-rgb) / alpha); raw blue/sky RGB(A) bypasses the brand token.'
  },
  {
    key: 'cssHexLiterals',
    label: 'Hardcoded hex colors in renderer .css',
    hint: 'Move raw hex into CSS variables / Tailwind tokens; component CSS should reference var(--token).'
  },
  {
    key: 'sanctionedTsxHexLiterals',
    label: 'Hex colors in sanctioned .tsx carve-outs (screenshot window / fatal-error fallback / content-excluded)',
    hint: 'Bounded screenshot asset/user-palette, fatal-error fallback, and content-excluded literals — may only ratchet down, never grow.'
  },
  {
    key: 'cssBorderRadiusLiterals',
    label: 'Hardcoded border-radius literals in renderer .css',
    hint: 'Corner radius is governed by the --radius-* scale; component CSS should reference var(--radius-*) rather than a raw px/rem value.'
  },
  {
    key: 'undefinedCssVariableRefs',
    label: 'Undefined CSS var() references without fallbacks',
    hint: 'Define the token in renderer CSS, replace it with an existing token, or add an explicit fallback.'
  }
];

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function isTestFile(name) {
  return /\.(test|spec)\.[tj]sx?$/.test(name);
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Count hex color literals in a string. A fresh regex avoids stateful lastIndex.
 * The `(?<!&)` lookbehind excludes HTML numeric character entities (e.g. `&#039;`,
 * `&#160;`) which are text escapes, not color literals, and must not inflate the count.
 */
function countHexInText(text) {
  const regex = /(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Count the gate-relevant hex literals in a single .css file. For the SSOT
 * definition file (globals.css), hexes on a `--token:` definition line are the
 * sanctioned source-of-truth values and are NOT counted; everything else (usage
 * hexes in `@layer` rules, comment hexes) still counts. All other component .css
 * files count every hex. (Whole-file registries are filtered out before this.)
 */
function countCssHexLiterals(fullPath, text) {
  if (!isSsotDefinitionCss(fullPath)) {
    return countHexInText(text);
  }
  let count = 0;
  for (const line of text.split('\n')) {
    if (CSS_CUSTOM_PROP_DEF.test(line)) continue;
    count += countHexInText(line);
  }
  return count;
}

/**
 * Count raw px/rem `border-radius` literals in a single .css file. Corner radius
 * is governed by the `--radius-*` scale (globals.css @theme / :root SSOT), so
 * component CSS should reference `var(--radius-*)` rather than hardcode a pixel
 * value. This is the radius twin of cssHexLiterals.
 *
 * Counted: any `border-radius` (or corner longhand such as
 * `border-top-left-radius`) whose value contains a raw `<n>px` or `<n>rem`
 * length. NOT counted: `var(--radius-*)` references, `0`, geometric `%` (e.g.
 * `50%` circles), and `calc(var(--radius-*) / ...)`. CSS comments are stripped
 * first so a value documented inside a block comment is not miscounted. The
 * `--radius-*:` token DEFINITIONS in globals.css are custom-property
 * declarations, not `border-radius` properties, so they are naturally excluded
 * (no SSOT carve-out needed).
 */
function countCssBorderRadiusLiterals(text) {
  const noComments = stripCssComments(text);
  const declRe = /border(?:-(?:top|bottom))?(?:-(?:left|right))?-radius\s*:\s*([^;{}]+)/gi;
  let count = 0;
  let match;
  while ((match = declRe.exec(noComments)) !== null) {
    const lengths = match[1].match(/\d*\.?\d+(?:px|rem)\b/g);
    if (lengths) count += lengths.length;
  }
  return count;
}

function collectCssCustomPropertyDefinitions(text) {
  const noComments = stripCssComments(text);
  const definitions = new Set();
  let match;
  CSS_CUSTOM_PROP_DEF_ANYWHERE.lastIndex = 0;
  while ((match = CSS_CUSTOM_PROP_DEF_ANYWHERE.exec(noComments)) !== null) {
    definitions.add(match[1]);
  }
  return definitions;
}

function countUndefinedCssVariableRefsInTexts(cssTexts) {
  const defined = new Set();
  for (const text of cssTexts) {
    for (const name of collectCssCustomPropertyDefinitions(text)) {
      defined.add(name);
    }
  }

  let count = 0;
  for (const text of cssTexts) {
    const noComments = stripCssComments(text);
    CSS_VAR_REF.lastIndex = 0;
    let match;
    while ((match = CSS_VAR_REF.exec(noComments)) !== null) {
      const [, name, hasFallback] = match;
      if (!hasFallback && !defined.has(name)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Tailwind color-utility prefixes that accept a `<color>-<shade>` value. Includes the
 * directional border-color longhands (`border-t/r/b/l/x/y/s/e`) and `ring-offset`, which
 * the original list missed — letting e.g. `border-l-red-500` or `ring-offset-blue-100`
 * slip past the status/brand ratchets. Shared by both counters so the lists never drift.
 */
const COLOR_UTILITY_PREFIX =
  '(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|from|to|via|divide|outline|fill|stroke|placeholder|caret|accent|decoration|shadow)';

/**
 * Count raw red/green/amber/yellow Tailwind utility classes (e.g. `bg-red-600`,
 * `hover:text-green-500`, `border-amber-400`, `bg-yellow-50`). These hues map to
 * semantic status tokens (danger/success/warning), so raw usage is tracked drift.
 * `yellow` has no dedicated token — it routes to `warning` (which aliases amber),
 * matching the Phase 29 yellow->warning migration. A fresh regex avoids stateful lastIndex.
 */
function countRawStatusClassesInText(text) {
  const regex = new RegExp(
    `\\b${COLOR_UTILITY_PREFIX}-(?:red|green|amber|yellow)-\\d{2,3}\\b`,
    'g'
  );
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Count raw blue/sky Tailwind utility classes (e.g. `bg-blue-600`, `text-sky-500`).
 * The brand color is governed by the `primary` token: `blue-*` was the drift removed in
 * the Sky unification, and raw `sky-*` bypasses the token. Both must use `primary-*`.
 * A fresh regex avoids stateful lastIndex.
 */
function countRawBrandClassesInText(text) {
  const regex = new RegExp(
    `\\b${COLOR_UTILITY_PREFIX}-(?:blue|sky)-\\d{2,3}\\b`,
    'g'
  );
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Count raw Tailwind blue/sky RGB(A) function literals. These are the alpha-color
 * twin of raw `blue-*` / `sky-*` utility classes: without a tokenized channel var,
 * a CSS/inline-style alpha value can silently keep old brand hues in place.
 */
function countRawBrandRgbColorsInText(text) {
  const brandTriples = new Set([
    '59,130,246',
    '37,99,235',
    '96,165,250',
    '147,197,253',
    '14,165,233',
    '2,132,199',
    '56,189,248',
    '125,211,252'
  ]);
  const regex = /rgba?\(\s*([^)]+)\)/g;
  let count = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const body = match[1];
    if (body.trim().startsWith('var(')) continue;
    const channelsPart = body.split('/')[0];
    const parts = channelsPart.includes(',')
      ? channelsPart.split(',').slice(0, 3)
      : channelsPart.trim().split(/\s+/).slice(0, 3);
    if (parts.length !== 3) continue;
    const channels = parts.map(part => Number(part.trim()));
    if (channels.every(Number.isFinite) && brandTriples.has(channels.join(','))) {
      count += 1;
    }
  }
  return count;
}

function countCssRawBrandRgbColors(fullPath, text) {
  if (!isSsotDefinitionCss(fullPath)) {
    return countRawBrandRgbColorsInText(text);
  }
  let count = 0;
  for (const line of text.split('\n')) {
    if (CSS_CUSTOM_PROP_DEF.test(line)) continue;
    count += countRawBrandRgbColorsInText(line);
  }
  return count;
}

function walk(dir, deps, predicate, results) {
  let entries;
  try {
    entries = deps.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full, deps, predicate, results);
    } else if (entry.isFile() && predicate(entry.name, full)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Collect current drift counts from disk.
 * @param {object} deps injectable fs-like ({ readdirSync, readFileSync }) and rendererDir for tests.
 */
function collectCounts(deps = {}) {
  const io = {
    readdirSync: deps.readdirSync || fs.readdirSync,
    readFileSync: deps.readFileSync || fs.readFileSync
  };
  const rendererDir = deps.rendererDir || RENDERER_DIR;

  const codeFiles = walk(
    rendererDir,
    io,
    (name, full) =>
      /\.(ts|tsx)$/.test(name) &&
      !isTestFile(name) &&
      !normalizePath(full).includes('/__tests__/'),
    []
  );

  let hardcodedHexLiterals = 0;
  let sanctionedTsxHexLiterals = 0;
  let rawStatusPaletteClasses = 0;
  let rawBrandColorClasses = 0;
  let rawBrandRgbColors = 0;
  for (const file of codeFiles) {
    const text = io.readFileSync(file, 'utf8');
    const hex = countHexInText(text);
    if (isSanctionedTsxRegion(file)) {
      sanctionedTsxHexLiterals += hex;
    } else {
      hardcodedHexLiterals += hex;
    }
    rawStatusPaletteClasses += countRawStatusClassesInText(text);
    rawBrandColorClasses += countRawBrandClassesInText(text);
    rawBrandRgbColors += countRawBrandRgbColorsInText(text);
  }

  const cssFiles = walk(rendererDir, io, name => name.endsWith('.css'), []).filter(
    f => !isSanctionedRegistryCss(f)
  );
  const allCssFiles = walk(rendererDir, io, name => name.endsWith('.css'), []);
  const rendererCssFiles = cssFiles.length;
  const uiDirectoryCssFiles = cssFiles.filter(f => normalizePath(f).includes(UI_DIR_FRAGMENT)).length;

  let cssHexLiterals = 0;
  let cssBorderRadiusLiterals = 0;
  for (const file of cssFiles) {
    const text = io.readFileSync(file, 'utf8');
    cssHexLiterals += countCssHexLiterals(file, text);
    rawBrandRgbColors += countCssRawBrandRgbColors(file, text);
    cssBorderRadiusLiterals += countCssBorderRadiusLiterals(text);
  }
  const undefinedCssVariableRefs = countUndefinedCssVariableRefsInTexts(
    allCssFiles.map(file => io.readFileSync(file, 'utf8'))
  );

  return {
    hardcodedHexLiterals,
    rendererCssFiles,
    uiDirectoryCssFiles,
    rawStatusPaletteClasses,
    rawBrandColorClasses,
    rawBrandRgbColors,
    cssHexLiterals,
    sanctionedTsxHexLiterals,
    cssBorderRadiusLiterals,
    undefinedCssVariableRefs
  };
}

/** Compare current counts against baseline. Ratchet: current may not exceed baseline. */
function evaluate(current, baseline) {
  const metrics = METRICS.map(meta => {
    const cur = current[meta.key] ?? 0;
    const base = baseline[meta.key] ?? 0;
    const delta = cur - base;
    let status = 'ok';
    if (delta > 0) status = 'fail';
    else if (delta < 0) status = 'improved';
    return { ...meta, current: cur, baseline: base, delta, status };
  });
  return {
    metrics,
    failed: metrics.some(m => m.status === 'fail'),
    improved: metrics.some(m => m.status === 'improved')
  };
}

/**
 * Compare the checked-in baseline file against a base-branch reference baseline.
 * Ratchet invariant: a PR may lower a metric baseline, but it may never raise one.
 */
function evaluateBaselineRatchet(candidateBaseline, referenceBaseline) {
  const metrics = METRICS.map(meta => {
    const candidate = candidateBaseline[meta.key] ?? 0;
    const reference = referenceBaseline[meta.key] ?? 0;
    const delta = candidate - reference;
    let status = 'ok';
    if (delta > 0) status = 'fail';
    else if (delta < 0) status = 'improved';
    return { ...meta, current: candidate, baseline: reference, delta, status };
  });
  return {
    metrics,
    failed: metrics.some(m => m.status === 'fail'),
    improved: metrics.some(m => m.status === 'improved')
  };
}

function statusIcon(status) {
  if (status === 'fail') return '🔴';
  if (status === 'improved') return '✅';
  return '🟢';
}

function formatDelta(delta) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return '0';
}

function buildMarkdownReport(evaluation, baselineRatchetEvaluation = null) {
  const { metrics, failed, improved } = evaluation;
  const baselineFailed = baselineRatchetEvaluation?.failed ?? false;
  const baselineImproved = baselineRatchetEvaluation?.improved ?? false;
  const title = failed || baselineFailed
    ? '## 🚨 Design System Check FAILED — drift increased'
    : '## ✅ Design System Check PASSED';

  const summary = [
    '> Ratchet gate: design-system drift counts may only go **down**, never up.',
    '> Baselines live in `scripts/design-system-baseline.json` and are frozen per metric.',
    baselineRatchetEvaluation
      ? '> CI also compares this PR baseline to the base-branch baseline, so a PR cannot raise its own ceiling.'
      : null
  ].filter(Boolean).join('\n');

  const header = '| Metric | Current | Baseline | Δ | Status |';
  const divider = '| --- | --- | --- | --- | --- |';
  const rows = metrics
    .map(
      m =>
        `| ${m.label} | ${m.current} | ${m.baseline} | ${formatDelta(m.delta)} | ${statusIcon(m.status)} |`
    )
    .join('\n');

  let md = `${title}\n\n${summary}\n\n${header}\n${divider}\n${rows}\n\n`;

  const baselineRegressions = baselineRatchetEvaluation?.metrics.filter(m => m.status === 'fail') ?? [];
  if (baselineRegressions.length) {
    md += '### 🔴 Baseline increases\n\n';
    for (const m of baselineRegressions) {
      md += `- **${m.label}** baseline was raised by ${formatDelta(m.delta)} (PR baseline ${m.current}, base baseline ${m.baseline}). ${m.hint}\n`;
    }
    md += '\n> **Action required:** restore or lower `scripts/design-system-baseline.json`; ';
    md += 'a PR baseline may only stay the same or ratchet down from the base branch.\n\n';
  }

  const regressions = metrics.filter(m => m.status === 'fail');
  if (regressions.length) {
    md += '### 🔴 Regressions\n\n';
    for (const m of regressions) {
      md += `- **${m.label}** grew by ${formatDelta(m.delta)} (now ${m.current}, baseline ${m.baseline}). ${m.hint}\n`;
    }
    md += '\n> **Action required:** remove the new drift instead of raising the baseline. ';
    md += 'The baseline may only ratchet down.\n\n';
  }

  const improvements = metrics.filter(m => m.status === 'improved');
  if (improvements.length) {
    md += '<details>\n<summary>Improvements (please re-freeze the baseline lower)</summary>\n\n';
    for (const m of improvements) {
      md += `- **${m.label}** dropped to ${m.current} (baseline ${m.baseline}). Run \`npm run check:design -- --update-baseline\` to lock it in.\n`;
    }
    md += '\n</details>\n\n';
  }

  if (baselineImproved) {
    md += '<details>\n<summary>Baseline ratchets in this PR</summary>\n\n';
    for (const m of baselineRatchetEvaluation.metrics.filter(x => x.status === 'improved')) {
      md += `- **${m.label}** baseline ratcheted down from ${m.baseline} to ${m.current}.\n`;
    }
    md += '\n</details>\n\n';
  }

  if (!failed && !improved && !baselineFailed && !baselineImproved) {
    md += '_No design-system drift. All metrics at baseline._\n\n';
  }

  md += '<details>\n<summary>Legend</summary>\n\n';
  md += '- ✅ Below baseline (improvement — re-freeze lower)\n';
  md += '- 🟢 At baseline\n';
  md += '- 🔴 Above baseline (new drift — blocked)\n';
  md += '</details>\n';
  return md;
}

function parseArgs(argv) {
  const result = { outputPath: null, measure: false, updateBaseline: false, referenceBaselinePath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--measure') result.measure = true;
    else if (arg === '--update-baseline') result.updateBaseline = true;
    else if (arg === '--reference-baseline') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --reference-baseline');
      result.referenceBaselinePath = value;
      i += 1;
    }
    else if (arg === '--output') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --output');
      result.outputPath = value;
      i += 1;
    }
  }
  return result;
}

function readBaseline(baselinePath = BASELINE_PATH) {
  const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  return raw.metrics || {};
}

/** Ratchet the baseline DOWN to current counts. Never raises a value. */
function ratchetBaseline(current, baselinePath = BASELINE_PATH) {
  const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  raw.metrics = raw.metrics || {};
  const changes = [];
  for (const meta of METRICS) {
    const cur = current[meta.key] ?? 0;
    const base = raw.metrics[meta.key] ?? cur;
    if (cur < base) {
      raw.metrics[meta.key] = cur;
      changes.push({ key: meta.key, from: base, to: cur });
    }
  }
  if (changes.length) {
    raw.frozenAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(baselinePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  }
  return changes;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const current = collectCounts();

  if (args.measure) {
    console.log(JSON.stringify(current, null, 2));
    process.exit(0);
  }

  if (args.updateBaseline) {
    const changes = ratchetBaseline(current);
    if (changes.length) {
      for (const c of changes) {
        console.log(`Ratcheted ${c.key}: ${c.from} -> ${c.to}`);
      }
    } else {
      console.log('No baseline changes; counts are at or above baseline.');
    }
    process.exit(0);
  }

  const baseline = readBaseline();
  const evaluation = evaluate(current, baseline);
  const baselineRatchetEvaluation = args.referenceBaselinePath
    ? evaluateBaselineRatchet(baseline, readBaseline(path.resolve(ROOT, args.referenceBaselinePath)))
    : null;
  const failed = evaluation.failed || (baselineRatchetEvaluation?.failed ?? false);

  if (args.outputPath) {
    fs.writeFileSync(path.resolve(ROOT, args.outputPath), buildMarkdownReport(evaluation, baselineRatchetEvaluation), 'utf8');
  } else if (failed) {
    console.error('');
    console.error('DESIGN SYSTEM CHECK FAILED: drift increased above baseline');
    for (const m of evaluation.metrics.filter(x => x.status === 'fail')) {
      console.error(`  ${m.label}: ${m.current} (baseline ${m.baseline}, +${m.delta})`);
    }
    console.error('');
    console.error('Fix the new drift; do not raise scripts/design-system-baseline.json.');
    if (baselineRatchetEvaluation?.failed) {
      for (const m of baselineRatchetEvaluation.metrics.filter(x => x.status === 'fail')) {
        console.error(`  ${m.label} baseline: ${m.current} (base ${m.baseline}, +${m.delta})`);
      }
      console.error('Restore or lower scripts/design-system-baseline.json; PR baselines may not increase.');
    }
    console.error('');
  } else {
    console.log('Design system check passed (all metrics at or below baseline).');
    for (const m of evaluation.metrics) {
      console.log(`  ${m.label}: ${m.current} / ${m.baseline}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizePath,
  isTestFile,
  isSanctionedRegistryCss,
  isSsotDefinitionCss,
  isSanctionedTsxRegion,
  countHexInText,
  countCssHexLiterals,
  countCssBorderRadiusLiterals,
  stripCssComments,
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
};
