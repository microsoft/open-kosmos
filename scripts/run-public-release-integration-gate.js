#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASE = 'origin/main';
const MAX_REPORT_OUTPUT = 12_000;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const WORKSTREAMS = {
  tenant: {
    evidenceId: 'EV-INT-01-TENANT',
    order: 1,
    description: 'Microsoft tenant data and Agency CLI',
  },
  remote: {
    evidenceId: 'EV-INT-02-REMOTE',
    order: 2,
    description: 'Azure Bot and Remote Channel',
  },
  azure: {
    evidenceId: 'EV-INT-03-AZURE',
    order: 3,
    description: 'Azure services and Doctor',
  },
  library: {
    evidenceId: 'EV-INT-04-LIBRARY',
    order: 4,
    description: 'Retired remote distribution paths',
  },
  brand: {
    evidenceId: 'EV-INT-05-BRAND',
    order: 5,
    description: 'OpenKosmos brand migration',
  },
  governance: {
    evidenceId: 'EV-INT-06-GOVERNANCE',
    order: 6,
    description: 'Public governance and workflows',
  },
  final: {
    evidenceId: 'EV-FINAL-01-REPOSITORY',
    order: 7,
    description: 'Final repository-controlled release gates',
  },
};

function sanitizedEnvironment() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArguments(argv) {
  const result = {
    base: DEFAULT_BASE,
    head: 'HEAD',
    includeArtifacts: false,
    includeE2e: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--workstream') {
      result.workstream = readValue(argv, index, argument);
      index += 1;
    } else if (argument === '--base') {
      result.base = readValue(argv, index, argument);
      index += 1;
    } else if (argument === '--head') {
      result.head = readValue(argv, index, argument);
      index += 1;
    } else if (argument === '--output') {
      result.output = readValue(argv, index, argument);
      index += 1;
    } else if (argument === '--include-artifacts') {
      result.includeArtifacts = true;
    } else if (argument === '--include-e2e') {
      result.includeE2e = true;
    } else if (argument === '--dry-run') {
      result.dryRun = true;
    } else if (argument === '--help') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!result.help && !WORKSTREAMS[result.workstream]) {
    throw new Error(`--workstream must be one of: ${Object.keys(WORKSTREAMS).join(', ')}`);
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-public-release-integration-gate.js \\
    --workstream <tenant|remote|azure|library|brand|governance|final> \\
    [--base <ref>] [--head <ref>] [--output <path>] \\
    [--include-e2e] [--include-artifacts] [--dry-run]

Each non-final workstream runs diff validation, impact analysis, the complete Vitest
suite, and typecheck. The final gate adds release scans, coverage, governance checks,
and the Vite build. E2E and packaging are opt-in because they require a suitable host.`);
}

function commandLabel(command) {
  return [command.executable, ...command.args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

function gitCommand(args, name) {
  return { name, executable: 'git', args };
}

function npmCommand(args, name) {
  return { name, executable: NPM, args };
}

function nodeCommand(args, name) {
  return { name, executable: process.execPath, args };
}

function changedFiles(base, head) {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${base}..${head}`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: sanitizedEnvironment(),
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Unable to list changed files: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.split('\n').map((file) => file.trim()).filter(Boolean);
}

function commonCommands(base, head, files) {
  const impactArgs = ['run', 'check:impact', '--', ...files];
  return [
    gitCommand(['diff', '--check', `${base}..${head}`], 'Diff whitespace validation'),
    npmCommand(impactArgs, 'Change impact analysis'),
    npmCommand(['test'], 'Full unit and integration suite'),
    npmCommand(['run', 'typecheck'], 'TypeScript and import checks'),
  ];
}

