const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ASSETS_WIN = path.join(__dirname, '..', 'brands', 'openkosmos', 'assets', 'win');
const ASSETS_MAC = path.join(__dirname, '..', 'brands', 'openkosmos', 'assets', 'mac');

/**
 * Generate macOS icons with transparent padding from a Windows 1024x1024 source icon.
 * Content is scaled to 80.9%; the remaining space is transparent margin.
 */

const winSource = path.join(ASSETS_WIN, 'icon_round_1024x1024.png');
const macSource = path.join(ASSETS_MAC, 'icon_round_1024x1024.png');
console.log('macSource:', macSource);
console.log('winSource:', winSource);

// Prefer the source file under the Mac directory; fall back to the Windows directory if absent.
const sourceIcon = fs.existsSync(macSource) ? macSource : winSource;

const macIconsDir = ASSETS_MAC;
const macIconsetDir = path.join(macIconsDir, 'app.iconset');
const macIconPath = path.join(ASSETS_MAC, 'app.icns');

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

    // Resize from the 1024x1024 source icon
    const resizedImage = await sharp(sourceIcon)
      .resize(contentSize, contentSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();

    // Create a canvas with padding and center the content
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
      )} (${targetSize}x${targetSize}, content ${contentSize}x${contentSize}, padding ${padding}px)`,
    );
  } catch (error) {
    console.error(`✗ Failed to generate ${path.basename(outputPath)}:`, error.message);
    throw error;
  }
}

async function generateAllIcons() {
  console.log(
    'Generating macOS icons from Windows 1024x1024 source (content 80.9%, remainder transparent padding)...\n',
  );

  // Check source icon
  if (!fs.existsSync(sourceIcon)) {
    console.error(`Error: source icon not found: ${sourceIcon}`);
    process.exit(1);
  }

  console.log(`Source icon: ${sourceIcon}`);
  console.log(`Target directory: ${macIconsetDir}\n`);

  // Clear and recreate the iconset directory
  if (fs.existsSync(macIconsetDir)) {
    console.log('Clearing existing iconset directory...');
    fs.rmSync(macIconsetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(macIconsetDir, { recursive: true });

  // Generate icons at all sizes
  console.log('Generating icons...\n');
  for (const icon of iconSizes) {
    const outputPath = path.join(macIconsetDir, icon.name);
    await generateIconWithPadding(icon.size, outputPath);
  }

  console.log('\nAll icons generated!');
  console.log(`\nGenerated icons saved to: ${macIconsetDir}`);

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
     console.log('⚠️  Windows/Linux detected; iconutil is not available.');
     console.log('🔄 Attempting to generate .icns with png2icons (fallback)...');

     try {
       // Use the largest generated icon (1024x1024) as source
       const sourcePng = path.join(macIconsetDir, 'icon_512x512@2x.png');
       // png2icons auto-appends the extension, so strip .icns suffix
       const outputBase = macIconPath.replace(/\.icns$/, '');
       
       if (!fs.existsSync(sourcePng)) {
         throw new Error(`Source file not found: ${sourcePng}`);
       }

       // -icns flag generates an .icns file
       const cmd = `npx -y png2icons "${sourcePng}" "${outputBase}" -icns`;
       execSync(cmd, { stdio: 'inherit' });
       
       console.log(`✓ Successfully generated .icns file: ${macIconPath}`);
     } catch (error) {
       console.error('✗ png2icons generation failed:', error.message);
       console.log('ℹ️  Run this script on macOS for best results, or manually convert the generated iconset.');
       // Do not throw — the iconset was generated successfully
     }
  }

  console.log(
    '\n✓ Done! macOS icons generated (content scaled to 80.9%, remaining space is transparent padding).',
  );
}

// Check that sharp is installed
try {
  require.resolve('sharp');
  generateAllIcons().catch(error => {
    console.error('\nError:', error);
    process.exit(1);
  });
} catch (e) {
  console.error('Error: the sharp library must be installed first');
  console.error('Run: npm install --save-dev sharp');
  process.exit(1);
}
