/**
 * Generate DMG Background Image for macOS Installer
 * 
 * Creates a clean, professional DMG background with:
 * - Solid arrow pointing from app icon to Applications folder
 * - Proper spacing and alignment (inspired by Claude/Codex)
 * 
 * Usage: node scripts/generate-dmg-background.js
 * 
 * Requires: Node.js with canvas package
 * Install: npm install canvas (if not already installed)
 */

const fs = require('fs');
const path = require('path');

// DMG window dimensions (actual size)
const WINDOW_WIDTH = 540;
const WINDOW_HEIGHT = 380;

// Output dimensions (@2x for Retina)
const OUTPUT_WIDTH = WINDOW_WIDTH * 2;
const OUTPUT_HEIGHT = WINDOW_HEIGHT * 2;

// Icon positions (scaled to @2x)
const APP_ICON_X = 140 * 2;
const APP_ICON_Y = 170 * 2;
const APPS_FOLDER_X = 400 * 2;
const APPS_FOLDER_Y = 170 * 2;

// Arrow configuration
const ARROW_Y = 170 * 2;
const ARROW_START_X = 200 * 2;  // Start after app icon
const ARROW_END_X = 340 * 2;    // End before Applications folder
const ARROW_COLOR = '#666666';
const ARROW_HEAD_SIZE = 24;
const ARROW_LINE_WIDTH = 4;

async function generateBackground() {
  let canvas;
  
  try {
    // Try to use canvas package
    const { createCanvas } = require('canvas');
    canvas = createCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  } catch (e) {
    console.log('Canvas package not found. Generating SVG instead...');
    generateSVG();
    return;
  }
  
  const ctx = canvas.getContext('2d');
  
  // Background - light gradient (similar to macOS style)
  const gradient = ctx.createLinearGradient(0, 0, 0, OUTPUT_HEIGHT);
  gradient.addColorStop(0, '#f5f5f7');
  gradient.addColorStop(1, '#e8e8eb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  
  // Draw solid arrow
  ctx.strokeStyle = ARROW_COLOR;
  ctx.fillStyle = ARROW_COLOR;
  ctx.lineWidth = ARROW_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Arrow line
  ctx.beginPath();
  ctx.moveTo(ARROW_START_X, ARROW_Y);
  ctx.lineTo(ARROW_END_X - ARROW_HEAD_SIZE, ARROW_Y);
  ctx.stroke();
  
  // Arrow head (solid triangle)
  ctx.beginPath();
  ctx.moveTo(ARROW_END_X, ARROW_Y);
  ctx.lineTo(ARROW_END_X - ARROW_HEAD_SIZE * 1.5, ARROW_Y - ARROW_HEAD_SIZE * 0.8);
  ctx.lineTo(ARROW_END_X - ARROW_HEAD_SIZE * 1.5, ARROW_Y + ARROW_HEAD_SIZE * 0.8);
  ctx.closePath();
  ctx.fill();
  
  // Save as PNG
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(__dirname, '..', 'build', 'dmg-background.png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`DMG background saved to: ${outputPath}`);
}

function generateSVG() {
  // Generate SVG as fallback (can be converted to PNG using other tools)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#f5f5f7"/>
      <stop offset="100%" style="stop-color:#e8e8eb"/>
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="100%" height="100%" fill="url(#bg)"/>
  
  <!-- Arrow line -->
  <line 
    x1="${ARROW_START_X}" 
    y1="${ARROW_Y}" 
    x2="${ARROW_END_X - ARROW_HEAD_SIZE * 1.5}" 
    y2="${ARROW_Y}" 
    stroke="${ARROW_COLOR}" 
    stroke-width="${ARROW_LINE_WIDTH}" 
    stroke-linecap="round"
  />
  
  <!-- Arrow head -->
  <polygon 
    points="${ARROW_END_X},${ARROW_Y} ${ARROW_END_X - ARROW_HEAD_SIZE * 1.5},${ARROW_Y - ARROW_HEAD_SIZE * 0.8} ${ARROW_END_X - ARROW_HEAD_SIZE * 1.5},${ARROW_Y + ARROW_HEAD_SIZE * 0.8}" 
    fill="${ARROW_COLOR}"
  />
</svg>`;

  const outputPath = path.join(__dirname, '..', 'build', 'dmg-background.svg');
  fs.writeFileSync(outputPath, svg);
  console.log(`SVG saved to: ${outputPath}`);
  console.log('Convert to PNG @2x using: sips -s format png dmg-background.svg --out dmg-background.png');
  console.log('Or use online tools like svgtopng.com');
}

generateBackground();
