/**
 * test-bun-playwright-install.js
 *
 * Tests whether the Bun-backed internal node shim can actually download
 * the Playwright Chromium browser — replicating the exact logic in
 * PlaywrightManager._getInstallStrategies() and _runInstallCommand().
 *
 * This script was written to diagnose the 5-minute install timeout seen in
 * kosmos-2026-03-12.log where the Bun shim (node.cmd) timed out during
 * Playwright browser download, suggesting Bun incompatibility with
 * Playwright's network/download layer.
 *
 * Usage:
 *   node scripts/test-bun-playwright-install.js              # dry-run all strategies
 *   node scripts/test-bun-playwright-install.js --real-install  # actual download
 *   node scripts/test-bun-playwright-install.js --strategy bun  # only test bun shim
 *   node scripts/test-bun-playwright-install.js --strategy node # only test system node
 *   node scripts/test-bun-playwright-install.js --strategy npx  # only test npx
 *   node scripts/test-bun-playwright-install.js --user-data-dir "C:\path\to\userData"
 *   node scripts/test-bun-playwright-install.js --timeout 120   # timeout in seconds
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {
    brand: 'openkosmos',
    userDataDir: '',
    realInstall: false,
    strategy: 'all', // 'all' | 'bun' | 'node' | 'npx'
    timeoutMs: 5 * 60 * 1000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--brand') { result.brand = argv[++i] || result.brand; continue; }
    if (arg === '--user-data-dir') { result.userDataDir = argv[++i] || ''; continue; }
    if (arg === '--real-install') { result.realInstall = true; continue; }
    if (arg === '--strategy') { result.strategy = argv[++i] || 'all'; continue; }
    if (arg === '--timeout') { result.timeoutMs = parseInt(argv[++i], 10) * 1000; continue; }
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

// ── Process runner ───────────────────────────────────────────────────────────

function runCommand(command, args, { shell = false, timeoutMs = 5 * 60 * 1000, label = '' } = {}) {
  return new Promise((resolve) => {
    const startMs = Date.now();
    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, elapsedMs: Date.now() - startMs });
    };

    let child;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
        env: { ...process.env },
        windowsHide: true,
      });
    } catch (spawnErr) {
      finish({ code: -1, stdout: '', stderr: '', error: `spawn threw: ${spawnErr.message}` });
      return;
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });

    child.on('error', (err) => {
      finish({ code: -1, stdout, stderr, error: err.message });
    });

    // Timeout guard
    const timer = setTimeout(() => {
      if (settled) return;
      console.error(`\n[TIMEOUT] ${label} exceeded ${timeoutMs / 1000}s, killing process...`);
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 2000);
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    // Don't let timer block process exit
    if (timer.unref) timer.unref();
  });
}

// ── Strategy builder (mirrors PlaywrightManager._getInstallStrategies) ───────

function buildStrategies(nodeShim, playwrightCli, realInstall) {
  const installSubArgs = realInstall
    ? ['install', 'chromium-headless-shell']
    : ['install', 'chromium-headless-shell', '--dry-run'];

  const strategies = [];

  if (nodeShim && fs.existsSync(nodeShim)) {
    strategies.push({
      id: 'bun',
      label: 'Bun node shim (shell: true)',
      command: nodeShim,
      args: [playwrightCli, ...installSubArgs],
      // KEY: on Windows .cmd files need shell:true — this is the fix we shipped
      shell: process.platform === 'win32',
    });
    strategies.push({
      id: 'bun-no-shell',
      label: 'Bun node shim (shell: false) ← pre-fix behavior',
      command: nodeShim,
      args: [playwrightCli, ...installSubArgs],
      shell: false,
    });
  } else {
    console.warn(`[WARN] Bun node shim not found at: ${nodeShim}`);
  }

  strategies.push({
    id: 'node',
    label: 'System node (node.exe)',
    command: process.platform === 'win32' ? 'node.exe' : 'node',
    args: [playwrightCli, ...installSubArgs],
    shell: false,
  });

  strategies.push({
    id: 'npx',
    label: 'npx fallback',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['playwright', 'install', 'chromium-headless-shell', ...(realInstall ? [] : ['--dry-run'])],
    shell: process.platform === 'win32',
  });

  return strategies;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userDataDir = args.userDataDir || resolveDefaultUserDataDir(args.brand);
  const binDir = path.join(userDataDir, 'bin');
  const nodeShim = path.join(binDir, process.platform === 'win32' ? 'node.cmd' : 'node');
  const bunBinary = path.join(binDir, process.platform === 'win32' ? 'bun.exe' : 'bun');
  const playwrightCli = path.join(process.cwd(), 'node_modules', 'playwright-core', 'cli.js');

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Bun-shim × Playwright Browser Install Test      ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`Platform:       ${process.platform} ${process.arch}`);
  console.log(`Brand:          ${args.brand}`);
  console.log(`User data dir:  ${userDataDir}`);
  console.log(`Node shim:      ${nodeShim}  [${fs.existsSync(nodeShim) ? 'EXISTS' : 'MISSING'}]`);
  console.log(`Bun binary:     ${bunBinary}  [${fs.existsSync(bunBinary) ? 'EXISTS' : 'MISSING'}]`);
  console.log(`Playwright CLI: ${playwrightCli}  [${fs.existsSync(playwrightCli) ? 'EXISTS' : 'MISSING'}]`);
  console.log(`Mode:           ${args.realInstall ? '⚠️  REAL INSTALL' : 'dry-run'}`);
  console.log(`Strategy:       ${args.strategy}`);
  console.log(`Timeout:        ${args.timeoutMs / 1000}s`);
  console.log('');

  if (!fs.existsSync(playwrightCli)) {
    console.error('ERROR: playwright-core/cli.js not found. Run `npm install` first.');
    process.exitCode = 1;
    return;
  }

  // ── Step 1: Quick Bun version check ────────────────────────────────────────
  if (fs.existsSync(bunBinary)) {
    console.log('─── Step 1: Bun version ───────────────────────────────');
    const bunResult = await runCommand(bunBinary, ['--version'], { label: 'bun --version', timeoutMs: 10_000 });
    console.log(`exit code: ${bunResult.code}  (${bunResult.elapsedMs}ms)`);
    console.log('');
  }

  // ── Step 2: node.cmd --version (via shell) ──────────────────────────────────
  if (fs.existsSync(nodeShim)) {
    console.log('─── Step 2: node shim --version (shell: true) ─────────');
    const vResult = await runCommand(
      nodeShim, ['--version'],
      { shell: process.platform === 'win32', label: 'node shim --version', timeoutMs: 10_000 }
    );
    console.log(`exit code: ${vResult.code}  (${vResult.elapsedMs}ms)`);
    if (vResult.error) console.error(`error: ${vResult.error}`);
    console.log('');

    // ── Step 3: node.cmd playwright --help ─────────────────────────────────
    console.log('─── Step 3: Playwright CLI --help via Bun shim ─────────');
    const helpResult = await runCommand(
      nodeShim, [playwrightCli, '--help'],
      { shell: process.platform === 'win32', label: 'playwright --help', timeoutMs: 30_000 }
    );
    console.log(`exit code: ${helpResult.code}  (${helpResult.elapsedMs}ms)`);
    if (helpResult.error) console.error(`error: ${helpResult.error}`);
    console.log('');
  }

  // ── Step 4: Run selected install strategies ─────────────────────────────────
  const allStrategies = buildStrategies(nodeShim, playwrightCli, args.realInstall);
  const selectedStrategies = args.strategy === 'all'
    ? allStrategies
    : allStrategies.filter((s) => s.id === args.strategy || s.id === `${args.strategy}-no-shell`);

  if (selectedStrategies.length === 0) {
    console.error(`ERROR: No strategies matched --strategy "${args.strategy}". Valid: all, bun, node, npx`);
    process.exitCode = 1;
    return;
  }

  const results = [];

  for (const strategy of selectedStrategies) {
    console.log(`─── Install: ${strategy.label} ${'─'.repeat(Math.max(0, 45 - strategy.label.length))}`);
    console.log(`CMD: ${[strategy.command, ...strategy.args].join(' ')}`);
    console.log(`shell: ${strategy.shell}`);
    console.log('');

    const result = await runCommand(strategy.command, strategy.args, {
      shell: strategy.shell,
      timeoutMs: args.timeoutMs,
      label: strategy.label,
    });

    const status = result.timedOut ? '⏰ TIMED OUT' : result.code === 0 ? '✅ SUCCESS' : `❌ FAILED (exit ${result.code})`;
    console.log(`\n${status}  elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`);
    if (result.error) console.error(`spawn error: ${result.error}`);
    console.log('');

    results.push({ strategy: strategy.label, ...result, status });

    // Stop testing on first real install success to avoid double-installing
    if (args.realInstall && result.code === 0) {
      console.log('Real install succeeded — skipping remaining strategies.');
      break;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Summary                                         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  for (const r of results) {
    const elapsed = `${(r.elapsedMs / 1000).toFixed(1)}s`.padStart(7);
    console.log(`  ${r.status.padEnd(25)}  ${elapsed}  ${r.strategy}`);
  }

  const anySuccess = results.some((r) => r.code === 0);
  if (!anySuccess) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exitCode = 1;
});
