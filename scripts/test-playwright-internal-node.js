/**
 * Validate whether the app-managed internal "node" shim can drive
 * Playwright's CLI without relaunching Electron.
 *
 * Default behavior is non-destructive:
 * - verify internal node shim exists
 * - run `playwright-core/cli.js --help`
 * - run `playwright-core/cli.js install chromium-headless-shell --dry-run`
 *
 * Usage:
 *   node scripts/test-playwright-internal-node.js
 *   node scripts/test-playwright-internal-node.js --user-data-dir "/path/to/userData"
 *   node scripts/test-playwright-internal-node.js --real-install
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const result = {
    brand: 'openkosmos',
    userDataDir: '',
    realInstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--brand') {
      result.brand = argv[index + 1] || result.brand;
      index += 1;
      continue;
    }
    if (arg === '--user-data-dir') {
      result.userDataDir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--real-install') {
      result.realInstall = true;
    }
  }

  return result;
}

function resolveDefaultUserDataDir(brand) {
  const appName = 'openkosmos-app';

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }

  return path.join(os.homedir(), '.config', appName);
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => {
    if (/\s/.test(part)) {
      return JSON.stringify(part);
    }
    return part;
  }).join(' ');
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code || 0, stdout, stderr });
    });

    child.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userDataDir = args.userDataDir || resolveDefaultUserDataDir(args.brand);
  const binDir = path.join(userDataDir, 'bin');
  const nodeShim = path.join(binDir, process.platform === 'win32' ? 'node.cmd' : 'node');
  const bunBinary = path.join(binDir, process.platform === 'win32' ? 'bun.exe' : 'bun');
  const playwrightCli = path.join(process.cwd(), 'node_modules', 'playwright-core', 'cli.js');

  console.log('=== Playwright Internal Node Validation ===');
  console.log(`Platform:      ${process.platform} ${process.arch}`);
  console.log(`Brand:         ${args.brand}`);
  console.log(`User data dir: ${userDataDir}`);
  console.log(`Bin dir:       ${binDir}`);
  console.log(`Node shim:     ${nodeShim}`);
  console.log(`Bun binary:    ${bunBinary}`);
  console.log(`CLI path:      ${playwrightCli}`);
  console.log(`Mode:          ${args.realInstall ? 'real install' : 'dry run'}`);
  console.log('');

  const requiredPaths = [
    { label: 'Bin directory', filePath: binDir },
    { label: 'Node shim', filePath: nodeShim },
    { label: 'Bun binary', filePath: bunBinary },
    { label: 'Playwright CLI', filePath: playwrightCli },
  ];

  const missing = requiredPaths.filter((item) => !fs.existsSync(item.filePath));
  if (missing.length > 0) {
    console.error('Missing required files:');
    for (const item of missing) {
      console.error(`- ${item.label}: ${item.filePath}`);
    }
    process.exitCode = 1;
    return;
  }

  const helpArgs = [playwrightCli, '--help'];
  console.log(`> ${formatCommand(nodeShim, helpArgs)}`);
  const helpResult = await runCommand(nodeShim, helpArgs);
  console.log(`help exit code: ${helpResult.code}`);
  if (helpResult.stdout) {
    console.log(helpResult.stdout.trim());
  }
  if (helpResult.stderr) {
    console.error(helpResult.stderr.trim());
  }
  console.log('');

  if (helpResult.code !== 0) {
    console.error('CLI help execution failed. Internal node shim is not safe to use for Playwright CLI.');
    process.exitCode = helpResult.code || 1;
    return;
  }

  const installArgs = args.realInstall
    ? [playwrightCli, 'install', 'chromium-headless-shell']
    : [playwrightCli, 'install', 'chromium-headless-shell', '--dry-run'];

  console.log(`> ${formatCommand(nodeShim, installArgs)}`);
  const installResult = await runCommand(nodeShim, installArgs);
  console.log(`install exit code: ${installResult.code}`);
  if (installResult.stdout) {
    console.log(installResult.stdout.trim());
  }
  if (installResult.stderr) {
    console.error(installResult.stderr.trim());
  }
  console.log('');

  if (installResult.code !== 0) {
    console.error('Install validation failed. Internal node shim should not be used yet.');
    process.exitCode = installResult.code || 1;
    return;
  }

  console.log('Validation passed. Internal node shim can execute Playwright CLI in this environment.');
}

main().catch((error) => {
  console.error('Validation script crashed:', error);
  process.exitCode = 1;
});