#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLEANUP_RECORD = 'docs/open-source-release-cleanup.md';
const SCRIPT_PATH = 'scripts/check-public-release.js';
const INTEGRATION_SCRIPT_PATH = 'scripts/run-public-release-integration-gate.js';
const EXCLUSIONS_PATH = 'scripts/public-release-scan-exclusions.json';
const DEFAULT_REPORT = 'public-release-scan-report.md';
const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;

const BUILTIN_EXCLUSIONS = new Set([
  CLEANUP_RECORD,
  SCRIPT_PATH,
  INTEGRATION_SCRIPT_PATH,
  EXCLUSIONS_PATH,
]);

const APPROVED_GOVERNANCE_PATHS = new Set([
  'CODE_OF_CONDUCT.md',
  'README.md',
  'docs/open-source-release-templates/CODE_OF_CONDUCT.md',
  'scripts/check-public-governance.js',
  'scripts/__tests__/public-release-gates.test.ts',
]);

const LEGACY_LIBRARY_COMPATIBILITY_PATHS = new Set([
  'docs/agent-hooks-prd.md',
  'docs/agent-hooks-tech-doc.md',
  'docs/public-skill-registration-tech-doc.md',
  'src/main/lib/agentHooks/ai.prompt.md',
  'src/main/lib/agentHooks/schemas.ts',
  'src/main/lib/mcpRuntime/builtinTools/updateAgentTool.ts',
  'src/main/lib/mcpRuntime/builtinTools/updateMcpServerTool.ts',
  'src/main/lib/mcpRuntime/mcpClientManager.ts',
  'src/main/lib/mcpRuntime/vscodeMcpClient/config/types.ts',
  'src/main/lib/skill/ai.prompt.md',
  'src/main/lib/skill/skillManager.ts',
  'src/main/lib/userDataADO/ai.prompt.md',
  'src/main/lib/userDataADO/pathUtils.ts',
  'src/main/lib/userDataADO/profileCacheManager.ts',
  'src/main/lib/userDataADO/profileSanitizer.ts',
  'src/main/lib/userDataADO/skillsConfigManager.ts',
  'src/main/lib/userDataADO/skillsFileStore.ts',
  'src/main/lib/userDataADO/types/profile.ts',
  'src/renderer/components/chat/agent-area/AgentList.tsx',
  'src/renderer/components/chat/agent-editor/AgentBasicTab.tsx',
  'src/renderer/components/chat/agent-editor/types.ts',
  'src/renderer/components/common/AgentAvatar.tsx',
  'src/renderer/lib/mcp/mcpClientCacheManager.ts',
  'src/renderer/lib/userData/types/index.ts',
  'src/renderer/types/mcpTypes.ts',
  'src/shared/agentHooks/profileTypes.ts',
]);

