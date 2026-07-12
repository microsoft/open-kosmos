#!/usr/bin/env node
'use strict';

// Diff-aware per-file coverage gate.
//
// For every source file added or modified in a PR, this script reads the
// Istanbul/v8 coverage summary (coverage/coverage-final.json) and verifies that
// the file meets the minimum thresholds for lines, functions, branches, and
// statements. A changed file that has no coverage data is treated as 0% and
// fails the gate.
//
// Scope: only files matching the `include` globs in coverage-threshold-config
// (default `src/**/*.{ts,tsx}`) are evaluated. This mirrors the Vitest coverage
// `include` so root-level tooling files (vitest.config.ts, webpack.*.ts, etc.)
// — which can never produce unit-test coverage — are never gated. Exempt
// patterns (tests, type declarations, configs) and an explicit allowlist are
// additionally skipped.
//
// Usage:
//   node scripts/check-coverage.js --base-ref <sha> --head-ref <sha> [--output report.md]
//   node scripts/check-coverage.js --staged-only [--output report.md]
//
// Exit code: 0 when all changed files pass, 1 when any file is below threshold.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'coverage-threshold-config.json');
const COVERAGE_PATH = path.join(ROOT, 'coverage', 'coverage-final.json');
const CODE_EXTENSIONS = new Set(['.ts', '.tsx']);
const METRICS = ['lines', 'functions', 'branches', 'statements'];
const DEFAULT_INCLUDE = ['src/**/*.ts', 'src/**/*.tsx'];

function flattenCoverageAllowlist(config) {
  return new Set((config.allowlist ?? []).map(normalizePath));
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function readArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function parseArgs(argv) {
  const result = { stagedOnly: false, baseRef: null, headRef: null, outputPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--staged-only') {
      result.stagedOnly = true;
    } else if (arg === '--base-ref') {
      result.baseRef = readArgValue(argv, i, '--base-ref');
      i += 1;
    } else if (arg === '--head-ref') {
      result.headRef = readArgValue(argv, i, '--head-ref');
      i += 1;
    } else if (arg === '--output') {
      result.outputPath = readArgValue(argv, i, '--output');
      i += 1;
    }
  }
  return result;
}

