#!/usr/bin/env node

/**
 * Icon Generation Script for Kosmos
 * Generates .ico, .svg, iconset, and .icns files from PNG sources
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const brandConfig = require('./brand-config');

const ROOT_DIR = path.join(__dirname, '..');
const WIN_SOURCE_DIR = brandConfig.paths.assetsWin;
const MAC_SOURCE_DIR = brandConfig.paths.assetsMac;

/**
 * Helper function: Auto-generate PNGs of different sizes from a large image
 * @param {string} masterFile Master file path (recommended 1024x1024)
 * @param {Array<number>} sizes List of sizes to generate
 * @param {string} outputDir Output directory
 * @param {string} prefix Filename prefix (e.g. "icon_round_")
 * @param {string} suffix Filename suffix (e.g. "") - default none
 */
async function generateIntermediatePngs(masterFile, sizes, outputDir, prefix, suffix = '') {
  if (!fs.existsSync(masterFile)) {
    console.error(`❌ Cannot find master source file: ${masterFile}`);
    return false;
  }

  console.log(`🔄 Auto-generating ${sizes.length} intermediate PNG sizes from master file...`);
  
  for (const size of sizes) {
    const filename = `${prefix}${size}x${size}${suffix}.png`;
    const outputPath = path.join(outputDir, filename);

    // Only generate when file doesn't exist to avoid redundant work (manually delete old files to force update)
    // Fix: Always overwrite to ensure icons are up-to-date
    try {
      await sharp(masterFile)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      // console.log(`   ✨ Generated: ${filename}`);
    } catch (err) {
      console.error(`   ❌ Failed to generate ${filename}:`, err.message);
      return false;
    }
  }
  console.log('   ✅ Intermediate files generated');
  return true;
}

/**
 * Generate Windows .ico file
 * Uses png-to-ico library or ImageMagick if available
 */
async function generateWindowsIco() {
  console.log('📦 Generating Windows .ico file...');

  const icoPath = brandConfig.paths.iconWin;
  const masterIcon = path.join(WIN_SOURCE_DIR, 'icon_round_1024x1024.png');

  // Required sizes for .ico: 16, 32, 48, 64, 128, 256
  // Added 24 and 512 as requested by user
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  
  // 1. Try to auto-generate missing sizes from 1024x1024
  if (fs.existsSync(masterIcon)) {
    await generateIntermediatePngs(masterIcon, sizes, WIN_SOURCE_DIR, 'icon_round_');
  }

  const pngFiles = sizes.map((size) =>
    path.join(WIN_SOURCE_DIR, `icon_round_${size}x${size}.png`),
  );

  // Check if all required PNG files exist
  const missingFiles = pngFiles.filter((file) => !fs.existsSync(file));
  if (missingFiles.length > 0) {
    console.error('❌ Missing required PNG files:');
    missingFiles.forEach((file) =>
      console.error(`   - ${path.basename(file)}`),
    );
    return false;
  }

  try {
    // Try using ImageMagick convert command (works on Windows with ImageMagick installed)
    const convertCmd = `magick convert ${pngFiles.join(' ')} "${icoPath}"`;
    execSync(convertCmd, { stdio: 'inherit' });
    console.log(`✅ Successfully generated: ${icoPath}`);
    return true;
  } catch (error) {
    console.log('⚠️  ImageMagick not available, trying png2icons...');

    try {
      // Use png2icons with proper format flag
      const source256 = path.join(WIN_SOURCE_DIR, 'icon_round_256x256.png');
      const outputBase = path.join(WIN_SOURCE_DIR, 'app');

      if (!fs.existsSync(source256)) {
        console.error('❌ Missing 256x256 source file');
        return false;
      }

      // png2icons requires format flag and auto-appends extension
      const png2iconsCmd = `npx -y png2icons "${source256}" "${outputBase}" -ico`;
      execSync(png2iconsCmd, { stdio: 'inherit' });
      console.log(`✅ Successfully generated .ico: ${icoPath}`);
      return true;
    } catch (png2iconsError) {
      console.error('❌ png2icons generation failed:', png2iconsError.message);
      console.log('\n💡 Please install ImageMagick:');
      console.log('   Windows: https://imagemagick.org/script/download.php');
      console.log('   macOS: brew install imagemagick');
      return false;
    }
  }
}

/**
 * Generate Windows .svg file
 * Traces the largest PNG to SVG using potrace or converts directly
 */
