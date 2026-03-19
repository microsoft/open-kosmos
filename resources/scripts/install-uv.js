const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const StreamZip = require('node-stream-zip')
const { downloadWithRedirects } = require('./download')

// Base URL for downloading uv binaries
const UV_RELEASE_BASE_URL = 'https://github.com/astral-sh/uv/releases/download'
const DEFAULT_UV_VERSION = '0.6.17' // Fallback version

// Mapping of platform+arch to binary package name
const UV_PACKAGES = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
  'win32-ia32': 'uv-i686-pc-windows-msvc.zip',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-ia32': 'uv-i686-unknown-linux-gnu.tar.gz',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
}

async function main() {
  const version = process.argv[2] || DEFAULT_UV_VERSION
  const platform = os.platform()
  const arch = os.arch()
  const platformKey = `${platform}-${arch}`
  
  // Let's assume arg 3 is the install directory
  let binDir = process.argv[3]
  if (!binDir) {
      console.error('Error: Installation directory must be provided as the second argument.')
      return 102
  }

  console.log(`Starting installation of uv ${version} for ${platformKey} to ${binDir}...`)

  if (!UV_PACKAGES[platformKey]) {
     console.error(`Error: Unsupported platform/architecture: ${platformKey}`)
     return 101
  }

  // Ensure directories exist
  if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
  }

  const packageName = UV_PACKAGES[platformKey]
  // Fix: GitHub release URLs use the version tag directly, e.g. /download/0.6.17/...
  const downloadUrl = `${UV_RELEASE_BASE_URL}/${version}/${packageName}`
  const tempdir = os.tmpdir()
  const tempFilename = path.join(tempdir, packageName)
  const isTarGz = packageName.endsWith('.tar.gz')

  try {
    console.log(`Downloading uv... URL: ${downloadUrl}`)
    await downloadWithRedirects(downloadUrl, tempFilename)

    console.log(`Extracting...`)

    if (isTarGz) {
      // Use system tar for tar.gz
      const tempExtractDir = path.join(tempdir, `uv-extract-${Date.now()}`)
      fs.mkdirSync(tempExtractDir, { recursive: true })

      try {
        execSync(`tar -xzf "${tempFilename}" -C "${tempExtractDir}"`, { stdio: 'inherit' })

        // Find binary in extracted structure and move to binDir
        const findAndMoveFiles = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name)
              if (entry.isDirectory()) {
                findAndMoveFiles(fullPath)
              } else {
                const filename = path.basename(entry.name)
                // We only care about the 'uv' binary (and maybe uvx? usually just uv is enough)
                if (filename === 'uv' || filename === 'uvx') {
                    const outputPath = path.join(binDir, filename)
                    fs.copyFileSync(fullPath, outputPath)
                    fs.chmodSync(outputPath, 0o755)
                    console.log(`Installed ${filename}`)
                }
              }
            }
        }
        findAndMoveFiles(tempExtractDir)
      } finally {
        try { fs.rmSync(tempExtractDir, { recursive: true, force: true }) } catch(e) {}
      }

    } else {
      // Use StreamZip for zip (Windows)
      const zip = new StreamZip.async({ file: tempFilename })
      const entries = await zip.entries()
      
      for (const entry of Object.values(entries)) {
        if (!entry.isDirectory) {
          const filename = path.basename(entry.name)
          if (filename === 'uv.exe' || filename === 'uvx.exe') {
              const outputPath = path.join(binDir, filename)
              await zip.extract(entry.name, outputPath)
              console.log(`Installed ${filename}`)
          }
        }
      }
      await zip.close()
    }

    // Cleanup
    try { fs.unlinkSync(tempFilename) } catch(e) {}
    
    console.log(`Successfully installed uv ${version}`)
    return 0

  } catch (error) {
    console.error(`Installation failed: ${error.message}`)
    try { if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename) } catch(e) {}
    return 103
  }
}

main().then(code => process.exit(code))
