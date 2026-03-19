#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Build configuration
const platforms = [
  { name: 'win-x64', command: 'npm run dist:win:x64' },
  { name: 'win-arm64', command: 'npm run dist:win:arm64' },
  { name: 'mac-x64', command: 'npm run dist:mac:x64' },
  { name: 'mac-arm64', command: 'npm run dist:mac:arm64' }
];

// Clean output directory
console.log('🧹 Cleaning output directory...');
if (fs.existsSync('release')) {
  fs.rmSync('release', { recursive: true });
}

// Build application
console.log('🔨 Building application...');
execSync('npm run build', { stdio: 'inherit' });

// Build installer for each platform
for (const platform of platforms) {
  console.log(`📦 Building ${platform.name} installer...`);
  try {
    execSync(platform.command, { stdio: 'inherit' });
    console.log(`✅ ${platform.name} build succeeded`);
  } catch (error) {
    console.error(`❌ ${platform.name} build failed:`, error.message);
  }
}

console.log('🎉 All platform builds completed!');
console.log('📁 Output directory: release/');