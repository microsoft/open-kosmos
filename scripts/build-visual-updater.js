#!/usr/bin/env node

/**
 * Build script for OpenKosmos Visual Updater
 *
 * Builds the visual updater and copies it to the main project's resources directory.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const updaterDir = path.join(rootDir, 'updater-electron');
const targetDir = path.join(rootDir, 'resources', 'updater');

console.log('🚀 Building OpenKosmos Visual Updater...\n');

// Switch to the updater-electron directory
process.chdir(updaterDir);

try {
  // 1. Install dependencies
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');

  // 2. Compile TypeScript
  console.log('🔨 Compiling TypeScript...');
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ TypeScript compiled\n');

  // 3. Build Windows x64 executable
  console.log('📦 Building Windows x64 executable...');
  execSync('npm run dist:win:x64', { stdio: 'inherit' });
  console.log('✅ Windows x64 executable built\n');

  // 4. Build Windows arm64 executable
  console.log('📦 Building Windows arm64 executable...');
  execSync('npm run dist:win:arm64', { stdio: 'inherit' });
  console.log('✅ Windows arm64 executable built\n');

  // 5. Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 6. Copy build artifacts to resources/updater
  console.log('📋 Copying build artifacts...');
  
  const releaseDir = path.join(updaterDir, 'release');
  const artifacts = fs.readdirSync(releaseDir);
  
  let copiedCount = 0;
  artifacts.forEach(file => {
    if (file.endsWith('.exe') && file.includes('updater')) {
      const src = path.join(releaseDir, file);
      const dest = path.join(targetDir, file);
      
      fs.copyFileSync(src, dest);
      console.log(`  ✅ ${file}`);
      copiedCount++;
    }
  });

  if (copiedCount === 0) {
    console.log('  ⚠️ No updater executables found in release directory');
  }

  console.log('\n🎉 Visual Updater build completed successfully!');
  console.log(`\n📁 Output directory: ${targetDir}`);
  
  // List target directory contents
  const files = fs.readdirSync(targetDir);
  console.log('\n📦 Available updaters:');
  files.forEach(file => {
    const stat = fs.statSync(path.join(targetDir, file));
    const size = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`  - ${file} (${size} MB)`);
  });

} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}
