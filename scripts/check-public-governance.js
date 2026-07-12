const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const failures = []

const normalizeText = (content) => {
  const normalizedLines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
  return `${normalizedLines.replace(/\n*$/g, '')}\n`
}
const read = (relativePath) => normalizeText(fs.readFileSync(path.join(root, relativePath), 'utf8'))
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex')
const containsFiles = (relativePath) => {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) return false
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) return true
  return fs.readdirSync(absolutePath, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? containsFiles(path.posix.join(relativePath, entry.name))
      : true,
  )
}
const ignoredManifestDirectories = new Set(['.git', 'node_modules', 'coverage', 'dist', 'dist-vite', 'release'])
const ignoredManifestFiles = new Set([
  'public-release-scan-report.md',
  'public-release-ref-report.md',
  'public-release-artifact-report.md',
])
const findNamedFiles = (directory, fileName) =>
  fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredManifestDirectories.has(entry.name)) return []
    const child = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) return findNamedFiles(child, fileName)
    return entry.name === fileName ? [child] : []
  })

const templatePairs = {
  LICENSE: 'docs/open-source-release-templates/LICENSE',
  NOTICE: 'docs/open-source-release-templates/NOTICE',
  'SECURITY.md': 'docs/open-source-release-templates/SECURITY.md',
  'SUPPORT.md': 'docs/open-source-release-templates/SUPPORT.md',
  'CODE_OF_CONDUCT.md': 'docs/open-source-release-templates/CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md': 'docs/open-source-release-templates/CONTRIBUTING.md',
  '.github/ISSUE_TEMPLATE/issue.md': 'docs/open-source-release-templates/ISSUE_TEMPLATE.md',
}

const checksums = JSON.parse(read('scripts/governance-template-checksums.json'))
for (const checksumGroup of ['canonicalUpstream', 'activeTemplates']) {
  for (const [template, expected] of Object.entries(checksums[checksumGroup])) {
    const actual = sha256(read(template))
    if (actual !== expected) {
      failures.push(`${template} normalized checksum changed: expected ${expected}, received ${actual}`)
    }
  }
}

for (const [active, template] of Object.entries(templatePairs)) {
  if (!exists(active)) {
    failures.push(`Missing active governance file: ${active}`)
  } else if (read(active) !== read(template)) {
    failures.push(`${active} must be an exact copy of ${template}`)
  }
}

const prohibitedPaths = [
  '.github/acl',
  '.github/compliance',
  '.github/CODEOWNERS',
  '.github/policies',
  '.github/ISSUE_TEMPLATE/JitAccess.yml',
  '.github/prompts',
  '.github/workflows/deploy-azure-bot.yml',
  '.github/workflows/pr-events-notify-kosmos-dev-for-luna.yml',
  'CHANGELOG.md',
  'docs/dashboard',
  'docs/example',
  'docs/agency_mcp_servers',
  'docs/global_system_prompt.md',
  'resources/examples/agent',
  'resources/examples/mcp_lib',
  'resources/examples/skills_lib',
  'resources/examples/app.json',
  'resources/examples/releases',
]

