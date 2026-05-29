#!/usr/bin/env node

/**
 * Generate latest-mac.yml with correct SHA512 hashes for both DMG and ZIP
 * 
 * This script is necessary because after the staple → repack-zip → rebuild-dmg
 * pipeline, electron-builder's DMG-only rebuild generates a latest-mac.yml that
 * only contains the DMG entry (missing the ZIP entry). The auto-updater on macOS
 * needs the ZIP entry with correct hash to download and verify updates.
 * 
 * Usage: node scripts/generate-latest-mac-yml.js <dmg-path> <zip-path> <output-path>
 * Example: node scripts/generate-latest-mac-yml.js \
 *   release/OpenKosmos-1.20.14-mac-arm64.dmg \
 *   release/mac-arm64/OpenKosmos-1.20.14-mac-arm64.zip \
 *   release/latest-mac.yml
 * 
 * @see https://www.electron.build/auto-update
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function computeSha512(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(data).digest('base64');
}

function generateLatestMacYml(dmgPath, zipPath, outputPath) {
  console.log('📋 Generating latest-mac.yml...');
  console.log(`   DMG: ${dmgPath}`);
  console.log(`   ZIP: ${zipPath}`);
  console.log(`   Output: ${outputPath}`);

  // Verify files exist
  if (!fs.existsSync(dmgPath)) {
    throw new Error(`DMG not found: ${dmgPath}`);
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP not found: ${zipPath}`);
  }

  // Get version from package.json
  const packageJson = require('../package.json');
  const version = packageJson.version;

  // Compute hashes and sizes
  console.log('🔐 Computing SHA512 hashes (this may take a moment)...');
  
  const dmgHash = computeSha512(dmgPath);
  const dmgSize = fs.statSync(dmgPath).size;
  const dmgFilename = path.basename(dmgPath);
  console.log(`   DMG hash: ${dmgHash.substring(0, 20)}...`);
  console.log(`   DMG size: ${dmgSize} bytes (${(dmgSize / 1024 / 1024).toFixed(2)} MB)`);

  const zipHash = computeSha512(zipPath);
  const zipSize = fs.statSync(zipPath).size;
  const zipFilename = path.basename(zipPath);
  console.log(`   ZIP hash: ${zipHash.substring(0, 20)}...`);
  console.log(`   ZIP size: ${zipSize} bytes (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);

  // Generate YAML content matching electron-builder format
  // The format must be compatible with electron-updater
  const releaseDate = new Date().toISOString();
  
  const yamlContent = `version: ${version}
files:
  - url: ${dmgFilename}
    sha512: ${dmgHash}
    size: ${dmgSize}
  - url: ${zipFilename}
    sha512: ${zipHash}
    size: ${zipSize}
path: ${dmgFilename}
sha512: ${dmgHash}
releaseDate: '${releaseDate}'
`;

  // Write to output path
  fs.writeFileSync(outputPath, yamlContent, 'utf-8');
  
  const outputSize = fs.statSync(outputPath).size;
  console.log('');
  console.log(`✅ latest-mac.yml generated successfully`);
  console.log(`   Path: ${outputPath}`);
  console.log(`   Size: ${outputSize} bytes`);
  console.log(`   Version: ${version}`);
  console.log(`   Files: ${dmgFilename}, ${zipFilename}`);
  
  return outputPath;
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: node generate-latest-mac-yml.js <dmg-path> <zip-path> <output-path>');
    console.error('Example: node generate-latest-mac-yml.js \\');
    console.error('  release/OpenKosmos-1.20.14-mac-arm64.dmg \\');
    console.error('  release/mac-arm64/OpenKosmos-1.20.14-mac-arm64.zip \\');
    console.error('  release/latest-mac.yml');
    process.exit(1);
  }

  const [dmgPath, zipPath, outputPath] = args;

  try {
    generateLatestMacYml(dmgPath, zipPath, outputPath);
  } catch (error) {
    console.error('');
    console.error('❌ Failed to generate latest-mac.yml:', error.message);
    process.exit(1);
  }
}

main();
