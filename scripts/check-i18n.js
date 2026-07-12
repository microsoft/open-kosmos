#!/usr/bin/env node
'use strict';

/**
 * Diff-aware i18n governance gate for renderer-owned UI copy.
 *
 * The gate scans changed renderer source files, not only added diff lines, so
 * i18n-focused PRs cannot leave existing hardcoded copy in files they touch.
 * A frozen baseline suppresses known legacy/technical false positives; new
 * baseline entries are rejected once the baseline exists on the target branch.
 * It catches the high-risk cases that should never enter new UI code:
 *   - hardcoded JSX text
 *   - hardcoded user-facing string attributes
 *   - hardcoded toast / confirm / alert / setError messages
 *   - fixed DEFAULT_UI_LANGUAGE translation calls in renderer UI
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCANNED_ROOTS = ['src/renderer/'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const MAX_SNIPPET_LENGTH = 120;
const BASELINE_REL_PATH = 'scripts/i18n-hardcoded-baseline.json';
const BASELINE_PATH = path.join(ROOT, BASELINE_REL_PATH);

const STRING_ATTRIBUTES = [
  'aria-label',
  'placeholder',
  'title',
  'alt',
  'label',
  'description',
];

const TECHNICAL_TERMS = new Set([
  'api',
  'azure',
  'bing',
  'bun',
  'claude',
  'code',
  'copilot',
  'css',
  'edge',
  'electron',
  'git',
  'github',
  'gpt',
  'html',
  'http',
  'https',
  'json',
  'openkosmos',
  'mcp',
  'microsoft',
  'node',
  'oauth',
  'openai',
  'outlook',
  'pm',
  'python',
  'sharepoint',
  'studio',
  'teams',
  'typescript',
  'ui',
  'url',
  'uv',
  'yaml',
]);

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function runGit(args) {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    baseRef: null,
    headRef: null,
    stagedOnly: false,
    outputPath: null,
    updateBaseline: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-ref') {
      args.baseRef = readArgValue(argv, i, '--base-ref');
      i += 1;
    } else if (arg === '--head-ref') {
      args.headRef = readArgValue(argv, i, '--head-ref');
      i += 1;
    } else if (arg === '--staged-only') {
      args.stagedOnly = true;
    } else if (arg === '--output') {
      args.outputPath = readArgValue(argv, i, '--output');
      i += 1;
    } else if (arg === '--update-baseline') {
      args.updateBaseline = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if ((args.baseRef && !args.headRef) || (!args.baseRef && args.headRef)) {
    throw new Error('--base-ref and --head-ref must be provided together');
  }

  return args;
}

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/check-i18n.js
  node scripts/check-i18n.js --staged-only
  node scripts/check-i18n.js --base-ref origin/main --head-ref HEAD
  node scripts/check-i18n.js --base-ref <base> --head-ref <head> --output i18n-report.md
  node scripts/check-i18n.js --update-baseline
`);
  process.exit(0);
}

function pickFirstNonEmptyDiff(...diffs) {
  return diffs.find(diff => diff.trim()) || '';
}

function getDiff(args) {
  if (args.baseRef && args.headRef) {
    return runGit([
      'diff',
      '--unified=0',
      '--diff-filter=ACMRT',
      `${args.baseRef}...${args.headRef}`,
      '--',
      'src/renderer',
    ]);
  }

  if (args.stagedOnly) {
    return runGit([
      'diff',
      '--cached',
      '--unified=0',
      '--diff-filter=ACMRT',
      '--',
      'src/renderer',
    ]);
  }

  const workingTreeDiff = runGit([
    'diff',
    '--unified=0',
    '--diff-filter=ACMRT',
    '--',
    'src/renderer',
  ]);
  const stagedDiff = runGit([
    'diff',
    '--cached',
    '--unified=0',
    '--diff-filter=ACMRT',
    '--',
    'src/renderer',
  ]);
  const localDiff = pickFirstNonEmptyDiff(workingTreeDiff, stagedDiff);
  if (localDiff) return localDiff;

  try {
    runGit(['rev-parse', '--verify', 'origin/main']);
    return runGit([
      'diff',
      '--unified=0',
      '--diff-filter=ACMRT',
      'origin/main...HEAD',
      '--',
      'src/renderer',
    ]);
  } catch {
    return '';
  }
}

function shouldScanFile(relPath) {
  const normalized = normalizePath(relPath);
  if (!SCANNED_ROOTS.some(root => normalized.startsWith(root))) return false;
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
  if (normalized.endsWith('.d.ts')) return false;
  if (normalized.includes('/__tests__/')) return false;
  if (/\.(test|spec)\.[tj]sx?$/.test(normalized)) return false;
  if (normalized.includes('/lib/i18n/locales/')) return false;
  return true;
}

function parseAddedLines(diffText) {
  const records = [];
  let currentFile = null;
  let newLineNumber = 0;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      const file = normalizePath(rawLine.slice('+++ b/'.length).trim());
      currentFile = shouldScanFile(file) ? file : null;
      continue;
    }

    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/\+(\d+)(?:,\d+)?/);
      newLineNumber = match ? Number(match[1]) : 0;
      continue;
    }

    if (!currentFile) {
      if (!rawLine.startsWith('-') && !rawLine.startsWith('\\')) {
        newLineNumber += rawLine.startsWith('+') ? 1 : 0;
      }
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      records.push({
        file: currentFile,
        lineNumber: newLineNumber,
        text: rawLine.slice(1),
      });
      newLineNumber += 1;
      continue;
    }

    if (!rawLine.startsWith('-') && !rawLine.startsWith('\\')) {
      newLineNumber += 1;
    }
  }

  return records;
}

function parseChangedFiles(diffText) {
  const files = [];
  const seen = new Set();

  for (const rawLine of diffText.split('\n')) {
    if (!rawLine.startsWith('+++ b/')) {
      continue;
    }

    const file = normalizePath(rawLine.slice('+++ b/'.length).trim());
    if (!shouldScanFile(file) || seen.has(file)) {
      continue;
    }

    seen.add(file);
    files.push(file);
  }

  return files;
}

function readCurrentFile(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8');
}

function parseFullFileRecords(files, readFile = readCurrentFile) {
  const records = [];

  for (const file of files) {
    const content = readFile(file);
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      records.push({
        file,
        lineNumber: index + 1,
        text: lines[index],
      });
    }
  }

  return records;
}

function normalizeLiteral(value) {
  return value
    .replace(/\\[nrt]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isI18nKey(value) {
  return /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){2,}$/i.test(value);
}

function isTechnicalIdentifier(value) {
  if (/^(?:https?|file|mailto):/i.test(value)) return true;
  if (/^(?:\.{0,2}\/|#|@|--)/.test(value)) return true;
  if (/^[A-Z0-9._/-]{2,}$/.test(value)) return true;
  if (/^[a-z0-9._/-]+$/.test(value) && /[._/-]|\d/.test(value)) return true;

  const words = value
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .split(/[\s/+:-]+/)
    .filter(Boolean);

  return words.length > 0 && words.every(word => TECHNICAL_TERMS.has(word));
}

function shouldIgnoreLiteral(rawValue) {
  const value = normalizeLiteral(rawValue);
  if (!value) return true;
  if (value.length <= 1) return true;
  if (value.includes('${')) return true;
  if (isI18nKey(value)) return true;
  if (isTechnicalIdentifier(value)) return true;
  if (/^[\d\s.,:+%()[\]{}'"`!?|/\\-]+$/.test(value)) return true;
  return false;
}

function addFinding(findings, record, rule, message, value) {
  findings.push({
    file: record.file,
    lineNumber: record.lineNumber,
    rule,
    message,
    value: normalizeLiteral(value),
    source: record.text.trim().slice(0, MAX_SNIPPET_LENGTH),
  });
}

function scanRecord(record) {
  const line = record.text;
  const trimmed = line.trim();
  const findings = [];

  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return findings;
  }

  if (line.includes('i18n-check-ignore')) {
    return findings;
  }

  if (line.includes('translate(DEFAULT_UI_LANGUAGE')) {
    addFinding(
      findings,
      record,
      'fixed-default-language',
      'Renderer UI must use the active language, not DEFAULT_UI_LANGUAGE.',
      'translate(DEFAULT_UI_LANGUAGE, ...)',
    );
  }

  const attrPattern = new RegExp(
    `\\b(?:${STRING_ATTRIBUTES.join('|')})\\s*=\\s*["'\`]([^"'\`{}]+)["'\`]`,
    'g',
  );
  for (const match of line.matchAll(attrPattern)) {
    if (!shouldIgnoreLiteral(match[1])) {
      addFinding(
        findings,
        record,
        'hardcoded-string-attribute',
        'User-facing string attributes must use t(...) or a localized helper.',
        match[1],
      );
    }
  }

  if (record.file.endsWith('.tsx')) {
    const completeTagPattern = /<([A-Za-z][\w.:]*)\b[^>]*>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*<\/\1>/g;
    for (const match of line.matchAll(completeTagPattern)) {
      const tagName = match[1].toLowerCase();
      if (['code', 'kbd', 'samp'].includes(tagName)) {
        continue;
      }

      if (!shouldIgnoreLiteral(match[2])) {
        addFinding(
          findings,
          record,
          'hardcoded-jsx-text',
          'JSX text owned by the renderer must use t(...).',
          match[2],
        );
      }
    }

    const fragmentPattern = /<>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*<\/>/g;
    for (const match of line.matchAll(fragmentPattern)) {
      if (!shouldIgnoreLiteral(match[1])) {
        addFinding(
          findings,
          record,
          'hardcoded-jsx-text',
          'JSX text owned by the renderer must use t(...).',
          match[1],
        );
      }
    }
  }

  const callPattern = /\b(?:showSuccess|showError|showToast|setError|window\.confirm|confirm|window\.alert|alert)\s*\(\s*(["'`])((?:(?!\1|\$\{).)+)\1/g;
  for (const match of line.matchAll(callPattern)) {
    if (!shouldIgnoreLiteral(match[2])) {
      addFinding(
        findings,
        record,
        'hardcoded-message-call',
        'Toast, dialog, alert, confirm, and error messages must be localized.',
        match[2],
      );
    }
  }

  return findings;
}

function scanRecords(records) {
  return records.flatMap(scanRecord);
}

function findingKey(finding) {
  return [
    normalizePath(finding.file),
    finding.rule,
    normalizeLiteral(finding.value),
    String(finding.source || '').trim(),
  ].join('\u0000');
}

function normalizeBaselineEntry(entry) {
  return {
    file: normalizePath(entry.file),
    rule: entry.rule,
    value: normalizeLiteral(entry.value),
    source: String(entry.source || '').trim(),
    lineNumber: typeof entry.lineNumber === 'number' ? entry.lineNumber : undefined,
  };
}

function parseBaseline(content) {
  if (!content || !content.trim()) {
    return [];
  }

  const parsed = JSON.parse(content);
  const findings = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.findings)
      ? parsed.findings
      : [];

  return findings.map(normalizeBaselineEntry);
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return [];
  }

  return parseBaseline(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function buildBaselineSet(entries) {
  return new Set(entries.map(findingKey));
}

function filterBaselineFindings(findings, baselineEntries) {
  const baselineSet = buildBaselineSet(baselineEntries);
  const unresolved = [];
  const ignored = [];

  for (const finding of findings) {
    if (baselineSet.has(findingKey(finding))) {
      ignored.push(finding);
    } else {
      unresolved.push(finding);
    }
  }

  return { unresolved, ignored };
}

function readBaseFile(args, relPath, gitRunner = runGit) {
  try {
    if (args.baseRef && args.headRef) {
      return gitRunner(['show', `${args.baseRef}:${relPath}`]);
    }

    if (args.stagedOnly) {
      return gitRunner(['show', `HEAD:${relPath}`]);
    }
  } catch {
    return null;
  }

  return null;
}

function getAddedBaselineEntries(args, currentEntries = loadBaseline(), gitRunner = runGit) {
  const baseContent = readBaseFile(args, BASELINE_REL_PATH, gitRunner);
  if (baseContent === null) {
    return [];
  }

  const baseSet = buildBaselineSet(parseBaseline(baseContent));
  return currentEntries.filter(entry => !baseSet.has(findingKey(entry)));
}

function buildBaselineFile(findings) {
  const entries = findings
    .map(finding => ({
      file: normalizePath(finding.file),
      lineNumber: finding.lineNumber,
      rule: finding.rule,
      value: normalizeLiteral(finding.value),
      source: String(finding.source || '').trim(),
    }))
    .sort((a, b) => (
      a.file.localeCompare(b.file) ||
      a.lineNumber - b.lineNumber ||
      a.rule.localeCompare(b.rule) ||
      a.value.localeCompare(b.value)
    ));

  return `${JSON.stringify({
    description: 'Frozen i18n hardcoded-copy baseline for known legacy or technical false positives. Do not add entries to make new UI copy pass; localize renderer-owned text instead.',
    scope: 'src/renderer changed .ts/.tsx files, excluding tests and locale catalogs',
    frozenAt: new Date().toISOString().slice(0, 10),
    findings: entries,
  }, null, 2)}\n`;
}

function buildReport(findings, scannedFileCount, scannedLineCount, ignoredBaselineCount = 0, addedBaselineEntries = []) {
  const lines = [
    '# I18n Check Report',
    '',
    `Scanned changed renderer source files: **${scannedFileCount}**.`,
    `Scanned renderer source lines: **${scannedLineCount}**.`,
    `Ignored baseline findings: **${ignoredBaselineCount}**.`,
    '',
  ];

  if (findings.length === 0 && addedBaselineEntries.length === 0) {
    lines.push('✅ No i18n governance issues found.');
    return lines.join('\n');
  }

  if (findings.length > 0) {
    lines.push(`❌ Found **${findings.length}** i18n governance issue(s).`);
    lines.push('');
    lines.push('| File | Rule | Literal | Source |');
    lines.push('|------|------|---------|--------|');

    for (const finding of findings) {
      const file = `${finding.file}:${finding.lineNumber}`;
      lines.push(`| \`${escapeMarkdown(file)}\` | ${escapeMarkdown(finding.rule)} | \`${escapeMarkdown(finding.value)}\` | \`${escapeMarkdown(finding.source)}\` |`);
    }

    lines.push('');
    lines.push('Fix by moving renderer-owned UI copy into the English and Simplified Chinese locale catalogs and reading it through `useI18n()` / `t(...)` or a localized helper. Use `i18n-check-ignore` only for a deliberate technical/runtime literal with a nearby reason.');
  }

  if (addedBaselineEntries.length > 0) {
    lines.push('');
    lines.push(`❌ Found **${addedBaselineEntries.length}** new i18n baseline entr${addedBaselineEntries.length === 1 ? 'y' : 'ies'}.`);
    lines.push('');
    lines.push('Do not grow `scripts/i18n-hardcoded-baseline.json`; localize the UI copy or add a narrow inline `i18n-check-ignore` for deliberate technical/runtime literals.');
  }

  return lines.join('\n');
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\n/g, ' ');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const diffText = getDiff(args);
  const changedFiles = parseChangedFiles(diffText);
  const records = parseFullFileRecords(changedFiles);
  const rawFindings = scanRecords(records);

  if (args.updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, buildBaselineFile(rawFindings), 'utf8');
    console.log(`Updated ${BASELINE_REL_PATH} with ${rawFindings.length} finding(s).`);
    return;
  }

  const baselineEntries = loadBaseline();
  const { unresolved: findings, ignored } = filterBaselineFindings(rawFindings, baselineEntries);
  const addedBaselineEntries = getAddedBaselineEntries(args, baselineEntries);
  const report = buildReport(findings, changedFiles.length, records.length, ignored.length, addedBaselineEntries);

  if (args.outputPath) {
    fs.writeFileSync(path.resolve(ROOT, args.outputPath), `${report}\n`, 'utf8');
  }

  console.log(report);

  if (findings.length > 0 || addedBaselineEntries.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

module.exports = {
  BASELINE_REL_PATH,
  normalizePath,
  parseArgs,
  getDiff,
  pickFirstNonEmptyDiff,
  shouldScanFile,
  parseAddedLines,
  parseChangedFiles,
  parseFullFileRecords,
  normalizeLiteral,
  shouldIgnoreLiteral,
  scanRecord,
  scanRecords,
  findingKey,
  parseBaseline,
  filterBaselineFindings,
  readBaseFile,
  getAddedBaselineEntries,
  buildBaselineFile,
  buildReport,
};
