/**
 * Dependency analysis script for main process.
 * Scans src/main/ and src/shared/ for third-party import references.
 *
 * Usage:
 *   bun scripts/vite/analyze-deps.ts          # list mode: print all deps
 *   bun scripts/vite/analyze-deps.ts --check  # check mode: compare against package.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');
const SCAN_DIRS = ['src/main', 'src/shared'];

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'stream/promises',
  'string_decoder', 'sys', 'timers', 'timers/promises', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const EXCLUDED_PACKAGES = new Set(['electron']);

// Webpack/Vite path aliases used in the project (not real npm packages)
const PATH_ALIAS_PREFIXES = ['@shared/', '@renderer/', '@/'];

const TEST_PATTERNS = [
  /\.(test|spec)\.tsx?$/,
  /__tests__[/\\]/,
  /__mocks__[/\\]/,
];

// ─── File Discovery ──────────────────────────────────────────────

function findSourceFiles(baseDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        if (TEST_PATTERNS.some(p => p.test(full))) continue;
        results.push(full);
      }
    }
  }

  walk(baseDir);
  return results;
}

// ─── Import Extraction ───────────────────────────────────────────

export function extractImports(content: string): Set<string> {
  const deps = new Set<string>();

  const patterns = [
    // import ... from 'pkg'  /  export ... from 'pkg' (single-line to avoid cross-line false positives)
    /(?:import|export)\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/g,
    // import 'pkg' (side-effect import)
    /(?:^|\s)import\s+['"]([^'"]+)['"]/gm,
    // import('pkg')
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require('pkg')
    /(?<!\.)require\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require.resolve('pkg')
    /require\.resolve\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      const pkgName = extractPackageName(specifier);
      if (pkgName) deps.add(pkgName);
    }
  }

  return deps;
}

function extractPackageName(specifier: string): string | null {
  // Skip relative imports
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;

  // Skip webpack/vite path aliases
  if (PATH_ALIAS_PREFIXES.some(prefix => specifier.startsWith(prefix))) return null;

  // Strip node: prefix for builtin check
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;

  // Check builtins (also check base module for paths like 'fs/promises')
  if (NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0])) return null;
  // Also check original specifier with node: prefix
  if (specifier.startsWith('node:')) return null;

  // Extract top-level package name
  let pkgName: string;
  if (specifier.startsWith('@')) {
    // @scope/pkg/sub/path → @scope/pkg
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    pkgName = `${parts[0]}/${parts[1]}`;
  } else {
    // pkg/sub/path → pkg
    pkgName = specifier.split('/')[0];
  }

  if (EXCLUDED_PACKAGES.has(pkgName)) return null;

  return pkgName;
}

// ─── Main Scan ───────────────────────────────────────────────────

export async function scanDependencies(rootDir: string): Promise<Set<string>> {
  const allDeps = new Set<string>();

  for (const scanDir of SCAN_DIRS) {
    const absDir = path.join(rootDir, scanDir);
    if (!fs.existsSync(absDir)) continue;

    const files = findSourceFiles(absDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const deps = extractImports(content);
      for (const dep of deps) allDeps.add(dep);
    }
  }

  return allDeps;
}

// ─── CLI Entry Point ─────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');

  const deps = await scanDependencies(ROOT);
  const sorted = [...deps].sort();

  if (!checkMode) {
    // List mode: print all deps
    console.log(`Found ${sorted.length} third-party dependencies in main process:\n`);
    for (const dep of sorted) {
      console.log(`  ${dep}`);
    }
    return;
  }

  // Check mode: compare against package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const declared = new Set(Object.keys(pkg.dependencies || {}));
  const declaredDev = new Set(Object.keys(pkg.devDependencies || {}));
  const declaredOptional = new Set(Object.keys(pkg.optionalDependencies || {}));

  const missing: string[] = [];
  const inDevOnly: string[] = [];
  const inOptionalOnly: string[] = [];
  const extra: string[] = [];

  for (const dep of sorted) {
    if (declared.has(dep)) continue;
    if (declaredOptional.has(dep)) {
      inOptionalOnly.push(dep);
    } else if (declaredDev.has(dep)) {
      inDevOnly.push(dep);
    } else {
      missing.push(dep);
    }
  }

  for (const dep of [...declared].sort()) {
    if (!deps.has(dep)) {
      extra.push(dep);
    }
  }

  if (missing.length > 0) {
    console.log(`\n❌ Missing from dependencies (used in main process but not declared anywhere):\n`);
    for (const dep of missing) {
      console.log(`  ${dep}`);
    }
  }

  if (inDevOnly.length > 0) {
    console.log(`\nℹ️  In devDependencies only (used in main process, verify if needed at runtime):\n`);
    for (const dep of inDevOnly) {
      console.log(`  ${dep}`);
    }
  }

  if (inOptionalOnly.length > 0) {
    console.log(`\nℹ️  In optionalDependencies (used in main process, already handled):\n`);
    for (const dep of inOptionalOnly) {
      console.log(`  ${dep}`);
    }
  }

  if (extra.length > 0) {
    console.log(`\n⚠️  Extra in dependencies (declared but not used in main process, consider moving to devDependencies):\n`);
    for (const dep of extra) {
      console.log(`  ${dep}`);
    }
  }

  if (missing.length === 0 && extra.length === 0 && inDevOnly.length === 0) {
    console.log('\n✅ All dependencies are correctly declared.');
  }

  if (missing.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
