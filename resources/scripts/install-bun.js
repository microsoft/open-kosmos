const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const StreamZip = require('node-stream-zip')
const { downloadWithRedirects } = require('./download')

// Base URL for downloading bun binaries
const BUN_RELEASE_BASE_URL = 'https://github.com/oven-sh/bun/releases/download'
const DEFAULT_BUN_VERSION = '1.3.6' // Default fallback version
// Mapping of platform+arch to binary package name
const BUN_PACKAGES = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'win32-x64': 'bun-windows-x64.zip',
  'win32-x64-baseline': 'bun-windows-x64-baseline.zip',
  'win32-arm64': 'bun-windows-x64.zip',
  'win32-arm64-baseline': 'bun-windows-x64-baseline.zip',
  'linux-x64': 'bun-linux-x64.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
}

/**
 * Main function to install Bun
 * @param {string} version - Content of version to install
 * @returns {Promise<number>} - Exit code (0 for success, non-0 for failure)
 */
async function main() {
  const version = process.argv[2] || DEFAULT_BUN_VERSION
  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`

  console.log(`Starting installation of Bun ${version} for ${platformKey}...`)

  if (!BUN_PACKAGES[platformKey]) {
    // Fallbacks for windows
    if (platform === 'win32') {
      if (arch === 'ia32') {
        console.warn('Warning: Bun does not officially support 32-bit Windows. Trying x64 version (might fail)...')
        // Try x64 anyway in case emulation works or detection is weird
      }
    }
    
    if(!BUN_PACKAGES[platformKey]) {
       console.error(`Error: Unsupported platform/architecture: ${platformKey}`)
       return 101
    }
  }

  const packageName = BUN_PACKAGES[platformKey]
  
  // Construct paths
  // Use .kosmos/bin by default pending main process config, but allow override or check parent dir
  // Actually, the main process will pass the bin dir? No, standardizing on a location.
  // The documentation says: path.join(app.getPath('userData'), 'bin')
  // Since this script runs in a spawned process, we might not have 'app'.
  // We can pass the install directory as an argument or default to a standard location relative to home.
  // Docs say: %AppData%\Kosmos\bin or ~/.config/Kosmos/bin
  // But passing it as an arg is safer.
  
  // Let's assume arg 3 is the install directory if provided
  let binDir = process.argv[3]
  
  if (!binDir) {
      console.error('Error: Installation directory must be provided as the second argument.')
      return 102
  }

  console.log(`Target directory: ${binDir}`)

  // Ensure directories exist
  if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
  }

  // Download URL for the specific binary
  // Format: BASE_URL/v{version}/{packageName}
  // Note: GitCode releases might not need 'v' prefix or might need it. 
  // Cherry Studio sample URL: https://gitcode.com/CherryHQ/bun/releases/download/bun-v1.1.26/bun-windows-x64.zip
  // So it seems it needs bun-v{version} tag.
  
  // Let's adjust based on the provided script context.
  // The provided sample used BUN_RELEASE_BASE_URL/bun-v{version}/{packageName}
  
  const downloadUrl = `${BUN_RELEASE_BASE_URL}/bun-v${version}/${packageName}`
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading Bun ${version} from ${downloadUrl}...`)
    await downloadWithRedirects(downloadUrl, tempFilename)

    console.log(`Extracting ${packageName}...`)
    const zip = new StreamZip.async({ file: tempFilename })
    
    // Get entries to find the inner folder name usually bun-windows-x64/bun.exe
    const entries = await zip.entries()
    
    for (const entry of Object.values(entries)) {
        if (!entry.isDirectory) {
            // Flatten structure: extract bun.exe directly to binDir
            const filename = path.basename(entry.name)
            
            // Only extract the binary
            if (filename === 'bun' || filename === 'bun.exe') {
                 const outputPath = path.join(binDir, filename)
                 console.log(`Extracting ${entry.name} -> ${outputPath}`)
                 await zip.extract(entry.name, outputPath)
                 
                 if (platform !== 'win32') {
                     fs.chmodSync(outputPath, 0o755)
                 }
            }
        }
    }
    
    await zip.close()
    
    // Verify installation
    const binaryName = platform === 'win32' ? 'bun.exe' : 'bun'
    const finalPath = path.join(binDir, binaryName)
    
    if (fs.existsSync(finalPath)) {
         console.log(`Successfully installed Bun at ${finalPath}`)
         
         // Clean up temp file
         try { fs.unlinkSync(tempFilename) } catch (e) {}
         
         return 0
    } else {
         console.error('Error: Binary not found after extraction.')
         return 105
    }

  } catch (error) {
    console.error(`Installation failed: ${error.message}`)
    if (fs.existsSync(tempFilename)) {
        try { fs.unlinkSync(tempFilename) } catch(e) {}
    }
    return 103
  }
}

main().then(code => process.exit(code))
