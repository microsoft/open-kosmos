#!/usr/bin/env node

/**
 * Release Preparation Script
 * Automates version number updates and changelog preparation process
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Kosmos Release Preparation Tool');
console.log('=====================================\n');

// Get command line arguments
const args = process.argv.slice(2);
const versionType = args[0] || 'patch'; // patch, minor, major, or specific version number

// Validate version type
const validTypes = ['patch', 'minor', 'major'];
const isCustomVersion = !validTypes.includes(versionType) && /^\d+\.\d+\.\d+$/.test(versionType);

if (!validTypes.includes(versionType) && !isCustomVersion) {
  console.error('❌ Invalid version type');
  console.log('Usage: node scripts/prepare-release.js [patch|minor|major|x.y.z]');
  console.log('Examples:');
  console.log('  node scripts/prepare-release.js patch    # 1.0.7 → 1.0.8');
  console.log('  node scripts/prepare-release.js minor    # 1.0.7 → 1.1.0');
  console.log('  node scripts/prepare-release.js major    # 1.0.7 → 2.0.0');
  console.log('  node scripts/prepare-release.js 1.0.8    # Specify version number');
  process.exit(1);
}

try {
  // 1. Get current version
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageJson.version;
  
  console.log(`📦 Current version: ${currentVersion}`);
  
  // 2. Update version number
  console.log(`🔄 Updating version number (${versionType})...`);
  
  let newVersion;
  if (isCustomVersion) {
    // Use specified version number
    newVersion = versionType;
    execSync(`npm version ${newVersion} --no-git-tag-version`, { stdio: 'inherit' });
  } else {
    // Use version type
    const result = execSync(`npm version ${versionType} --no-git-tag-version`, { encoding: 'utf8', stdio: 'pipe' });
    newVersion = result.trim().substring(1); // Remove 'v' prefix
  }
  
  console.log(`✅ Version number updated: ${currentVersion} → ${newVersion}`);
  
  // 3. Update CHANGELOG.md
  console.log('📝 Updating changelog...');
  updateChangelog(newVersion);
  
  // 4. Run tests
  console.log('🧪 Running test verification...');
  try {
    execSync('npm run test:cdn-update', { stdio: 'inherit' });
  } catch (error) {
    console.warn('⚠️  CDN test failed, but it does not affect the release process');
  }
  
  console.log('\n🎉 Release preparation complete!');
  console.log('=====================================');
  console.log(`New version: ${newVersion}`);
  console.log('Next steps:');
  console.log('1. Review and finalize the updates in CHANGELOG.md');
  console.log('2. Commit changes: git add . && git commit -m "Prepare release v' + newVersion + '"');
  console.log('3. Create release tag: git tag v' + newVersion);
  console.log('4. Push to remote: git push origin main --tags');
  
} catch (error) {
  console.error('❌ Release preparation failed:', error.message);
  process.exit(1);
}

/**
 * Update CHANGELOG.md file
 */
function updateChangelog(newVersion) {
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  
  if (!fs.existsSync(changelogPath)) {
    console.warn('⚠️  CHANGELOG.md file does not exist, skipping update');
    return;
  }
  
  const currentDate = new Date().toISOString().split('T')[0];
  let content = fs.readFileSync(changelogPath, 'utf8');
  
  // Check if there is unreleased content
  if (!content.includes('## [Unreleased]')) {
    console.warn('⚠️  No [Unreleased] section found in CHANGELOG.md, please update manually');
    return;
  }
  
  // Replace [Unreleased] with new version
  const versionHeader = `## [${newVersion}] - ${currentDate}`;
  const newUnreleasedSection = `## [Unreleased]

### Added

### Improved

### Fixed

### Security

${versionHeader}`;
  
  content = content.replace('## [Unreleased]', newUnreleasedSection);
  
  fs.writeFileSync(changelogPath, content, 'utf8');
  console.log(`✅ CHANGELOG.md updated (version ${newVersion})`);
}