for (const prohibitedPath of prohibitedPaths) {
  if (containsFiles(prohibitedPath)) {
    failures.push(`Internal governance or generated content remains: ${prohibitedPath}`)
  }
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
if (packageJson.license !== 'MIT' || packageLock.packages?.['']?.license !== 'MIT') {
  failures.push('Root package.json and package-lock.json must declare the MIT license')
}
for (const manifest of findNamedFiles('.', 'package.json')) {
  const metadata = JSON.parse(read(manifest))
  if (metadata.license !== 'MIT') {
    failures.push(`${manifest} must declare the MIT license`)
  }
}
for (const lockfile of findNamedFiles('.', 'package-lock.json')) {
  const metadata = JSON.parse(read(lockfile))
  if (metadata.packages?.['']?.license !== 'MIT') {
    failures.push(`${lockfile} must declare the MIT license for its root package`)
  }
}

const approvedReadmeContact = [
  'For questions, issues, or development access requests, please contact:',
  '- **Email**: yanhu@microsoft.com',
  '- **Support**: See [SUPPORT.md](./SUPPORT.md)',
].join('\n')
const readme = read('README.md')
if (!readme.includes(approvedReadmeContact)) {
  failures.push('The approved README contact/team attribution changed or was removed')
}

const scanExclusions = JSON.parse(read('scripts/public-governance-exclusions.json'))
for (const exclusion of scanExclusions) {
  if (
    !exclusion.pathPrefix ||
    !exclusion.owner ||
    !exclusion.justification ||
    typeof exclusion.publicationBlocking !== 'boolean'
  ) {
    failures.push(
      'Every public governance exclusion must have a pathPrefix, owner, justification, and publicationBlocking status',
    )
  }
  if (exclusion.publicationBlocking && !exclusion.removalWorkstream) {
    failures.push(
      `Publication-blocking exclusion must identify its sibling removal workstream: ${exclusion.pathPrefix}`,
    )
  }
  if (!exclusion.publicationBlocking && !exclusion.exceptionType) {
    failures.push(
      `Permanent reviewed exclusion must identify its exception type: ${exclusion.pathPrefix}`,
    )
  }
}
const forbiddenText = [
  /gim-home\/Kosmos/i,
  /ai-microsoft\/Kosmos\.app/i,
  /api\.microsoft\.ai/i,
  /azurewebsites\.net/i,
  /cdn\.kosmos-ai\.com/i,
  /sharepoint\.com/i,
  /dev\.azure\.com/i,
  /\b[\w.+-]+@microsoft\.com\b/i,
  /_microsoft\b/i,
]

function collectFiles(relativePath) {
  if (ignoredManifestFiles.has(relativePath.replace(/^\.\//, ''))) return []
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) return []
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) return [relativePath]
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredManifestDirectories.has(entry.name)) return []
    const child = path.posix.join(relativePath, entry.name)
    return collectFiles(child)
  })
}

const allFiles = collectFiles('.')
const textContent = (file) => {
  const buffer = fs.readFileSync(path.join(root, file))
  return buffer.includes(0) ? null : buffer.toString('utf8').replace(/\r\n/g, '\n')
}

for (const exclusion of scanExclusions) {
  const excludedFiles = allFiles.filter((file) => {
    const normalizedFile = file.replace(/^\.\//, '')
    return normalizedFile === exclusion.pathPrefix ||
      normalizedFile.startsWith(`${exclusion.pathPrefix}/`)
  })
  const stillNeeded = excludedFiles.some((file) => {
    const content = textContent(file)
    return content !== null && forbiddenText.some((pattern) => pattern.test(content))
  })
  if (!stillNeeded) {
    failures.push(`Stale public governance exclusion must be removed: ${exclusion.pathPrefix}`)
  }
}

for (const file of allFiles) {
  const normalizedFile = file.replace(/^\.\//, '')
  if (scanExclusions.some((exclusion) =>
    normalizedFile === exclusion.pathPrefix ||
    normalizedFile.startsWith(`${exclusion.pathPrefix}/`)
  )) {
    continue
  }
  let content = textContent(file)
  if (content === null) continue
  if (file === 'README.md') {
    content = content.replace(approvedReadmeContact, '')
  }
  for (const pattern of forbiddenText) {
    if (pattern.test(content)) {
      failures.push(`${file} contains prohibited internal text matching ${pattern}`)
    }
  }
}

const workflowDir = path.join(root, '.github/workflows')
for (const entry of fs.readdirSync(workflowDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue
  const relativePath = `.github/workflows/${entry.name}`
  const content = read(relativePath)
  const actionLines = content.match(/^\s*uses:\s*([^\s#]+)/gm) || []
  for (const line of actionLines) {
    const action = line.replace(/^\s*uses:\s*/, '')
    if (!/@[0-9a-f]{40}$/.test(action)) {
      failures.push(`${relativePath} uses an action that is not pinned to a full commit: ${action}`)
    }
  }
  if (/(?:pull-requests|checks|actions|id-token):\s*write/i.test(content)) {
    failures.push(`${relativePath} grants a disallowed write permission`)
  }
  if (relativePath !== '.github/workflows/release.yml' && /contents:\s*write/i.test(content)) {
    failures.push(`${relativePath} grants contents: write outside the release workflow`)
  }
  if (/(?:secrets\.|vars\.|azure|cdn|discord|self-hosted|gim-home|ai-microsoft)/i.test(content)) {
    failures.push(`${relativePath} contains internal infrastructure, secret, or runner configuration`)
  }
}

if (failures.length > 0) {
  console.error('Public governance checks failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Public governance checks passed.')
