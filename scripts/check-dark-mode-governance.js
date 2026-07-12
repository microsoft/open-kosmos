#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GIT_DIFF_MAX_BUFFER = 256 * 1024 * 1024;

const args = process.argv.slice(2);
let outputPath = null;
let baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--output') {
    outputPath = args[i + 1];
    i += 1;
  } else if (args[i] === '--base-ref') {
    baseRef = args[i + 1];
    i += 1;
  }
}

function readRelative(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function includesAll(content, terms) {
  return terms.every((term) => content.includes(term));
}

const RAW_STATUS_RGBA_PATTERN = /\brgba\(\s*(?:245,\s*158,\s*11|34,\s*197,\s*94|248,\s*113,\s*113|22,\s*101,\s*52|120,\s*53,\s*15|127,\s*29,\s*29)\s*,/;

function collectAddedRawStatusRgbaViolations(
  gitRunner = execFileSync,
  selectedBaseRef = baseRef,
) {
  let diff;
  try {
    diff = gitRunner(
      'git',
      ['diff', '--diff-filter=AMR', '--unified=0', selectedBaseRef, '--', 'src/renderer'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: GIT_DIFF_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    return {
      error: `Unable to inspect renderer diff against ${selectedBaseRef}: ${error.message}`,
      violations: [],
    };
  }

  const violations = [];
  let currentFile = null;
  let newLine = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (RAW_STATUS_RGBA_PATTERN.test(line)) {
        violations.push(`${currentFile}:${newLine}`);
      }
      newLine += 1;
    } else if (!line.startsWith('-') && !line.startsWith('diff --git') && !line.startsWith('index ')) {
      newLine += 1;
    }
  }

  return { error: null, violations };
}

function createRawStatusRgbaResult() {
  const { error, violations } = collectAddedRawStatusRgbaViolations();
  if (error) {
    return {
      name: 'raw status RGBA diff',
      file: 'src/renderer',
      passed: false,
      detail: error,
    };
  }

  if (violations.length === 0) {
    return {
      name: 'raw status RGBA diff',
      file: 'src/renderer',
      passed: true,
      detail: 'OK',
    };
  }

  return {
    name: 'raw status RGBA diff',
    file: 'src/renderer',
    passed: false,
    detail: `New themeable status colors must use tokens, not raw rgba literals: ${violations.join(', ')}`,
  };
}

const checks = [
  {
    name: 'package script',
    file: 'package.json',
    test: () => {
      const pkg = JSON.parse(readRelative('package.json'));
      return pkg.scripts?.['check:dark-mode'] === 'node scripts/check-dark-mode-governance.js';
    },
    message: 'package.json must expose check:dark-mode.',
  },
  {
    name: 'CI workflow',
    file: '.github/workflows/pr-design-system.yml',
    terms: ['npm run check:dark-mode', 'dark-mode-governance-report.md'],
    message: 'The PR design-system workflow must run and report check:dark-mode.',
  },
  {
    name: 'development governance guide',
    file: 'docs/dark-mode-governance.md',
    terms: [
      'Light baseline is sacred',
      'Token-first adaptation',
      'Required dark-mode audit coverage',
      'startup validation',
      'npm run check:dark-mode',
      'PR review guide',
    ],
    message: 'The dark-mode governance guide must document development, audit, CI, and review rules.',
  },
  {
    name: 'PRD governance',
    file: 'docs/dark-mode-prd.md',
    terms: [
      'Light baseline',
      'manifest-driven',
      'real Electron',
      'npm run check:dark-mode',
      'docs/dark-mode-governance.md',
    ],
    message: 'The PRD must keep dark-mode governance and acceptance criteria explicit.',
  },
  {
    name: 'technical design governance',
    file: 'docs/dark-mode-tech-doc.md',
    terms: [
      'docs/dark-mode-governance.md',
      'npm run check:dark-mode',
      'Light baseline',
      'real Electron visual audit',
      'manifest-driven',
    ],
    message: 'The technical design must document dark-mode development, audit, and verification governance.',
  },
  {
    name: 'design-system reference',
    file: 'docs/design-system/README.md',
    terms: [
      'docs/dark-mode-governance.md',
      'npm run check:dark-mode',
      'Light baseline',
      'Token-first',
    ],
    message: 'The design-system reference must link the dark-mode governance contract.',
  },
  {
    name: 'dark-mode review contract',
    file: 'docs/dark-mode-governance.md',
    terms: [
      'Light baseline preservation',
      'Token-first implementation',
      'Single theme contract',
      'Real UI coverage',
      'npm run check:dark-mode',
    ],
    message: 'The public dark-mode review contract must cover baseline, tokens, contracts, audits, and CI.',
  },
  {
    name: 'design-system AI doc',
    file: 'ai.prompt/design-system.md',
    terms: [
      'check:dark-mode',
      'docs/dark-mode-governance.md',
      'PR review guide',
    ],
    message: 'The design-system AI governance doc must reference the dark-mode governance gate.',
  },
];

function main() {
  const results = checks.map((check) => {
    const filePath = path.join(ROOT, check.file);
    if (!fs.existsSync(filePath)) {
      return { ...check, passed: false, detail: `Missing file: ${check.file}` };
    }

    try {
      const passed = check.test ? check.test() : includesAll(readRelative(check.file), check.terms);
      return { ...check, passed, detail: passed ? 'OK' : check.message };
    } catch (error) {
      return { ...check, passed: false, detail: error.message };
    }
  });
  results.push(createRawStatusRgbaResult());

  const failed = results.filter((result) => !result.passed);
  const report = [
    '# Dark Mode Governance Check',
    '',
    failed.length === 0
      ? 'Dark mode governance check passed.'
      : `Dark mode governance check failed with ${failed.length} issue(s).`,
    '',
    '| Check | File | Status | Detail |',
    '|---|---|---|---|',
    ...results.map((result) => {
      const status = result.passed ? 'PASS' : 'FAIL';
      return `| ${result.name} | \`${result.file}\` | ${status} | ${result.detail} |`;
    }),
    '',
  ].join('\n');

  if (outputPath) {
    fs.writeFileSync(path.resolve(ROOT, outputPath), report);
  }

  if (failed.length === 0) {
    console.log('Dark mode governance check passed.');
    return;
  }

  console.error(report);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  GIT_DIFF_MAX_BUFFER,
  collectAddedRawStatusRgbaViolations,
  main,
};
