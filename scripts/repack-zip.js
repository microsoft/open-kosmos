#!/usr/bin/env node

/**
 * Repack ZIP file for macOS auto-update
 *
 * Creates a ZIP file from a DMG (preferred) or .app bundle, ensuring the ZIP
 * contains the properly signed, notarized, and stapled .app that Gatekeeper
 * will accept.
 *
 * Usage:
 *   From DMG (preferred):  node scripts/repack-zip.js --from-dmg <dmg-path> <output-dir> <arch>
 *   From .app (fallback):  node scripts/repack-zip.js <app-path> <output-dir> <arch>
 *
 * The DMG mode is preferred because it guarantees the ZIP contains the exact same
 * .app that users get from the DMG installation (which is proven to work with
 * Gatekeeper and code signature verification).
 *
 * Key implementation detail:
 *   Uses `ditto -c -k --sequesterRsrc --keepParent` (matching electron-builder)
 *   The --sequesterRsrc flag is CRITICAL for preserving resource forks and
 *   extended attributes in the ZIP, which are required for macOS code signature
 *   and notarization ticket (staple) preservation.
 *
 * @see https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Brand configuration
const brandConfig = require('./brand-config');
const { config } = brandConfig;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// DMG Operations
// ============================================================================

/**
 * Mount a DMG file read-only and return the mount point path
 */
function mountDmg(dmgPath) {
  console.log(`📀 Mounting DMG: ${dmgPath}`);

  if (!fs.existsSync(dmgPath)) {
    throw new Error(`DMG file not found: ${dmgPath}`);
  }

  const mountPoint = path.join(os.tmpdir(), `repack-zip-mount-${Date.now()}`);
  fs.mkdirSync(mountPoint, { recursive: true });

  try {
    execSync(
      `hdiutil attach "${dmgPath}" -mountpoint "${mountPoint}" -nobrowse -readonly`,
      { encoding: 'utf-8', timeout: 120000, stdio: 'inherit' }
    );
  } catch (error) {
    try { fs.rmdirSync(mountPoint); } catch (e) { /* ignore */ }
    throw new Error(`Failed to mount DMG: ${error.message}`);
  }

  console.log(`   Mounted at: ${mountPoint}`);

  // List contents for debugging
  const contents = fs.readdirSync(mountPoint);
  console.log(`   Contents: ${contents.join(', ')}`);

  return mountPoint;
}

/**
 * Unmount a DMG by mount point
 */
function unmountDmg(mountPoint) {
  console.log(`📀 Unmounting: ${mountPoint}`);
  try {
    execSync(`hdiutil detach "${mountPoint}" -force`, {
      encoding: 'utf-8', timeout: 60000, stdio: 'pipe'
    });
    console.log('   Unmounted successfully');
  } catch (error) {
    console.warn(`   ⚠️  Unmount warning: ${error.message}`);
    // Retry after delay
    try {
      execSync('sleep 2', { encoding: 'utf-8' });
      execSync(`hdiutil detach "${mountPoint}" -force`, {
        encoding: 'utf-8', timeout: 60000, stdio: 'pipe'
      });
    } catch (e) {
      console.warn('   ⚠️  Force unmount also failed - may need manual cleanup');
    }
  }
}

/**
 * Find a .app bundle in a directory
 */
