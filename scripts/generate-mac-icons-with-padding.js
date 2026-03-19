const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const brandConfig = require('./brand-config');

/**
 * Generate macOS icons with transparent padding from Windows 1024x1024 icon
 * Content scaled to 80.9%, remaining space is transparent margin
 */

const winSource = path.join(brandConfig.paths.assetsWin, 'icon_round_1024x1024.png');
const macSource = path.join(brandConfig.paths.assetsMac, 'icon_round_1024x1024.png');
console.log('macSource:', macSource);
console.log('winSource:', winSource);

// Prefer source file from Mac directory, fall back to Windows directory if not found
const sourceIcon = fs.existsSync(macSource) ? macSource : winSource;

const macIconsDir = brandConfig.paths.assetsMac;
const macIconsetDir = path.join(macIconsDir, 'app.iconset');
const macIconPath = brandConfig.paths.iconMac;

// macOS iconset standard sizes
const iconSizes = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' },
];

// Content occupies 80.9% of the canvas
const CONTENT_PERCENT = 0.809;

async function generateIconWithPadding(targetSize, outputPath) {
  try {
    // Calculate content size (80.9% of canvas size)
    const contentSize = Math.round(targetSize * CONTENT_PERCENT);
    const padding = Math.round((targetSize - contentSize) / 2);

    // Resize from 1024x1024 source icon
    const resizedImage = await sharp(sourceIcon)
      .resize(contentSize, contentSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();

    // Create canvas with padding and center the content
    await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: resizedImage,
          top: padding,
          left: padding,
        },
      ])
      .png()
      .toFile(outputPath);

    console.log(
      `✓ Generated: ${path.basename(
        outputPath,
      )} (${targetSize}x${targetSize}, content ${contentSize}x${contentSize}, margin ${padding}px)`,
    );
  } catch (error) {
    console.error(`✗ Generation failed ${path.basename(outputPath)}:`, error.message);
    throw error;
  }
}

async function generateAllIcons() {
  console.log(
    'Generating macOS icons from Windows 1024x1024 icon (content 80.9%, rest is transparent margin)...\n',
  );

  // Check source icon
  if (!fs.existsSync(sourceIcon)) {
    console.error(`Error: Source icon does not exist: ${sourceIcon}`);
    process.exit(1);
  }

  console.log(`Source icon: ${sourceIcon}`);
  console.log(`Target directory: ${macIconsetDir}\n`);

  // Clear and rebuild iconset directory
  if (fs.existsSync(macIconsetDir)) {
    console.log('Clearing existing iconset directory...');
    fs.rmSync(macIconsetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(macIconsetDir, { recursive: true });

  // Generate icons of all sizes
  console.log('Starting icon generation...\n');
  for (const icon of iconSizes) {
    const outputPath = path.join(macIconsetDir, icon.name);
    await generateIconWithPadding(icon.size, outputPath);
  }

  console.log('\nAll icons generated successfully!');
  console.log(`\nGenerated icons saved in: ${macIconsetDir}`);

  // Generate .icns file
  console.log('\nGenerating .icns file...');
  
  if (process.platform === 'darwin') {
    try {
      const icnsPath = macIconPath;
      execSync(`iconutil -c icns "${macIconsetDir}" -o "${icnsPath}"`, {
        stdio: 'inherit',
      });
      console.log(`✓ Generated .icns file: ${icnsPath}`);
    } catch (error) {
      console.error('✗ Failed to generate .icns file:', error.message);
      throw error;
    }
  } else {
     console.log('⚠️  Windows/Linux system detected, iconutil is not available.');
     console.log('🔄 Attempting to use png2icons to generate .icns (as fallback)...');

     try {
       // Use the generated largest size icon (1024x1024) as source
       const sourcePng = path.join(macIconsetDir, 'icon_512x512@2x.png');
       // png2icons will automatically add suffix, so remove the .icns extension
       const outputBase = macIconPath.replace(/\.icns$/, '');
       
       if (!fs.existsSync(sourcePng)) {
         throw new Error(`Cannot find source file: ${sourcePng}`);
       }

       // -icns flag is used to generate .icns
       const cmd = `npx -y png2icons "${sourcePng}" "${outputBase}" -icns`;
       execSync(cmd, { stdio: 'inherit' });
       
       console.log(`✓ Successfully generated .icns file: ${macIconPath}`);
     } catch (error) {
       console.error('✗ png2icons generation failed:', error.message);
       console.log('ℹ️  Please run this script on macOS for best results, or manually convert the generated iconset.');
       // Don't throw error since iconset was already generated successfully
     }
  }

  console.log(
    '\n✓ Done! macOS icons have been generated (content scaled to 80.9%, remaining space is transparent margin).',
  );
}

// Check if sharp is installed
try {
  require.resolve('sharp');
  generateAllIcons().catch(error => {
    console.error('\nError:', error);
    process.exit(1);
  });
} catch (e) {
  console.error('Error: sharp library must be installed first');
  console.error('Run: npm install --save-dev sharp');
  process.exit(1);
}
