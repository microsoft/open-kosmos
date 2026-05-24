/**
 * Vite pack orchestration script.
 * Builds Vite output, creates a staging directory (vite-pack/), installs
 * production dependencies, and runs electron-builder for current platform.
 *
 * Usage:
 *   bun scripts/vite/pack.ts                     # full build + package for current platform
 *   bun scripts/vite/pack.ts --dir               # unpacked output (for testing)
 *   bun scripts/vite/pack.ts --skip-build        # skip vite build step
 *   bun scripts/vite/pack.ts --skip-clean        # keep vite-pack/ for inspection
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');
const VITE_PACK = path.join(ROOT, 'vite-pack');
const DIST_VITE = path.join(ROOT, 'dist-vite');

// ─── CLI Argument Parsing ────────────────────────────────────────

export function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const skipBuild = args.includes('--skip-build');
  const skipClean = args.includes('--skip-clean');
  const dirOnly = args.includes('--dir');

  return { skipBuild, skipClean, dirOnly };
}

// ─── Shell Command Runner ────────────────────────────────────────

function run(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): void {
  console.log(`\n> ${cmd}`);
  const result = Bun.spawnSync(['sh', '-c', cmd], {
    cwd: opts?.cwd ?? ROOT,
    env: { ...process.env, ...opts?.env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${cmd}`);
  }
}

// ─── Package.json Generator ─────────────────────────────────────

export function buildVitePackPackageJson(
  rootPkg: {
    name: string;
    version: string;
    description?: string;
    author?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
): Record<string, unknown> {
  return {
    name: rootPkg.name,
    version: rootPkg.version,
    description: rootPkg.description,
    author: rootPkg.author,
    main: 'dist/main/main.js',
    dependencies: rootPkg.dependencies ?? {},
    ...(rootPkg.optionalDependencies && Object.keys(rootPkg.optionalDependencies).length > 0
      ? { optionalDependencies: rootPkg.optionalDependencies }
      : {}),
  };
}

// ─── Main Flow ───────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  console.log(`\n=== Vite Pack ===\n`);

  // Step 1: Build Vite
  if (!opts.skipBuild) {
    console.log('Step 1/5: Building Vite output...');
    run('npm run build:vite');
  } else {
    console.log('Step 1/5: Skipped (--skip-build)');
  }

  // Verify dist-vite exists
  if (!fs.existsSync(path.join(DIST_VITE, 'main', 'main.js'))) {
    throw new Error('dist-vite/main/main.js not found. Run build:vite first or remove --skip-build.');
  }

  // Step 2: Create staging directory
  console.log('\nStep 2/5: Creating vite-pack/ staging directory...');
  fs.rmSync(VITE_PACK, { recursive: true, force: true });
  fs.mkdirSync(VITE_PACK, { recursive: true });

  // Copy dist-vite/ → vite-pack/dist/ (remap to match electron-builder's files pattern)
  console.log('  Copying dist-vite/ → vite-pack/dist/');
  fs.cpSync(DIST_VITE, path.join(VITE_PACK, 'dist'), { recursive: true });

  // Copy resources/ → vite-pack/resources/
  const resourcesSrc = path.join(ROOT, 'resources');
  if (fs.existsSync(resourcesSrc)) {
    console.log('  Copying resources/ → vite-pack/resources/');
    fs.cpSync(resourcesSrc, path.join(VITE_PACK, 'resources'), { recursive: true });
  }

  // Generate vite-pack/package.json
  console.log('  Generating vite-pack/package.json');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const packPkg = buildVitePackPackageJson(rootPkg);

  fs.writeFileSync(
    path.join(VITE_PACK, 'package.json'),
    JSON.stringify(packPkg, null, 2) + '\n',
  );

  console.log(`  Dependencies: ${Object.keys(packPkg.dependencies as Record<string, string>).length} packages`);

  // Step 3: Install production dependencies
  console.log('\nStep 3/5: Installing production dependencies...');
  run('npm install --omit=dev', { cwd: VITE_PACK });

  // Step 4: Run electron-builder
  console.log('\nStep 4/5: Running electron-builder...');
  const builderArgs = [
    'npx', 'electron-builder',
    '--config', 'electron-builder.vite.config.js',
  ];
  if (opts.dirOnly) builderArgs.push('--dir');

  run(builderArgs.join(' '));

  // Step 5: Clean up
  if (!opts.skipClean) {
    console.log('\nStep 5/5: Cleaning up vite-pack/...');
    fs.rmSync(VITE_PACK, { recursive: true, force: true });
  } else {
    console.log('\nStep 5/5: Skipped cleanup (--skip-clean). Inspect vite-pack/ manually.');
  }

  console.log('\n=== Done ===\n');
}

main().catch(err => {
  console.error('\n❌ Pack failed:', err.message);
  process.exit(1);
});
