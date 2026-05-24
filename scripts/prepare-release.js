#!/usr/bin/env node

/**
 * Release preparation script.
 * Automates version bumping and changelog preparation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 OpenKosmos release preparation tool');
console.log('=====================================\n');

// Read command line arguments.
const args = process.argv.slice(2);
const versionType = args[0] || 'patch'; // patch, minor, major, or an explicit version

// Validate the version argument.
const validTypes = ['patch', 'minor', 'major'];
const isCustomVersion = !validTypes.includes(versionType) && /^\d+\.\d+\.\d+$/.test(versionType);

if (!validTypes.includes(versionType) && !isCustomVersion) {
  console.error('❌ Invalid version type');
  console.log('Usage: node scripts/prepare-release.js [patch|minor|major|x.y.z]');
  console.log('Examples:');
  console.log('  node scripts/prepare-release.js patch    # 1.0.7 -> 1.0.8');
  console.log('  node scripts/prepare-release.js minor    # 1.0.7 -> 1.1.0');
  console.log('  node scripts/prepare-release.js major    # 1.0.7 -> 2.0.0');
  console.log('  node scripts/prepare-release.js 1.0.8    # Use an explicit version');
  process.exit(1);
}

try {
  // 1. Read the current version.
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageJson.version;
  
  console.log(`📦 Current version: ${currentVersion}`);
  
  // 2. Bump the version.
  console.log(`🔄 Updating version (${versionType})...`);
  
  let newVersion;
  if (isCustomVersion) {
    // Use the requested explicit version.
    newVersion = versionType;
    execSync(`npm version ${newVersion} --no-git-tag-version`, { stdio: 'inherit' });
  } else {
    // Use a semantic version bump type.
    const result = execSync(`npm version ${versionType} --no-git-tag-version`, { encoding: 'utf8', stdio: 'pipe' });
    newVersion = result.trim().substring(1); // Drop the leading v.
  }
  
  console.log(`✅ Version updated: ${currentVersion} -> ${newVersion}`);
  
  // 3. Update CHANGELOG.md.
  console.log('📝 Updating changelog...');
  updateChangelog(newVersion);
  
  // 4. Run validation.
  console.log('🧪 Running validation...');
  try {
    execSync('npm run test:cdn-update', { stdio: 'inherit' });
  } catch (error) {
    console.warn('⚠️  CDN validation failed, but the release flow can continue');
  }
  
  console.log('\n🎉 Release preparation completed');
  console.log('=====================================');
  console.log(`New version: ${newVersion}`);
  console.log('Next steps:');
  console.log('1. Review and refine the CHANGELOG.md entries');
  console.log('2. Commit the changes: git add . && git commit -m "Prepare release v' + newVersion + '"');
  console.log('3. Create the release tag: git tag v' + newVersion);
  console.log('4. Push to remote: git push origin main --tags');
  
} catch (error) {
  console.error('❌ Release preparation failed:', error.message);
  process.exit(1);
}

/**
 * Update CHANGELOG.md.
 */
function updateChangelog(newVersion) {
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  const unreleasedHeaders = ['## [Unreleased]', '## [Unreleased-zh]'];
  
  if (!fs.existsSync(changelogPath)) {
    console.warn('⚠️  CHANGELOG.md does not exist, skipping update');
    return;
  }
  
  const currentDate = new Date().toISOString().split('T')[0];
  let content = fs.readFileSync(changelogPath, 'utf8');
  const existingHeader = unreleasedHeaders.find((header) => content.includes(header));
  
  // Require an unreleased section before inserting the new version block.
  if (!existingHeader) {
    console.warn('⚠️  CHANGELOG.md does not contain an [Unreleased] section, please update it manually');
    return;
  }
  
  // Replace the unreleased header with a fresh unreleased section plus the new version header.
  const versionHeader = `## [${newVersion}] - ${currentDate}`;
  const newUnreleasedSection = `## [Unreleased]

### Features

### Improvements

### Bug Fixes

### Security

${versionHeader}`;
  
  content = content.replace(existingHeader, newUnreleasedSection);
  
  fs.writeFileSync(changelogPath, content, 'utf8');
  console.log(`✅ CHANGELOG.md updated for version ${newVersion}`);
}