const PATTERN_FAMILIES = [
  {
    id: 'PM_STUDIO',
    description: 'PM Studio branding',
    pattern: /pm[-_ ]?studio/gi,
  },
  {
    id: 'LEGACY_CDN',
    description: 'Retired download-service URLs and configuration',
    pattern: /cdn\.kosmos-ai\.com|(?:development|production)_base_cdn_url|release_cdn_url/gi,
  },
  {
    id: 'MICROSOFT_TENANT_DATA',
    description: 'Microsoft tenant-data and private service endpoints',
    pattern: /graph\.microsoft\.com|login\.(?:microsoftonline|windows)\.(?:com|net)|teams\.(?:microsoft\.com|cloud\.microsoft)|chatsvc|api\.spaces\.skype\.com|substrate\.office\.com|sharepoint\.com|dev\.azure\.com|api\.microsoft\.ai/gi,
  },
  {
    id: 'AZURE_HOSTED',
    description: 'Azure-hosted product services and telemetry',
    pattern: /azurewebsites\.net|applicationinsights|appinsights|disable_analytics|isanalyticsready|preset_model_gpt|relay_service_url|llm:callazureopenai|azureopenaimodelapi/gi,
  },
  {
    id: 'TENANT_RUNTIME',
    description: 'Agency CLI and Microsoft data runtime contracts',
    pattern: /agencycli|agency_cli|microsoftgraph|alwaysallowm365authrequest|graphclientid|browser-teams|azure-ad-app/gi,
  },
  {
    id: 'REMOTE_CHANNEL',
    description: 'Azure Bot and Remote Channel contracts',
    pattern: /remotechannels|remote_channel|manage_remote_channel|notifyoncompletion|source\.type\s*=\s*["']remote["']/gi,
  },
  {
    id: 'DOCTOR',
    description: 'Doctor product and private issue submission',
    pattern: /(?:\.\.?[/\\]|(?:src|preload|renderer|shared|resources)[/\\](?:[\w.-]+[/\\])*)doctor(?=[/\\.'"]|$)|\bdoctor:[\w-]+|\bDoctor(?:Manager|Service|Tool|State|Page|Panel|Dialog|Status|Report)\b|\bopenkosmosFeatureDoctor\b|create_github_issue|github\/issue-token/gim,
  },
  {
    id: 'REMOTE_LIBRARY',
    description: 'Agent, Skill, and MCP remote Library contracts',
    pattern: /agentlibrary|skilllibrary|mcplibrary|assetsfetcher|startupupdate|in-library|agent_lib\.json|mcp_lib\.json|skills_lib\.json/gi,
  },
  {
    id: 'PRIVATE_IDENTITY',
    description: 'Private repositories and internal identity defaults',
    pattern: /gim-home\/kosmos|ai-microsoft\/kosmos\.app|_microsoft/gi,
  },
  {
    id: 'LEGACY_BRAND',
    description: 'Retired product identity',
    pattern: /(?<!open)(?<!open-)\bkosmos\b|(?<!open)(?<!open-)kosmos[-_]/gi,
  },
  {
    id: 'SECRET_MATERIAL',
    description: 'Likely embedded credential material',
    pattern: /(?:client[_-]?secret|access[_-]?token|connection[_-]?string)\s*[:=]\s*["'][^"'${}\s][^"']{7,}["']/gi,
  },
];

const REMOVED_PATHS = [
  'azure-bot',
  '.github/workflows/deploy-azure-bot.yml',
  '.github/workflows/pr-events-notify-kosmos-dev-for-luna.yml',
  '.github/workflows/release.yml',
  'src/main/lib/analytics',
  'src/main/lib/assetsFetcher',
  'src/main/lib/azureCli',
  'src/main/lib/doctor',
  'src/main/lib/microsoftGraph',
  'src/main/lib/remoteChannel',
  'src/main/lib/startupUpdate',
  'src/shared/ipc/analytics.ts',
  'src/shared/ipc/doctor.ts',
  'src/shared/ipc/remoteChannel.ts',
  'src/shared/ipc/teams.ts',
  'src/preload/analytics',
  'src/preload/doctor',
  'src/preload/remoteChannel',
  'src/preload/teams',
  'src/renderer/components/doctor',
  'src/renderer/components/msalAuth',
  'src/renderer/ipc/doctor.ts',
  'src/renderer/ipc/remoteChannel.ts',
  'src/renderer/ipc/teams.ts',
  'public/indexeddb-test.html',
  'docs/remote-control.md',
  'resources/microsoftGraph',
  'resources/examples/agent/agent_lib.json',
  'resources/examples/mcp_lib/mcp_lib.json',
];

const REQUIRED_PUBLIC_FILES = [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'SUPPORT.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
];

function sanitizedEnvironment() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: sanitizedEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function readArguments(argv) {
  const result = {
    mode: 'worktree',
    reportPath: DEFAULT_REPORT,
    roots: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      result.mode = argv[index + 1];
      index += 1;
    } else if (argument === '--output') {
      result.reportPath = argv[index + 1];
      index += 1;
    } else if (argument === '--root') {
      result.roots.push(argv[index + 1]);
      index += 1;
    } else if (argument === '--help') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!['worktree', 'refs', 'artifacts'].includes(result.mode)) {
    throw new Error(`Unsupported mode: ${result.mode}`);
  }
  if (result.mode === 'artifacts' && result.roots.length === 0) {
    throw new Error('Artifact mode requires at least one --root path.');
  }

  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/check-public-release.js
  node scripts/check-public-release.js --mode refs
  node scripts/check-public-release.js --mode artifacts --root <path> [--root <path>]

Options:
  --output <path>  Markdown report path (default: ${DEFAULT_REPORT})
  --help           Show this help`);
}

function loadExclusions() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, EXCLUSIONS_PATH), 'utf8'));
  const exclusions = config.exclusions ?? [];

  for (const exclusion of exclusions) {
    if (
      !PATTERN_FAMILIES.some((family) => family.id === exclusion.family)
      || typeof exclusion.path !== 'string'
      || typeof exclusion.linePattern !== 'string'
      || typeof exclusion.owner !== 'string'
      || exclusion.owner.trim() === ''
      || typeof exclusion.justification !== 'string'
      || exclusion.justification.trim() === ''
    ) {
      throw new Error(`Invalid reviewed exclusion: ${JSON.stringify(exclusion)}`);
    }
  }

  return exclusions.map((exclusion) => ({
    ...exclusion,
    lineRegex: new RegExp(exclusion.linePattern),
  }));
}

function isReviewedExclusion(exclusions, familyId, relativePath, line) {
  return exclusions.some((exclusion) => (
    exclusion.family === familyId
    && exclusion.path === relativePath
    && exclusion.lineRegex.test(line)
  ));
}

function isUserDataMigrationCompatibility(familyId, relativePath, line) {
  if (familyId !== 'LEGACY_BRAND') return false;
  return relativePath === 'src/main/bootstrapUserData.ts'
    || relativePath === 'src/main/__tests__/bootstrapUserData.coverage.test.ts'
    || relativePath === 'ai.prompt/arch-main.md';
}

function isApprovedGovernanceContent(familyId, relativePath) {
  if (relativePath === 'scripts/__tests__/public-release-gates.test.ts') return true;
  return APPROVED_GOVERNANCE_PATHS.has(relativePath)
    && (familyId === 'PRIVATE_IDENTITY' || familyId === 'LEGACY_BRAND');
}

function isRetainedMetadataCompatibility(familyId, relativePath, line) {
  if (familyId === 'REMOTE_LIBRARY') {
    const isCompatibilityEvidence = /(?:\bIN-LIBRARY\b|remoteVersion)/i.test(line);
    return isCompatibilityEvidence && (
      relativePath.includes('/__tests__/')
      || LEGACY_LIBRARY_COMPATIBILITY_PATHS.has(relativePath)
    );
  }
  if (familyId === 'REMOTE_CHANNEL' && /\bremoteChannels\b/.test(line)) {
    return relativePath === 'src/main/lib/userDataADO/profileMigration.ts'
      || relativePath === 'src/main/lib/userDataADO/ai.prompt.md'
      || relativePath.includes('src/main/lib/userDataADO/__tests__/profileMigration');
  }
  if (familyId === 'MICROSOFT_TENANT_DATA') {
    return relativePath === 'src/main/lib/mcpRuntime/auth/OpenKosmosTokenCache.ts'
      || relativePath === 'src/main/lib/mcpRuntime/auth/__tests__/OpenKosmosTokenCache.test.ts';
  }
  if (familyId === 'TENANT_RUNTIME') {
    return relativePath === 'src/main/lib/userDataADO/__tests__/appCacheManager.test.ts';
  }
  return false;
}

function isSyntheticCredentialFixture(familyId, relativePath, line) {
  if (familyId !== 'SECRET_MATERIAL') return false;
  if (/@OPENKOSMOS_[A-Z0-9_]+/.test(line)) return true;
  if (relativePath === 'scripts/__tests__/public-release-gates.test.ts') return true;
  if (!relativePath.includes('/__tests__/')) return false;

  return [...line.matchAll(/["']([^"']+)["']/g)].some((match) => {
    const value = match[1];
    return value.length <= 31
      && /^[a-z0-9_-]+$/i.test(value)
      && /(?:token|tok|secret|client|expiry|expired|refreshed|access|mutated)/i.test(value);
  });
}

function isBundledCompatibilityArtifact(familyId, relativePath, line) {
  const isBundledMain = relativePath === 'dist-vite/main/main.js'
    || /\/dist\/main\/main\.js$/.test(relativePath);
  if (isBundledMain) {
    if (familyId === 'LEGACY_BRAND') {
      return /LEGACY_USER_DATA_NAME\s*=\s*["']kosmos-app["']/.test(line);
    }
    if (familyId === 'REMOTE_LIBRARY') {
      return /\bIN-LIBRARY\b/.test(line);
    }
    if (familyId === 'REMOTE_CHANNEL') {
      return /delete profileCopy\.remoteChannels/.test(line);
    }
    if (familyId === 'MICROSOFT_TENANT_DATA') {
      return /^\s*["']chatsvc["'],?\s*$/.test(line);
    }
  }
  return familyId === 'REMOTE_CHANNEL'
    && /(?:^dist-vite|\/dist)\/renderer\/assets\/[^/]*worker[^/]*\.js$/.test(relativePath)
    && /\b_remoteChannels\b/.test(line);
}

function isThirdPartyArtifactContent(familyId, relativePath) {
  return relativePath.includes('/node_modules/')
    && (familyId === 'PRIVATE_IDENTITY' || familyId === 'SECRET_MATERIAL');
}

function trackedFiles() {
  return runGit(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(normalizePath);
}

function walkFiles(rootPath) {
  const absoluteRoot = path.resolve(ROOT, rootPath);
  if (!fs.existsSync(absoluteRoot)) {
    return { files: [], missingRoot: normalizePath(rootPath) };
  }

  const files = [];
  const pending = [absoluteRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(normalizePath(path.relative(ROOT, absolutePath)));
      }
    }
  }
  return { files, missingRoot: null };
}

function looksBinary(buffer) {
  const sampleLength = Math.min(buffer.length, 8_000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function lineForIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

function excerptLine(content, index) {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const nextLine = content.indexOf('\n', index);
  const lineEnd = nextLine === -1 ? content.length : nextLine;
  return content.slice(lineStart, lineEnd).trim().slice(0, 240);
}

function fullLineForIndex(content, index) {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const nextLine = content.indexOf('\n', index);
  const lineEnd = nextLine === -1 ? content.length : nextLine;
  return content.slice(lineStart, lineEnd).trim();
}

function scanContent(relativePath, content, exclusions) {
  const findings = [];
  for (const family of PATTERN_FAMILIES) {
    family.pattern.lastIndex = 0;
    let match;
    while ((match = family.pattern.exec(content)) !== null) {
      const line = excerptLine(content, match.index);
      const policyLine = fullLineForIndex(content, match.index);
      if (
        !isReviewedExclusion(exclusions, family.id, relativePath, policyLine)
        && !isUserDataMigrationCompatibility(family.id, relativePath, policyLine)
        && !isApprovedGovernanceContent(family.id, relativePath)
        && !isRetainedMetadataCompatibility(family.id, relativePath, policyLine)
        && !isSyntheticCredentialFixture(family.id, relativePath, policyLine)
        && !isBundledCompatibilityArtifact(family.id, relativePath, policyLine)
        && !isThirdPartyArtifactContent(family.id, relativePath)
      ) {
        findings.push({
          family: family.id,
          description: family.description,
          path: relativePath,
          line: lineForIndex(content, match.index),
          excerpt: line,
        });
      }
      if (match[0].length === 0) family.pattern.lastIndex += 1;
    }
  }
  return findings;
}

function scanFiles(files, exclusions) {
  const findings = [];
  const binaryFiles = [];
  const oversizedFiles = [];

  for (const relativePath of files) {
    if (BUILTIN_EXCLUSIONS.has(relativePath)) continue;
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;

    const stat = fs.statSync(absolutePath);
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      oversizedFiles.push(relativePath);
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (looksBinary(buffer)) {
      binaryFiles.push(relativePath);
      continue;
    }

    findings.push(...scanContent(relativePath, buffer.toString('utf8'), exclusions));
  }

  return { findings, binaryFiles, oversizedFiles };
}

function inspectStructure() {
  const existingRemovedPaths = REMOVED_PATHS.filter((relativePath) => (
    fs.existsSync(path.join(ROOT, relativePath))
  ));
  const missingPublicFiles = REQUIRED_PUBLIC_FILES.filter((relativePath) => (
    !fs.existsSync(path.join(ROOT, relativePath))
  ));
  return { existingRemovedPaths, missingPublicFiles };
}

function auditRefs() {
  const refs = runGit(['for-each-ref', '--format=%(refname)'])
    .split('\n')
    .filter(Boolean);
  const pattern = /pm[-_ ]?studio|\bkosmos\b|kosmos[-_]/i;
  return refs.filter((ref) => pattern.test(ref));
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildReport(result) {
  const lines = [
    '# Public Release Scan Report',
    '',
    `**Mode:** ${result.mode}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Repository-controlled status:** ${result.failed ? 'FAIL' : 'PASS'}`,
    '',
  ];

  if (result.mode === 'refs') {
    lines.push(
      'Git reference cleanup is an external publication control and does not change the repository-controlled status.',
      '',
      '| Reference requiring review |',
      '|---|',
      ...result.refs.map((ref) => `| \`${escapeTableCell(ref)}\` |`),
      '',
    );
    return lines.join('\n');
  }

  lines.push(
    `Scanned ${result.fileCount} file(s); found ${result.findings.length} unreviewed text match(es).`,
    '',
    '| Family | File | Line | Excerpt |',
    '|---|---|---:|---|',
    ...result.findings.map((finding) => (
      `| ${finding.family} | \`${escapeTableCell(finding.path)}\` | ${finding.line} | ${escapeTableCell(finding.excerpt)} |`
    )),
    '',
  );

  if (result.mode === 'worktree') {
    lines.push(
      '## Structural checks',
      '',
      `Removed paths still present: ${result.existingRemovedPaths.length}`,
      '',
      ...result.existingRemovedPaths.map((relativePath) => `- \`${relativePath}\``),
      '',
      `Required public files missing: ${result.missingPublicFiles.length}`,
      '',
      ...result.missingPublicFiles.map((relativePath) => `- \`${relativePath}\``),
      '',
    );
  }

  lines.push(
    '## Files requiring artifact/manual inspection',
    '',
    ...result.binaryFiles.map((relativePath) => `- Binary: \`${relativePath}\``),
    ...result.oversizedFiles.map((relativePath) => `- Oversized: \`${relativePath}\``),
    ...result.missingRoots.map((relativePath) => `- Missing artifact root: \`${relativePath}\``),
    '',
  );
  return lines.join('\n');
}