function finalCommands(base, head, files, args) {
  const commands = commonCommands(base, head, files);
  commands.push(
    npmCommand(['run', 'check:public-release'], 'Public release worktree scan'),
    npmCommand(['run', 'check:design'], 'Design-system governance'),
    npmCommand(['run', 'check:dark-mode', '--', '--base-ref', base], 'Dark-mode governance'),
    npmCommand(['run', 'check:i18n'], 'Internationalization governance'),
    npmCommand(['run', 'build:vite'], 'Vite production build'),
    npmCommand(['run', 'test:coverage'], 'Coverage test run'),
    nodeCommand(
      ['scripts/check-coverage.js', '--base-ref', base, '--head-ref', head],
      'Diff-aware coverage gate',
    ),
    nodeCommand(
      ['scripts/check-file-length.js', '--base-ref', base, '--head-ref', head],
      'File-length gate',
    ),
  );
  if (args.includeE2e) {
    commands.push(npmCommand(['run', 'test:e2e'], 'Retained Electron E2E suite'));
  }
  if (args.includeArtifacts) {
    commands.push(
      npmCommand(['run', 'pack:vite'], 'Unpacked application artifact'),
      npmCommand(['run', 'audit:public-release:artifacts'], 'Artifact content audit'),
    );
  }
  return commands;
}

function truncateOutput(output) {
  const normalized = String(output || '').trim();
  if (normalized.length <= MAX_REPORT_OUTPUT) return normalized;
  return `[truncated to final ${MAX_REPORT_OUTPUT} characters]\n${normalized.slice(-MAX_REPORT_OUTPUT)}`;
}

function runCommand(command, dryRun) {
  const startedAt = Date.now();
  if (dryRun) {
    return {
      ...command,
      label: commandLabel(command),
      status: 'DRY RUN',
      exitCode: null,
      durationMs: 0,
      output: '',
    };
  }

  const result = spawnSync(command.executable, command.args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: sanitizedEnvironment(),
    maxBuffer: 100 * 1024 * 1024,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return {
    ...command,
    label: commandLabel(command),
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    output: truncateOutput(output),
    error: result.error?.message,
  };
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function reportFor({ workstream, base, head, files, results, dryRun }) {
  const failed = results.some((result) => result.status === 'FAIL');
  const lines = [
    `# ${workstream.evidenceId}`,
    '',
    `**Workstream:** ${workstream.description}`,
    `**Range:** \`${base}..${head}\``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Status:** ${dryRun ? 'DRY RUN' : failed ? 'FAIL' : 'PASS'}`,
    `**Changed files:** ${files.length}`,
    '',
    '| Check | Command | Status | Duration (ms) |',
    '|---|---|---|---:|',
    ...results.map((result) => (
      `| ${escapeTableCell(result.name)} | \`${escapeTableCell(result.label)}\` | ${result.status} | ${result.durationMs} |`
    )),
    '',
    '## Command output',
    '',
  ];

  for (const result of results) {
    lines.push(
      `### ${result.name}`,
      '',
      '```text',
      result.error || result.output || '(no output)',
      '```',
      '',
    );
  }
  return { failed, content: `${lines.join('\n')}\n` };
}

function ensureCleanWorktree(dryRun) {
  if (dryRun) return;
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: sanitizedEnvironment(),
  });
  if (result.status !== 0) {
    throw new Error(`Unable to inspect worktree: ${result.stderr.trim()}`);
  }
  if (result.stdout.trim()) {
    throw new Error('Commit integration changes before recording evidence.');
  }
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureCleanWorktree(args.dryRun);
  const workstream = WORKSTREAMS[args.workstream];
  const files = changedFiles(args.base, args.head);
  if (files.length === 0 && !args.dryRun) {
    throw new Error(`No changed files found in ${args.base}..${args.head}.`);
  }

  const commands = args.workstream === 'final'
    ? finalCommands(args.base, args.head, files, args)
    : commonCommands(args.base, args.head, files);
  const results = [];
  for (const command of commands) {
    const result = runCommand(command, args.dryRun);
    results.push(result);
    console.log(`${result.status}: ${result.name}`);
    if (result.status === 'FAIL') break;
  }

  const report = reportFor({
    workstream,
    base: args.base,
    head: args.head,
    files,
    results,
    dryRun: args.dryRun,
  });
  const output = args.output
    || `public-release-evidence-${workstream.evidenceId.toLowerCase()}.md`;
  fs.writeFileSync(path.resolve(ROOT, output), report.content);
  console.log(`Evidence report: ${output}`);
  if (report.failed) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Integration gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  WORKSTREAMS,
  parseArguments,
  commonCommands,
  finalCommands,
  commandLabel,
  reportFor,
};
