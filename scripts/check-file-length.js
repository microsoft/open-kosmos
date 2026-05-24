#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'file-length-allowlist.json');
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'dist-vite', '.webpack', 'out', 'build', 'release', '.git', 'browser-control']);

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const DEFAULT_MAX_LINES = config.rules.default;
const MAX_ALLOWLIST_NET_GROWTH = config.rules.allowlisted_max_net_growth_lines ?? 50;
const EXEMPT_PATTERNS = config.exempt_patterns;
const ALLOWLIST = new Set(config.allowlist.map(f => normalizePath(f)));
const OVERRIDES = (config.overrides ?? []).map(o => ({
  pattern: o.pattern,
  regex: globToRegex(o.pattern),
  maxLines: o.max_lines,
  allowlist: new Set((o.allowlist ?? []).map(f => normalizePath(f)))
}));

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function parseArgs(argv) {
  const result = {
    stagedOnly: false,
    baseRef: null,
    headRef: null,
    outputPath: null
  };

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
  const body = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

function matchGlob(filePath, pattern) {
  return globToRegex(pattern).test(filePath);
}

function isExempt(relPath) {
  return EXEMPT_PATTERNS.some(p => matchGlob(relPath, p));
}

function getMaxLinesFor(relPath) {
  for (const o of OVERRIDES) {
    if (o.regex.test(relPath)) return o.maxLines;
  }
  return DEFAULT_MAX_LINES;
}

function isAllowlisted(relPath) {
  return ALLOWLIST.has(relPath);
}

function getOverrideAllowlistEntry(relPath) {
  for (const o of OVERRIDES) {
    if (o.regex.test(relPath) && o.allowlist.has(relPath)) return o;
  }
  return null;
}

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      results.push(...walkDir(path.join(dir, entry.name)));
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
  return output
    .split('\n')
    .map(s => s.trim())
    .filter(f => f && CODE_EXTENSIONS.has(path.extname(f)))
    .map(f => path.resolve(ROOT, f));
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length === 0) return 0;
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

function parseNumstatLine(line) {
  const parts = line.split('\t');
  if (parts.length < 3) return null;

  const addedRaw = parts[0];
  const deletedRaw = parts[1];
  const fileRaw = parts.slice(2).join('\t').trim();

  if (!fileRaw || addedRaw === '-' || deletedRaw === '-') return null;

  const added = Number(addedRaw);
  const deleted = Number(deletedRaw);
  if (!Number.isFinite(added) || !Number.isFinite(deleted)) return null;

  return { file: normalizePath(fileRaw), added, deleted };
}

function getDiffStats(args) {
  let cmd = null;

  if (args.baseRef && args.headRef) {
    cmd = `git diff --numstat --diff-filter=ACM ${shellQuote(`${args.baseRef}...${args.headRef}`)}`;
  } else if (args.stagedOnly) {
    cmd = 'git diff --cached --numstat --diff-filter=ACM';
  }

  if (!cmd) return [];

  const output = execSync(cmd, { encoding: 'utf8' });
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseNumstatLine)
    .filter(Boolean);
}

function formatTable(rows, headers) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
  return `${headerLine}\n${divider}${body ? `\n${body}` : ''}`;
}

function growthIcon(netGrowth, limit) {
  if (netGrowth > limit) return '🔴';
  if (netGrowth > limit * 0.6) return '🟡';
  if (netGrowth > 0) return '🟢';
  return '✅';
}