function globToRegex(pattern) {
  // Order matters: replace the literal glob `?` first, otherwise the `?` we
  // emit for the optional `(.+/)?` directory group below would be clobbered.
  const body = pattern
    .replace(/\./g, '\\.')
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${body}$`);
}

function matchGlob(filePath, pattern) {
  return globToRegex(pattern).test(filePath);
}

function matchesAny(filePath, patterns) {
  return patterns.some(p => matchGlob(filePath, p));
}

// Return the list of code files added/modified/renamed in the diff range.
// `--diff-filter=ACMR` includes renames so a renamed-and-modified source file
// is still evaluated (git reports the new path with --name-only).
function getChangedFiles(args, runGit = defaultRunGit) {
  let gitArgs = null;
  if (args.baseRef && args.headRef) {
    gitArgs = ['diff', '--name-only', '--diff-filter=ACMR', '--find-renames', `${args.baseRef}...${args.headRef}`];
  } else if (args.stagedOnly) {
    gitArgs = ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--find-renames'];
  } else {
    throw new Error('Specify --base-ref/--head-ref or --staged-only');
  }
  return runGit(gitArgs)
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizePath)
    .filter(f => CODE_EXTENSIONS.has(path.extname(f)));
}

function defaultRunGit(gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' });
}

function readBaseFile(args, relPath, runGit = defaultRunGit) {
  if (args.baseRef && args.headRef) {
    return runGit(['show', `${args.baseRef}:${relPath}`]);
  }
  if (args.stagedOnly) {
    return runGit(['show', `HEAD:${relPath}`]);
  }
  throw new Error('Specify --base-ref/--head-ref or --staged-only');
}

function getAddedCoverageAllowlistEntries(args, currentConfig, runGit = defaultRunGit) {
  let baseRaw;
  try {
    baseRaw = readBaseFile(args, 'scripts/coverage-threshold-config.json', runGit);
  } catch {
    baseRaw = '{}';
  }

  const baseAllowlist = flattenCoverageAllowlist(JSON.parse(baseRaw));
  const currentAllowlist = flattenCoverageAllowlist(currentConfig);
  return [...currentAllowlist].filter(file => !baseAllowlist.has(file)).sort();
}

// Percentage helper: 100% when there is nothing to cover (vacuously satisfied).
function pct(covered, total) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

// Compute per-file metrics from a single Istanbul/v8 file coverage entry.
function computeFileMetrics(entry) {
  // Statements
  const sValues = Object.values(entry.s ?? {});
  const statementsTotal = sValues.length;
  const statementsCovered = sValues.filter(c => c > 0).length;

  // Functions
  const fValues = Object.values(entry.f ?? {});
  const functionsTotal = fValues.length;
  const functionsCovered = fValues.filter(c => c > 0).length;

  // Branches (each branch entry is an array of per-path hit counts)
  let branchesTotal = 0;
  let branchesCovered = 0;
  for (const counts of Object.values(entry.b ?? {})) {
    for (const c of counts) {
      branchesTotal += 1;
      if (c > 0) branchesCovered += 1;
    }
  }

  // Lines: derived from statementMap. A source line is covered when any
  // statement starting on it was executed.
  const lineHits = new Map();
  const statementMap = entry.statementMap ?? {};
  for (const [id, loc] of Object.entries(statementMap)) {
    const line = loc.start && loc.start.line;
    if (!line) continue;
    const hit = (entry.s?.[id] ?? 0) > 0;
    lineHits.set(line, (lineHits.get(line) || false) || hit);
  }
  const linesTotal = lineHits.size;
  let linesCovered = 0;
  for (const hit of lineHits.values()) if (hit) linesCovered += 1;

  return {
    lines: pct(linesCovered, linesTotal),
    functions: pct(functionsCovered, functionsTotal),
    branches: pct(branchesCovered, branchesTotal),
    statements: pct(statementsCovered, statementsTotal),
  };
}

// Build a lookup from normalized repo-relative path -> coverage entry.
function loadCoverageByRelPath(coveragePath = COVERAGE_PATH, root = ROOT) {
  if (!fs.existsSync(coveragePath)) return new Map();
  const raw = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  const byRel = new Map();
  for (const [absPath, entry] of Object.entries(raw)) {
    const rel = normalizePath(path.relative(root, absPath));
    byRel.set(rel, entry);
  }
  return byRel;
}

// Pure evaluation core: given the changed files and coverage map, decide which
// in-scope files pass or fail. No git, no filesystem — fully unit testable.
function evaluateChangedFiles({ changedFiles, coverageByRel, thresholds, includePatterns, exemptPatterns, allowlist }) {
  const results = [];
  for (const file of changedFiles) {
    if (!matchesAny(file, includePatterns)) continue; // out of coverage scope
    if (matchesAny(file, exemptPatterns)) continue;
    if (allowlist.has(file)) continue;

    const entry = coverageByRel.get(file);
    const hasData = Boolean(entry);
    const metrics = hasData
      ? computeFileMetrics(entry)
      : { lines: 0, functions: 0, branches: 0, statements: 0 };

    const failed = METRICS.some(m => metrics[m] < thresholds[m]);
    results.push({ file, metrics, hasData, failed });
  }
  results.sort((a, b) => Number(b.failed) - Number(a.failed) || a.file.localeCompare(b.file));
  return results;
}

function metricIcon(value, threshold) {
  return value >= threshold ? '🟢' : '🔴';
}

function fmtPct(value) {
  return `${value.toFixed(2)}%`;
}

function formatTable(rows, headers) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
  return `${headerLine}\n${divider}${body ? `\n${body}` : ''}`;
}

function buildMarkdownReport(results, thresholds, allowlistAdditions = []) {
  const failures = results.filter(r => r.failed);
  const failed = failures.length > 0 || allowlistAdditions.length > 0;
  const failedCount = failures.length + allowlistAdditions.length;

  const title = failed
    ? `## 🚨 Coverage Check FAILED — ${failedCount} violation(s)`
    : '## ✅ Coverage Check PASSED';

  const summary = [
    `> Minimum per changed file: lines **${thresholds.lines}%**, functions **${thresholds.functions}%**, branches **${thresholds.branches}%**, statements **${thresholds.statements}%**`,
    `> Changed source files evaluated: **${results.length}** | Below threshold: **${failures.length}** | New allowlist entries: **${allowlistAdditions.length}**`,
  ].join('\n');

  let md = `${title}\n\n${summary}\n\n`;

  if (allowlistAdditions.length) {
    md += '### 🔴 Forbidden coverage allowlist additions\n\n';
    md += `${formatTable(allowlistAdditions.map(file => [`\`${file}\``]), ['File'])}\n\n`;
    md += '> **Action required:** remove these allowlist additions and add meaningful tests, refactor for testability, or use a narrow V8 ignore annotation only for truly unreachable lines.\n\n';
  }

  const toRow = r => [
    `\`${r.file}\``,
    `${metricIcon(r.metrics.lines, thresholds.lines)} ${fmtPct(r.metrics.lines)}`,
    `${metricIcon(r.metrics.functions, thresholds.functions)} ${fmtPct(r.metrics.functions)}`,
    `${metricIcon(r.metrics.branches, thresholds.branches)} ${fmtPct(r.metrics.branches)}`,
    `${metricIcon(r.metrics.statements, thresholds.statements)} ${fmtPct(r.metrics.statements)}`,
    r.hasData ? '' : '_no data_',
  ];
  const headers = ['File', 'Lines', 'Functions', 'Branches', 'Statements', 'Note'];

  if (failures.length) {
    md += '### 🔴 Files below threshold\n\n';
    md += `${formatTable(failures.map(toRow), headers)}\n\n`;
    md += '> **Action required:** add tests so each file meets the minimum. Do not add files to the coverage allowlist to bypass this gate.\n\n';
  } else if (results.length === 0) {
    md += '_No changed source files require coverage in this PR._\n\n';
  } else {
    md += '_All changed source files meet the coverage threshold._\n\n';
  }

  const passing = results.filter(r => !r.failed);
  if (passing.length) {
    md += '<details>\n<summary>Passing files</summary>\n\n';
    md += `${formatTable(passing.map(toRow), headers)}\n\n`;
    md += '</details>\n\n';
  }

  md += '<details>\n<summary>Legend</summary>\n\n';
  md += '- 🟢 Meets or exceeds threshold\n';
  md += '- 🔴 Below threshold\n';
  md += '- _no data_ means the changed file has no coverage and is scored as 0%.\n';
  md += '</details>\n';
  return md;
}

