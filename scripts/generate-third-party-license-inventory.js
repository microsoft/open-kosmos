const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const summaryPath = path.join(root, 'docs/third-party-license-inventory.json')
const inventoryPath = path.join(root, 'docs/third-party-license-inventory.csv')
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'dist-vite',
  'release',
  'vite-pack',
])

function findLockfiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findLockfiles(absolutePath)
    return entry.name === 'package-lock.json' ? [absolutePath] : []
  })
}

function findManifests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findManifests(absolutePath)
    return entry.name === 'package.json' ? [absolutePath] : []
  })
}

function packageName(lockPath, packagePath, metadata) {
  if (metadata.name) return metadata.name
  const marker = 'node_modules/'
  const index = packagePath.lastIndexOf(marker)
  return index >= 0 ? packagePath.slice(index + marker.length) : path.basename(path.dirname(lockPath))
}

function satisfiesRequestedVersion(version, requestedVersion) {
  const actual = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  const requested = requestedVersion.match(/^([~^]?)(\d+)\.(\d+)\.(\d+)/)
  if (!actual || !requested) return false
  const [, operator, requestedMajor, requestedMinor, requestedPatch] = requested
  const actualParts = actual.slice(1).map(Number)
  const requestedParts = [requestedMajor, requestedMinor, requestedPatch].map(Number)
  const comparison =
    actualParts[0] - requestedParts[0] ||
    actualParts[1] - requestedParts[1] ||
    actualParts[2] - requestedParts[2]
  if (operator === '^') {
    if (requestedParts[0] > 0) return actualParts[0] === requestedParts[0] && comparison >= 0
    if (requestedParts[1] > 0) {
      return actualParts[0] === 0 && actualParts[1] === requestedParts[1] && comparison >= 0
    }
    return actualParts[0] === 0 && actualParts[1] === 0 &&
      actualParts[2] === requestedParts[2]
  }
  if (operator === '~') {
    return actualParts[0] === requestedParts[0] &&
      actualParts[1] === requestedParts[1] &&
      comparison >= 0
  }
  return comparison === 0
}

const packageRecords = findLockfiles(root).flatMap((lockPath) => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const relativeLockfile = path.relative(root, lockPath).split(path.sep).join('/')
  return Object.entries(lock.packages || {})
    .filter(([packagePath, metadata]) => packagePath.includes('node_modules/') && metadata.version)
    .map(([packagePath, metadata]) => ({
      name: packageName(lockPath, packagePath, metadata),
      version: metadata.version || 'unknown',
      license: metadata.license || 'UNKNOWN',
      lockfile: relativeLockfile,
      developmentOnly: metadata.dev === true,
      optional: metadata.optional === true,
    }))
})

const packageMap = new Map()
for (const record of packageRecords) {
  const key = `${record.name}\0${record.version}\0${record.license}`
  const existing = packageMap.get(key)
  if (existing) {
    existing.lockfiles.push(record.lockfile)
    existing.developmentOnly = existing.developmentOnly && record.developmentOnly
    existing.optional = existing.optional && record.optional
  } else {
    packageMap.set(key, { ...record, lockfiles: [record.lockfile] })
  }
}

const packages = [...packageMap.values()].map(({ lockfile, ...record }) => ({
  ...record,
  lockfiles: [...new Set(record.lockfiles)].sort(),
}))

packages.sort((left, right) =>
  left.name.localeCompare(right.name) ||
  left.version.localeCompare(right.version) ||
  left.lockfiles.join(';').localeCompare(right.lockfiles.join(';')),
)

const manifestOnlyDependencies = findManifests(root).flatMap((manifestPath) => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const relativeLockfile = path.relative(root, path.join(path.dirname(manifestPath), 'package-lock.json'))
    .split(path.sep)
    .join('/')
  const applicablePackages = packageRecords.filter((entry) => entry.lockfile === relativeLockfile)
  const dependencyGroups = [
    ['runtime', manifest.dependencies],
    ['development', manifest.devDependencies],
    ['optional', manifest.optionalDependencies],
    ['peer', manifest.peerDependencies],
  ]
  return dependencyGroups.flatMap(([kind, dependencies]) =>
    Object.entries(dependencies || {})
      .filter(([name, requestedVersion]) =>
        !applicablePackages.some((entry) =>
          entry.name === name && satisfiesRequestedVersion(entry.version, requestedVersion)
        )
      )
      .map(([name, requestedVersion]) => ({
        name,
        requestedVersion,
        kind,
        manifest: path.relative(root, manifestPath).split(path.sep).join('/'),
        license: kind === 'peer' ? 'HOST-PROVIDED' : 'UNKNOWN',
      }))
  )
})

manifestOnlyDependencies.sort((left, right) =>
  left.name.localeCompare(right.name) ||
  left.manifest.localeCompare(right.manifest) ||
  left.kind.localeCompare(right.kind),
)

const evidence = {
  schemaVersion: 1,
  generatedFrom: findLockfiles(root)
    .map((lockPath) => path.relative(root, lockPath).split(path.sep).join('/'))
    .sort(),
  packageCount: packages.length,
  unknownLicenseCount: packages.filter((entry) => entry.license === 'UNKNOWN').length,
  manifestOnlyDependencyCount: manifestOnlyDependencies.length,
  unknownManifestLicenseCount: manifestOnlyDependencies
    .filter((entry) => entry.license === 'UNKNOWN').length,
  inventoryFile: path.relative(root, inventoryPath).split(path.sep).join('/'),
}

const csvCell = (value) => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const csvRows = [
  ['record_type', 'name', 'version_or_range', 'license', 'scope', 'sources'],
  ...packages.map((entry) => [
    'lockfile',
    entry.name,
    entry.version,
    entry.license,
    entry.developmentOnly ? 'development' : entry.optional ? 'optional' : 'runtime',
    entry.lockfiles.join(';'),
  ]),
  ...manifestOnlyDependencies.map((entry) => [
    'manifest-only',
    entry.name,
    entry.requestedVersion,
    entry.license,
    entry.kind,
    entry.manifest,
  ]),
]

fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`)
fs.writeFileSync(inventoryPath, `${csvRows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`)
console.log(`Wrote ${csvRows.length - 1} license evidence records to ${path.relative(root, inventoryPath)}`)