function buildMarkdownReport(data) {
  const hardCount = data.hardViolations.length;
  const growthCount = data.allowlistedGrowthViolations.length;
  const failed = hardCount > 0 || growthCount > 0;
  const totalViolations = hardCount + growthCount;

  // --- Title ---
  const title = failed
    ? `## 🚨 File Length Check FAILED — ${totalViolations} violation(s)`
    : '## ✅ File Length Check PASSED';

  // --- Summary blockquote ---
  const overrideSummary = OVERRIDES.length
    ? ` (overrides: ${OVERRIDES.map(o => `\`${o.pattern}\`→${o.maxLines}`).join(', ')})`
    : '';
  const summary = [
    `> Hard limit: code files ≤ **${DEFAULT_MAX_LINES}** lines${overrideSummary} | Allowlisted growth: net ≤ **+${MAX_ALLOWLIST_NET_GROWTH}** lines per PR`,
    `> Violations: hard-limit **${hardCount}**, allowlisted-growth **${growthCount}**`
  ].join('\n');

  // --- Hard-limit violation table ---
  const hardRows = data.hardViolations.map(v => [
    `\`${v.file}\``,
    `**${v.lines}**`,
    String(v.limit),
    '🔴'
  ]);

  // --- Allowlisted growth violation table ---
  const growthRows = data.allowlistedGrowthViolations.map(v => [
    `\`${v.file}\``,
    `**+${v.netGrowth}**`,
    `+${MAX_ALLOWLIST_NET_GROWTH}`,
    '🔴'
  ]);

  // --- Allowlisted within-limit info table ---
  const infoRows = data.allowlistedGrowthWithinLimit.map(v => [
    `\`${v.file}\``,
    `+${v.netGrowth}`,
    `+${MAX_ALLOWLIST_NET_GROWTH}`,
    growthIcon(v.netGrowth, MAX_ALLOWLIST_NET_GROWTH)
  ]);

  // --- Assemble report ---
  let md = `${title}\n\n${summary}\n\n`;

  if (hardRows.length) {
    md += '### 🔴 Hard limit violations\n\n';
    md += `${formatTable(hardRows, ['File', 'Lines', 'Limit', 'Status'])}\n\n`;
    md += `> **Action required:** refactor these files to stay under their respective limits, or add to \`scripts/file-length-allowlist.json\` if splitting is not feasible.\n\n`;
  }

  if (growthRows.length) {
    md += `### 🔴 Allowlisted file growth violations (net > +${MAX_ALLOWLIST_NET_GROWTH} lines)\n\n`;
    md += `${formatTable(growthRows, ['File', 'Net Growth', 'Limit', 'Status'])}\n\n`;
    md += `> **Action required:** these legacy files are already over their line limit. This PR adds too many lines — please refactor or split before merging.\n\n`;
  }

  if (!failed) {
    md += '_No violations found. All files are within policy._\n\n';
  }

  if (infoRows.length) {
    md += '<details>\n';
    md += '<summary>Allowlisted file changes within limit</summary>\n\n';
    md += `${formatTable(infoRows, ['File', 'Net Growth', 'Limit', 'Status'])}\n\n`;
    md += '</details>\n\n';
  }

  md += '<details>\n';
  md += '<summary>Legend</summary>\n\n';
  md += '- ✅ Size decreased or unchanged\n';
  md += `- 🟢 Slight increase (< 60% of +${MAX_ALLOWLIST_NET_GROWTH} limit)\n`;
  md += `- 🟡 Warning (≥ 60% of +${MAX_ALLOWLIST_NET_GROWTH} limit)\n`;
  md += '- 🔴 FAILED (exceeds limit)\n';
  md += `\n_File length policy: code files ≤ ${DEFAULT_MAX_LINES} lines (with per-glob overrides); allowlisted legacy files may not grow by more than +${MAX_ALLOWLIST_NET_GROWTH} net lines per PR._\n`;
  md += '</details>\n';

  return md;
}

function printConsoleFailure(data) {
  if (data.hardViolations.length) {
    console.error('');
    console.error('FILE LENGTH CHECK FAILED: hard limit violations');
    console.error('  Lines  | Limit | File');
    console.error('  -------|-------|----------------------------------------------------');
    for (const v of data.hardViolations) {
      console.error(`  ${String(v.lines).padStart(5)}  | ${String(v.limit).padStart(5)} | ${v.file}`);
    }
  }

  if (data.allowlistedGrowthViolations.length) {
    console.error('');
    console.error(`FILE LENGTH CHECK FAILED: allowlisted file net growth exceeds ${MAX_ALLOWLIST_NET_GROWTH}`);
    console.error('  Net +  | File');
    console.error('  -------|------------------------------------------------------------');
    for (const v of data.allowlistedGrowthViolations) {
      console.error(`  ${String(v.netGrowth).padStart(5)}  | ${v.file}`);
    }
  }

  console.error('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const files = args.stagedOnly ? getStagedFiles() : walkDir(ROOT);
  const hardViolations = [];

  for (const absPath of files) {
    const relPath = normalizePath(path.relative(ROOT, absPath));

    if (isExempt(relPath)) continue;
    if (isAllowlisted(relPath)) continue;

    const overrideEntry = getOverrideAllowlistEntry(relPath);
    const maxLines = overrideEntry ? DEFAULT_MAX_LINES : getMaxLinesFor(relPath);
    const lines = countLines(absPath);
    if (lines > maxLines) {
      hardViolations.push({ file: relPath, lines, limit: maxLines });
    }
  }

  hardViolations.sort((a, b) => b.lines - a.lines);

  const diffStats = getDiffStats(args);
  const allowlistedGrowthViolations = [];
  const allowlistedGrowthWithinLimit = [];

  for (const item of diffStats) {
    if (!CODE_EXTENSIONS.has(path.extname(item.file))) continue;
    if (isExempt(item.file)) continue;
    if (!isAllowlisted(item.file) && !getOverrideAllowlistEntry(item.file)) continue;

    const netGrowth = Math.max(0, item.added - item.deleted);
    const record = { file: item.file, netGrowth, added: item.added, deleted: item.deleted };

    if (netGrowth > MAX_ALLOWLIST_NET_GROWTH) {
      allowlistedGrowthViolations.push(record);
    } else {
      allowlistedGrowthWithinLimit.push(record);
    }
  }

  allowlistedGrowthViolations.sort((a, b) => b.netGrowth - a.netGrowth || a.file.localeCompare(b.file));
  allowlistedGrowthWithinLimit.sort((a, b) => b.netGrowth - a.netGrowth || a.file.localeCompare(b.file));

  const result = {
    hardViolations,
    allowlistedGrowthViolations,
    allowlistedGrowthWithinLimit
  };

  const failed = hardViolations.length > 0 || allowlistedGrowthViolations.length > 0;

  if (args.outputPath) {
    const report = buildMarkdownReport(result);
    fs.writeFileSync(path.resolve(ROOT, args.outputPath), report, 'utf8');
  }

  if (!args.outputPath) {
    if (!failed) {
      const mode = args.stagedOnly ? 'staged files' : 'all files';
      console.log(`File length check passed (${mode}, default limit: ${DEFAULT_MAX_LINES} lines)`);
    } else {
      printConsoleFailure(result);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