function printConsoleFailure(results) {
  const failures = results.filter(r => r.failed);
  if (!failures.length) return;
  console.error('');
  console.error('COVERAGE CHECK FAILED: files below threshold');
  console.error('  Lines  | Funcs  | Branch | Stmts  | File');
  console.error('  -------|--------|--------|--------|--------------------------------------------');
  for (const r of failures) {
    const m = r.metrics;
    console.error(
      `  ${fmtPct(m.lines).padStart(6)} | ${fmtPct(m.functions).padStart(6)} | ${fmtPct(m.branches).padStart(6)} | ${fmtPct(m.statements).padStart(6)} | ${r.file}`
    );
  }
  console.error('');
}

function printAllowlistAdditionFailure(allowlistAdditions) {
  if (!allowlistAdditions.length) return;
  console.error('');
  console.error('COVERAGE CHECK FAILED: new allowlist entries are forbidden');
  for (const file of allowlistAdditions) {
    console.error(`  ${file}`);
  }
  console.error('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const config = {
    thresholds: rawConfig.thresholds,
    includePatterns: rawConfig.include ?? DEFAULT_INCLUDE,
    exemptPatterns: rawConfig.exempt_patterns ?? [],
    allowlist: flattenCoverageAllowlist(rawConfig),
  };
  const changedFiles = getChangedFiles(args);
  const coverageByRel = loadCoverageByRelPath();
  const allowlistAdditions = getAddedCoverageAllowlistEntries(args, rawConfig);

  const results = evaluateChangedFiles({
    changedFiles,
    coverageByRel,
    thresholds: config.thresholds,
    includePatterns: config.includePatterns,
    exemptPatterns: config.exemptPatterns,
    allowlist: config.allowlist,
  });

  const failed = results.some(r => r.failed) || allowlistAdditions.length > 0;

  if (args.outputPath) {
    fs.writeFileSync(path.resolve(ROOT, args.outputPath), buildMarkdownReport(results, config.thresholds, allowlistAdditions), 'utf8');
  } else if (failed) {
    printConsoleFailure(results);
    printAllowlistAdditionFailure(allowlistAdditions);
  } else {
    console.log(`Coverage check passed (${results.length} changed source file(s) evaluated).`);
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizePath,
  globToRegex,
  matchGlob,
  matchesAny,
  parseArgs,
  getChangedFiles,
  flattenCoverageAllowlist,
  getAddedCoverageAllowlistEntries,
  computeFileMetrics,
  loadCoverageByRelPath,
  evaluateChangedFiles,
  buildMarkdownReport,
};