async function generateWindowsSvg() {
  console.log('🎨 Generating Windows .svg file...');

  const svgPath = path.join(WIN_SOURCE_DIR, 'app.svg');
  const source1024 = path.join(WIN_SOURCE_DIR, 'icon_round_1024x1024.png');

  if (!fs.existsSync(source1024)) {
    console.error('❌ Missing 1024x1024 source file');
    return false;
  }

  try {
    // Try using potrace for true vector tracing
    const potraceCmd = `potrace "${source1024}" -s -o "${svgPath}"`;
    execSync(potraceCmd, { stdio: 'inherit' });
    console.log(`✅ Successfully generated vector SVG: ${svgPath}`);
    return true;
  } catch (error) {
    console.log('⚠️  potrace not available, generating embedded PNG-SVG...');

    try {
      // Read the PNG and create an SVG wrapper with embedded PNG
      const pngBuffer = fs.readFileSync(source1024);
      const base64 = pngBuffer.toString('base64');

      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="1024" height="1024" xlink:href="data:image/png;base64,${base64}"/>
</svg>`;

      fs.writeFileSync(svgPath, svgContent);
      console.log(`✅ Successfully generated embedded PNG-SVG: ${svgPath}`);
      console.log(
        '⚠️  Note: This is not a true vector image. Install potrace to generate a true vector SVG',
      );
      return true;
    } catch (svgError) {
      console.error('❌ SVG generation failed:', svgError.message);
      return false;
    }
  }
}

/**
 * Generate Mac iconset directory
 * Creates .iconset folder with all required icon sizes for macOS
 */
async function generateMacIconset() {
  console.log('🍎 Generating Mac .iconset directory...');
  
  const iconsetPath = path.join(MAC_SOURCE_DIR, 'Kosmos.iconset');
  
  // Create iconset directory if it doesn't exist
  if (!fs.existsSync(iconsetPath)) {
    fs.mkdirSync(iconsetPath, { recursive: true });
  }
  
  // macOS iconset required sizes
  const iconsetSizes = [
    { size: 16, src: 'icon_16x16.png', dest: 'icon_16x16.png' },
    { size: 32, src: 'icon_16x16.png', dest: 'icon_16x16@2x.png' },
    { size: 32, src: 'icon_32x32.png', dest: 'icon_32x32.png' },
    { size: 64, src: 'icon_32x32.png', dest: 'icon_32x32@2x.png' },
    { size: 128, src: 'icon_128x128.png', dest: 'icon_128x128.png' },
    { size: 256, src: 'icon_128x128.png', dest: 'icon_128x128@2x.png' },
    { size: 256, src: 'icon_256x256.png', dest: 'icon_256x256.png' },
    { size: 512, src: 'icon_256x256.png', dest: 'icon_256x256@2x.png' },
    { size: 512, src: 'icon_512x512.png', dest: 'icon_512x512.png' },
    { size: 1024, src: 'icon_512x512.png', dest: 'icon_512x512@2x.png' },
  ];

  // 0. Check for Master Icon, generate base sizes if available
  const masterIconMac = path.join(MAC_SOURCE_DIR, 'icon_1024x1024.png');
  const masterIconWin = path.join(WIN_SOURCE_DIR, 'icon_round_1024x1024.png');
  
  // Prefer Mac's 1024, fall back to Win's 1024
  const sourceMaster = fs.existsSync(masterIconMac) ? masterIconMac : (fs.existsSync(masterIconWin) ? masterIconWin : null);

  if (sourceMaster) {
     // Base sizes required by iconset (those referenced in src)
     const baseSizes = [16, 32, 128, 256, 512]; 
     await generateIntermediatePngs(sourceMaster, baseSizes, MAC_SOURCE_DIR, 'icon_');
  }
  
  let success = true;
  
  for (const { size, src, dest } of iconsetSizes) {
    const srcPath = path.join(MAC_SOURCE_DIR, src);
    const destPath = path.join(iconsetPath, dest);
    
    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Missing source file: ${src}`);
      success = false;
      continue;
    }
    
    try {
      // Resize if necessary
      await sharp(srcPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(destPath);
      
      console.log(`   ✓ ${dest}`);
    } catch (error) {
      console.error(`   ✗ ${dest}: ${error.message}`);
      success = false;
    }
  }
  
  if (success) {
    console.log(`✅ Successfully generated iconset: ${iconsetPath}`);
  }
  
  return success;
}

