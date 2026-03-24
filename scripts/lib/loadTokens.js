/**
 * Token loading module
 * Reads GitHub and Copilot tokens from the auth.json file
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const brandConfig = require('../brand-config');

/**
 * Get the auth.json file path
 */
function getAuthFilePath() {
  // Default path
  // Prefer productName as directory name, consistent with Electron app.setName()
  const appDirName = brandConfig.config.productName || 'openkosmos-app';

  // Windows: AppData/Roaming/<AppName>
  // macOS: Library/Application Support/<AppName>
  // Linux: .config/<AppName>
  let userDataRoot;
  if (process.platform === 'win32') {
    userDataRoot = path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    userDataRoot = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    userDataRoot = path.join(os.homedir(), '.config');
  }

  const defaultPath = path.join(
    userDataRoot,
    appDirName,
    'profiles',
    'yanhu_microsoft',
    'auth.json',
  );

  // Support custom path via environment variable
  const customPath = process.env.KOSMOS_AUTH_FILE;

  return customPath || defaultPath;
}

/**
 * Load tokens from auth.json
 */
function loadTokensFromAuthFile() {
    const authFilePath = getAuthFilePath();
    
    try {
        // Check if file exists
        if (!fs.existsSync(authFilePath)) {
            throw new Error(`auth.json file does not exist: ${authFilePath}`);
        }
        
        // Read and parse the file
        const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
        
        // Validate data structure
        if (!authData.ghcAuth || !authData.ghcAuth.gitHubTokens || !authData.ghcAuth.copilotTokens) {
            throw new Error('auth.json file format is incorrect');
        }
        
        const gitHubTokens = authData.ghcAuth.gitHubTokens;
        const copilotTokens = authData.ghcAuth.copilotTokens;
        
        // Return tokens
        return {
            refresh: gitHubTokens.access_token,
            access: copilotTokens.token,
            expires: copilotTokens.expires_at * 1000, // Convert to milliseconds
            user: authData.ghcAuth.user,
            authFilePath: authFilePath
        };
        
    } catch (error) {
        console.error(`❌ Failed to load tokens: ${error.message}`);
        throw error;
    }
}

/**
 * Get tokens
 * Reads from environment variables first, otherwise from auth.json
 */
function getTokens() {
    // If environment variables are set, use them first
    if (process.env.GITHUB_COPILOT_REFRESH_TOKEN && 
        process.env.GITHUB_COPILOT_ACCESS_TOKEN) {
        return {
            refresh: process.env.GITHUB_COPILOT_REFRESH_TOKEN,
            access: process.env.GITHUB_COPILOT_ACCESS_TOKEN,
            expires: parseInt(process.env.GITHUB_COPILOT_TOKEN_EXPIRES) || Date.now() + 24 * 60 * 60 * 1000,
            source: 'environment'
        };
    }
    
    // Otherwise read from auth.json
    const tokens = loadTokensFromAuthFile();
    tokens.source = 'auth_file';
    return tokens;
}

/**
 * Validate whether tokens are valid
 */
function validateTokens(tokens) {
    if (!tokens.refresh || !tokens.access) {
        throw new Error('tokens are incomplete');
    }
    
    const now = Date.now();
    if (tokens.expires && now >= tokens.expires) {
        console.warn('⚠️  Warning: Access token has expired');
        return false;
    }
    
    return true;
}

/**
 * Print token information
 */
function printTokenInfo(tokens) {
    console.log('🔐 Token info:');
    console.log(`   Source: ${tokens.source === 'environment' ? 'Environment variables' : 'auth.json'}`);
    
    if (tokens.source === 'auth_file' && tokens.authFilePath) {
        console.log(`   File path: ${tokens.authFilePath}`);
    }
    
    if (tokens.user) {
        console.log(`   User: ${tokens.user.name} (@${tokens.user.login})`);
        console.log(`   Subscription: ${tokens.user.copilotPlan}`);
    }
    
    if (tokens.expires) {
        const now = Date.now();
        if (now < tokens.expires) {
            const remaining = Math.floor((tokens.expires - now) / 1000 / 60 / 60);
            console.log(`   Validity: ${remaining} hours remaining`);
        } else {
            console.log('   Validity: Expired ❌');
        }
    }
    
    console.log();
}

module.exports = {
    getTokens,
    loadTokensFromAuthFile,
    validateTokens,
    printTokenInfo,
    getAuthFilePath
};