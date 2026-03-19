const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = path.resolve(__dirname, '../node_modules/@kutalia/whisper-node-addon/dist');

if (!fs.existsSync(baseDir)) {
  console.log('[fix-whisper] addon directory not found, skipping');
  process.exit(0);
}

function fixRpath(filePath) {
    try {
        // Try to add @loader_path to RPATH
        execSync(`install_name_tool -add_rpath @loader_path "${filePath}"`, { stdio: 'pipe' });
        console.log(`[fix-whisper] Added @loader_path to RPATH for ${path.basename(filePath)}`);
    } catch (e) {
        // If it fails, check if it's because it's already there
        const stderr = e.stderr.toString();
        if (stderr.includes('would create a duplicate')) {
             console.log(`[fix-whisper] @loader_path already in RPATH for ${path.basename(filePath)}`);
        } else {
             // Try to changing the existing broken path to @loader_path if adding failed for some other reason (like space)
             // But usually duplicate is the only "soft" error. 
             // Let's try to delete the known broken CI path just in case to clean up, though not strictly necessary if we added loader_path.
             // Given the previous error log, we know one bad path: /Users/runner/work/whisper-node-addon/whisper-node-addon/deps/whisper.cpp/build/Release
             console.log(`[fix-whisper] Note: Could not add @loader_path to ${path.basename(filePath)} (might already exist or other error): ${stderr.split('\n')[0]}`);
        }
    }
}

const mappings = [
  { src: 'mac-arm64', dest: 'darwin-arm64' },
  { src: 'mac-x64', dest: 'darwin-x64' }
];

mappings.forEach(({ src, dest }) => {
  const srcPath = path.join(baseDir, src);
  const destPath = path.join(baseDir, dest);

  if (fs.existsSync(srcPath)) {
      if (!fs.existsSync(destPath)) {
        console.log(`[fix-whisper] Copying ${src} to ${dest} to fix path resolution...`);
        try {
            fs.cpSync(srcPath, destPath, { recursive: true });
            console.log(`[fix-whisper] Successfully created ${dest}`);
        } catch (e) {
            console.error(`[fix-whisper] Failed to create ${dest}:`, e);
        }
      } else {
        console.log(`[fix-whisper] ${dest} already exists`);
      }

      // Now fix RPATH for all .node and .dylib files in the destination
      if (fs.existsSync(destPath)) {
          const files = fs.readdirSync(destPath);
          files.forEach(file => {
              if (file.endsWith('.node') || file.endsWith('.dylib')) {
                  fixRpath(path.join(destPath, file));
              }
          });
      }
  }
});