function writeReport(reportPath, content) {
  const absolutePath = path.resolve(ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${content}\n`);
}

function main() {
  const args = readArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.mode === 'refs') {
    const refs = auditRefs();
    const result = { mode: args.mode, refs, failed: false };
    writeReport(args.reportPath, buildReport(result));
    console.log(`Public release reference audit found ${refs.length} reference(s) requiring external review.`);
    return;
  }

  const exclusions = loadExclusions();
  const missingRoots = [];
  let files;
  if (args.mode === 'worktree') {
    files = trackedFiles();
  } else {
    files = [];
    for (const rootPath of args.roots) {
      const walked = walkFiles(rootPath);
      files.push(...walked.files);
      if (walked.missingRoot) missingRoots.push(walked.missingRoot);
    }
  }

  const scan = scanFiles([...new Set(files)].sort(), exclusions);
  const structure = args.mode === 'worktree'
    ? inspectStructure()
    : { existingRemovedPaths: [], missingPublicFiles: [] };
  const failed = scan.findings.length > 0
    || structure.existingRemovedPaths.length > 0
    || structure.missingPublicFiles.length > 0
    || missingRoots.length > 0;
  const result = {
    mode: args.mode,
    fileCount: files.length,
    missingRoots,
    failed,
    ...scan,
    ...structure,
  };

  writeReport(args.reportPath, buildReport(result));
  console.log(
    `Public release ${args.mode} scan ${failed ? 'failed' : 'passed'}: `
    + `${scan.findings.length} match(es), `
    + `${structure.existingRemovedPaths.length} removed path(s), `
    + `${structure.missingPublicFiles.length} missing public file(s).`,
  );
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Public release scan failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PATTERN_FAMILIES,
  REMOVED_PATHS,
  REQUIRED_PUBLIC_FILES,
  readArguments,
  isReviewedExclusion,
  scanContent,
  scanFiles,
  inspectStructure,
  buildReport,
};