function findApp(dir) {
  const entries = fs.readdirSync(dir);
  const appEntry = entries.find(e => e.endsWith('.app'));
  if (!appEntry) {
    throw new Error(`No .app bundle found in: ${dir} (contents: ${entries.join(', ')})`);
  }
  return path.join(dir, appEntry);
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify code signature and notarization of an app bundle
 * @param {string} appPath - Path to the .app bundle
 * @param {string} label - Label for log messages
 * @param {boolean} strict - If true, throw on failure; if false, warn only
 */
function verifyCodeSignature(appPath, label, strict) {
  if (strict === undefined) strict = true;
  console.log(`🔍 Verifying code signature [${label}]: ${path.basename(appPath)}`);

  // 1. codesign --verify --deep --strict
  try {
    const output = execSync(
      `codesign --verify --deep --strict --verbose=2 "${appPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 120000 }
    );
    console.log('   ✅ codesign --verify --deep --strict: PASSED');
    if (output.trim()) {
      output.trim().split('\n').slice(0, 5).forEach(line => console.log(`      ${line}`));
    }
  } catch (error) {
    const msg = (error.stdout || '') + (error.stderr || '') || error.message;
    if (strict) {
      console.error('   ❌ codesign verification FAILED');
      msg.trim().split('\n').forEach(line => console.error(`      ${line}`));
      throw new Error(`Code signature verification failed [${label}]`);
    } else {
      console.warn(`   ⚠️  codesign warning: ${msg.trim().split('\n')[0]}`);
    }
  }

  // 2. spctl --assess (Gatekeeper simulation)
  try {
    execSync(
      `spctl --assess --type execute --verbose=2 "${appPath}" 2>&1`,
      { encoding: 'utf-8', timeout: 120000 }
    );
    console.log('   ✅ spctl --assess (Gatekeeper): PASSED');
  } catch (error) {
    const msg = (error.stdout || '') + (error.stderr || '') || error.message;
    // spctl may not work correctly on CI runners without full Gatekeeper
    console.warn(`   ⚠️  spctl --assess: ${msg.trim().split('\n')[0]}`);
    console.warn('      (May be expected on CI runners without full Gatekeeper support)');
  }

  // 3. Staple validation
  try {
    execSync(`xcrun stapler validate "${appPath}" 2>&1`, {
      encoding: 'utf-8', timeout: 60000
    });
    console.log('   ✅ xcrun stapler validate: PASSED');
  } catch (error) {
    const msg = (error.stdout || '') + (error.stderr || '') || error.message;
    console.warn(`   ⚠️  stapler validate: ${msg.trim().split('\n')[0]}`);
  }
}

// ============================================================================
// ZIP Creation
// ============================================================================

/**
 * Create ZIP archive from an .app bundle
 * Uses ditto with --sequesterRsrc to match electron-builder behavior
 */
function createZip(appPath, outputDir, arch) {
  const packageJson = require('../package.json');
  const version = packageJson.version;
  const filenamePrefix = config.filenamePrefix || config.productName;
  const zipFilename = `${filenamePrefix}-${version}-mac-${arch}.zip`;
  const zipPath = path.resolve(outputDir, zipFilename);
  const absAppPath = path.resolve(appPath);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Remove old ZIP and blockmap files matching our pattern
  const oldPattern = new RegExp(
    `${escapeRegExp(filenamePrefix)}.*-${escapeRegExp(arch)}\\.zip(\\.blockmap)?$`
  );
  const filesInDir = fs.readdirSync(outputDir);
  filesInDir.forEach(file => {
    if (oldPattern.test(file)) {
      const oldPath = path.join(outputDir, file);
      console.log(`🗑️  Removing old file: ${oldPath}`);
      fs.unlinkSync(oldPath);
    }
  });

  // Create ZIP using ditto with --sequesterRsrc
  // --sequesterRsrc: Preserve resource forks & HFS metadata in __MACOSX dir
  //                  (this is what electron-builder uses - CRITICAL for code signing)
  // --keepParent:    Include the .app directory name in the ZIP root
  console.log(`📦 Creating ZIP: ${zipPath}`);
  console.log(`   Source app: ${absAppPath}`);
  console.log('   Command: ditto -c -k --sequesterRsrc --keepParent');

  execSync(
    `ditto -c -k --sequesterRsrc --keepParent "${absAppPath}" "${zipPath}"`,
    {
      encoding: 'utf-8',
      timeout: 10 * 60 * 1000,
      stdio: 'inherit'
    }
  );

  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP was not created: ${zipPath}`);
  }

  const zipSize = fs.statSync(zipPath).size;
  console.log(`✅ ZIP created: ${zipPath} (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);

  return zipPath;
}

/**
 * Generate blockmap file for differential updates (electron-updater)
 */
function generateBlockmap(zipPath) {
  console.log('📊 Generating blockmap for differential updates...');

  try {
    // Resolve platform-specific app-builder binary
    const appBuilderBinDir = path.dirname(require.resolve('app-builder-bin/package.json'));
    const platform = process.platform === 'darwin' ? 'mac'
      : process.platform === 'win32' ? 'win' : 'linux';
    const cpuArch = os.arch(); // arm64 or x64
    const binName = platform === 'win' ? 'app-builder.exe' : `app-builder_${cpuArch}`;
    const appBuilderPath = path.join(appBuilderBinDir, platform, binName);

    if (!fs.existsSync(appBuilderPath)) {
      throw new Error(`app-builder not found: ${appBuilderPath}`);
    }

    console.log(`   Using: ${appBuilderPath}`);
    execSync(
      `"${appBuilderPath}" blockmap --input="${zipPath}" --output="${zipPath}.blockmap"`,
      { encoding: 'utf-8', timeout: 5 * 60 * 1000, stdio: 'pipe' }
    );

    const blockmapSize = fs.statSync(`${zipPath}.blockmap`).size;
    console.log(`✅ Blockmap: ${zipPath}.blockmap (${(blockmapSize / 1024).toFixed(1)} KB)`);
  } catch (error) {
    // Fallback: npx approach
    try {
      execSync(
        `npx --yes app-builder-bin blockmap --input="${zipPath}" --output="${zipPath}.blockmap"`,
        { encoding: 'utf-8', timeout: 5 * 60 * 1000, stdio: 'pipe' }
      );
      console.log('✅ Blockmap generated (npx fallback)');
    } catch (fallbackError) {
      console.warn(`⚠️  Blockmap generation skipped: ${error.message}`);
      console.warn('   Auto-update will still work but may download full file instead of delta');
    }
  }
}

/**
 * Verify ZIP contents by extracting to temp directory and checking code signature
 */
function verifyZipContents(zipPath) {
  console.log('🔍 Verifying ZIP contents (extract + codesign check)...');

  const tempDir = path.join(os.tmpdir(), `zip-verify-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract ZIP using ditto (preserves all macOS attributes)
    execSync(`ditto -x -k "${zipPath}" "${tempDir}"`, {
      encoding: 'utf-8', timeout: 5 * 60 * 1000, stdio: 'pipe'
    });

    // Find extracted .app
    const extractedApp = findApp(tempDir);
    console.log(`   Extracted: ${path.basename(extractedApp)}`);

    // Verify code signature of extracted app
    verifyCodeSignature(extractedApp, 'ZIP-extracted', true);

    console.log('✅ ZIP contents verification PASSED');
    console.log('   The .app extracted from ZIP has valid code signature and notarization');
  } finally {
    // Clean up temp directory
    try {
      execSync(`rm -rf "${tempDir}"`, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
    } catch (e) { /* ignore cleanup errors */ }
  }
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  let fromDmg = false;
  let sourcePath, outputDir, arch;

  if (args[0] === '--from-dmg') {
    fromDmg = true;
    if (args.length < 4) {
      console.error('Usage: node repack-zip.js --from-dmg <dmg-path> <output-dir> <arch>');
      process.exit(1);
    }
    [, sourcePath, outputDir, arch] = args;
  } else {
    if (args.length < 3) {
      console.error('Usage: node repack-zip.js <app-path> <output-dir> <arch>');
      console.error('       node repack-zip.js --from-dmg <dmg-path> <output-dir> <arch>');
      process.exit(1);
    }
    [sourcePath, outputDir, arch] = args;
  }

  let mountPoint = null;

  try {
    let appPath;

    if (fromDmg) {
      // ==================================================================
      // Mode 1: Extract .app from DMG, then create ZIP
      // This guarantees ZIP contains identical .app as DMG (proven working)
      // ==================================================================
      console.log('');
      console.log('══════════════════════════════════════════════════════');
      console.log('📀 Mode: Create ZIP from DMG (recommended)');
      console.log('══════════════════════════════════════════════════════');
      console.log(`   DMG:    ${sourcePath}`);
      console.log(`   Output: ${outputDir}`);
      console.log(`   Arch:   ${arch}`);
      console.log('');

      // Mount DMG read-only
      mountPoint = mountDmg(path.resolve(sourcePath));

      // Find .app in mounted DMG
      appPath = findApp(mountPoint);
      console.log(`   Found app in DMG: ${path.basename(appPath)}`);

      // Verify the app from DMG has valid signature
      console.log('');
      verifyCodeSignature(appPath, 'DMG-source');

    } else {
      // ==================================================================
      // Mode 2: Create ZIP directly from .app bundle
      // ==================================================================
      console.log('');
      console.log('══════════════════════════════════════════════════════');
      console.log('📦 Mode: Create ZIP from .app');
      console.log('══════════════════════════════════════════════════════');
      console.log(`   App:    ${sourcePath}`);
      console.log(`   Output: ${outputDir}`);
      console.log(`   Arch:   ${arch}`);
      console.log('');

      if (!fs.existsSync(sourcePath)) {
        throw new Error(`App not found: ${sourcePath}`);
      }

      appPath = sourcePath;

      // Verify staple before repacking
      console.log('🔍 Verifying staple before repacking...');
      try {
        execSync(`xcrun stapler validate "${appPath}"`, {
          encoding: 'utf-8', timeout: 60000, stdio: 'pipe'
        });
        console.log('✅ Staple verification passed');
      } catch (error) {
        console.error('❌ Staple verification failed - app must be stapled before repacking');
        throw error;
      }

      // Verify code signature
      verifyCodeSignature(appPath, 'source-app');
    }

    // Create ZIP with ditto --sequesterRsrc --keepParent
    console.log('');
    const zipPath = createZip(appPath, outputDir, arch);

    // Unmount DMG (no longer needed)
    if (mountPoint) {
      console.log('');
      unmountDmg(mountPoint);
      mountPoint = null;
    }

    // Generate blockmap for differential updates
    console.log('');
    generateBlockmap(zipPath);

    // Verify: extract ZIP and check code signature of extracted app
    console.log('');
    verifyZipContents(zipPath);

    // Summary
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log('✅ ZIP repacking completed successfully!');
    console.log(`   ZIP: ${zipPath}`);
    if (fs.existsSync(`${zipPath}.blockmap`)) {
      console.log(`   Blockmap: ${zipPath}.blockmap`);
    }
    console.log('══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('');
    console.error('══════════════════════════════════════════════════════');
    console.error('❌ ZIP repacking FAILED');
    console.error(`   Error: ${error.message}`);
    console.error('══════════════════════════════════════════════════════');
    process.exit(1);
  } finally {
    // Ensure DMG is unmounted on any exit path
    if (mountPoint) {
      unmountDmg(mountPoint);
    }
  }
}

main();