/**
 * Generate Mac .icns file
 * Converts iconset to .icns using iconutil (macOS only) or png2icons
 */
async function generateMacIcns() {
  console.log('📦 Generating Mac .icns file...');
  
  const iconsetPath = path.join(MAC_SOURCE_DIR, 'Kosmos.iconset');
  const icnsPath = path.join(MAC_SOURCE_DIR, 'Kosmos.icns');
  
  if (!fs.existsSync(iconsetPath)) {
    console.error('❌ iconset directory does not exist, please generate iconset first');
    return false;
  }
  
  // Check if running on macOS
  const isMac = process.platform === 'darwin';
  
  if (isMac) {
    try {
      // Use iconutil (native macOS tool)
      const iconutilCmd = `iconutil -c icns "${iconsetPath}" -o "${icnsPath}"`;
      execSync(iconutilCmd, { stdio: 'inherit' });
      console.log(`✅ Successfully generated: ${icnsPath}`);
      return true;
    } catch (error) {
      console.error('❌ iconutil failed:', error.message);
      return false;
    }
  } else {
    console.log('⚠️  Not macOS, trying png2icons...');
    
    try {
      // Use png2icons with proper format flag
      const source512 = path.join(MAC_SOURCE_DIR, 'icon_512x512.png');
      const outputBase = path.join(MAC_SOURCE_DIR, 'Kosmos');
      
      if (!fs.existsSync(source512)) {
        console.error('❌ Missing 512x512 source file');
        return false;
      }
      
      // png2icons requires format flag and auto-appends extension
      const png2iconsCmd = `npx -y png2icons "${source512}" "${outputBase}" -icns`;
      execSync(png2iconsCmd, { stdio: 'inherit' });
      console.log(`✅ Successfully generated: ${icnsPath}`);
      return true;
    } catch (error) {
      console.error('❌ png2icons failed:', error.message);
      console.log('\n💡 Suggestions:');
      console.log('   1. Run this script on macOS to use iconutil');
      console.log('   2. Or manually use an online tool: https://cloudconvert.com/png-to-icns');
      return false;
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 OpenKosmos Icon Generation Tool');
  console.log('═'.repeat(60));
  console.log('');
  
  // Check if source directories exist
  if (!fs.existsSync(WIN_SOURCE_DIR)) {
    console.error(`❌ Windows icon source directory does not exist: ${WIN_SOURCE_DIR}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(MAC_SOURCE_DIR)) {
    console.error(`❌ Mac icon source directory does not exist: ${MAC_SOURCE_DIR}`);
    process.exit(1);
  }
  
  console.log('📁 Source directories:');
  console.log(`   Windows: ${WIN_SOURCE_DIR}`);
  console.log(`   Mac: ${MAC_SOURCE_DIR}`);
  console.log('');
  
  const results = {
    windowsIco: false,
    windowsSvg: false,
    macIconset: false,
    macIcns: false
  };
  
  // Generate Windows icons
  console.log('🪟 Windows Icon Generation');
  console.log('─'.repeat(60));
  results.windowsIco = await generateWindowsIco();
  console.log('');
  results.windowsSvg = await generateWindowsSvg();
  console.log('');
  
  // Generate Mac icons
  console.log('🍎 Mac Icon Generation');
  console.log('─'.repeat(60));
  results.macIconset = await generateMacIconset();
  console.log('');
  results.macIcns = await generateMacIcns();
  console.log('');
  
  // Summary
  console.log('📊 Generation Results Summary');
  console.log('═'.repeat(60));
  console.log(`Windows .ico:  ${results.windowsIco ? '✅' : '❌'}`);
  console.log(`Windows .svg:  ${results.windowsSvg ? '✅' : '❌'}`);
  console.log(`Mac .iconset:  ${results.macIconset ? '✅' : '❌'}`);
  console.log(`Mac .icns:     ${results.macIcns ? '✅' : '❌'}`);
  console.log('');
  
  const allSuccess = Object.values(results).every(r => r);
  
  if (allSuccess) {
    console.log('🎉 All icons generated successfully!');
    console.log('');
    console.log('Icons have been generated to the corresponding brands directory.');
    console.log(`   Location: ${brandConfig.paths.assets}`);
  } else {
    console.log('⚠️  Some icons failed to generate, please check the error messages above');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Script execution error:', error);
    process.exit(1);
  });
}

module.exports = {
  generateWindowsIco,
  generateWindowsSvg,
  generateMacIconset,
  generateMacIcns
};
