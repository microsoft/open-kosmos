const path = require('path');
const fs = require('fs');

// 1. Determine Brand Name
// Priority: npm_config_brand (CLI: --brand=xxx) > BRAND (Environment Variable) > 'kosmos' (Default)
const brandName =  process.env.BRAND || 'kosmos';

const repoRoot = path.resolve(__dirname, '..');
const brandDir = path.join(repoRoot, 'brands', brandName);
const assetsDir = path.join(brandDir, 'assets');
const configFile = path.join(brandDir, 'config.json');

// 2. Validate validity
if (!fs.existsSync(configFile)) {
  console.error(`[BrandConfig] Error: Configuration for brand "${brandName}" not found at ${configFile}`);
  process.exit(1);
}

// 3. Load Configuration
const config = require(configFile);

console.log(`[BrandConfig] Active Brand: ${brandName}`);
console.log(`[BrandConfig] Product Name: ${config.productName}`);

module.exports = {
  name: brandName,
  config: config,
  paths: {
    root: brandDir,
    assets: assetsDir,
    // Icons
    iconMac: path.join(assetsDir, 'mac/app.icns'),
    iconWin: path.join(assetsDir, 'win/app.ico'),
    
    // Asset Directories (for generation scripts)
    assetsMac: path.join(assetsDir, 'mac'),
    assetsWin: path.join(assetsDir, 'win'),
  }
};
