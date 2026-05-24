#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ─── Path Alias Resolution ────────────────────────────────────────────────────

const ALIASES = {
  '@shared/': 'src/shared/',
  '@main/': 'src/main/',
  '@renderer/': 'src/renderer/',
  '@/': 'src/renderer/',
};

function resolveAlias(importPath) {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (importPath.startsWith(alias)) {
      return importPath.replace(alias, target);
    }
  }
  return null;
}

// ─── File Collection ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.webpack', '__tests__', 'dist-vite']);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function collectSourceFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ─── Import Extraction ────────────────────────────────────────────────────────

// Matches: import ... from '...', export ... from '...', require('...')
const IMPORT_RE = /(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    imports.push(match[1] || match[2]);
  }
  return imports;
}

// ─── Import Target Resolution ─────────────────────────────────────────────────

/**
 * Given a raw import string and the file that contains it,
 * return the resolved path relative to ROOT (no extension), or null.
 */
function resolveImportToRelative(importStr, fromFile) {
  // Try alias resolution
  const aliased = resolveAlias(importStr);
  if (aliased) {
    return aliased.replace(/\\/g, '/');
  }

  // Relative import
  if (importStr.startsWith('.')) {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importStr);
    const rel = path.relative(ROOT, resolved).replace(/\\/g, '/');
    return rel;
  }

  // External package — ignore
  return null;
}

/**
 * Check if a resolved import path (without extension) matches a target file.
 * Target is relative to ROOT, e.g. 'src/shared/ipc/base.ts'
 */
function importMatchesTarget(resolvedImport, targetRelative) {
  if (!resolvedImport) return false;

  // Strip extension from target
  const targetNoExt = targetRelative.replace(/\.[^.]+$/, '');

  // Direct match (import resolves to the file without extension)
  if (resolvedImport === targetNoExt) return true;

  // Strip extension from resolved import too (in case it has one)
  const resolvedNoExt = resolvedImport.replace(/\.[^.]+$/, '');
  if (resolvedNoExt === targetNoExt) return true;

  // Index match: import 'foo' matches 'foo/index.ts'
  const targetAsIndex = targetNoExt.replace(/\/index$/, '');
  if (resolvedNoExt === targetAsIndex) return true;
  if (resolvedImport === targetAsIndex) return true;

  return false;
}

// ─── Module Boundary Detection ────────────────────────────────────────────────

const MODULE_PATTERNS = [
  'src/main/lib/',
  'src/renderer/components/',
  'src/renderer/lib/',
  'src/shared/',
];

function detectModule(fileRelative) {
  for (const pattern of MODULE_PATTERNS) {
    if (fileRelative.startsWith(pattern)) {
      const rest = fileRelative.slice(pattern.length);
      const firstDir = rest.split('/')[0];
      if (firstDir && firstDir.includes('.')) {
        // It's a file directly in the pattern dir, module is the pattern dir itself
        return pattern;
      }
      return pattern + firstDir + '/';
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  let changedFiles;

  if (args.includes('--staged')) {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (!output) {
      console.log('No staged files found.');
      process.exit(0);
    }
    changedFiles = output.split('\n').filter(f => f.startsWith('src/'));
    if (changedFiles.length === 0) {
      console.log('No staged source files under src/.');
      process.exit(0);
    }
  } else {
    changedFiles = args.filter(a => !a.startsWith('--'));
    if (changedFiles.length === 0) {
      console.log('Usage: node scripts/check-impact.js <file1> [file2] ...');
      console.log('       node scripts/check-impact.js --staged');
      process.exit(1);
    }
    // Normalize paths to be relative to ROOT
    changedFiles = changedFiles.map(f => {
      const abs = path.isAbsolute(f) ? f : path.resolve(ROOT, f);
      return path.relative(ROOT, abs).replace(/\\/g, '/');
    });
  }

  console.log('\n=== Change Impact Analysis ===\n');
  console.log(`Changed files (${changedFiles.length}):`);
  for (const f of changedFiles) {
    console.log(`  ${f}`);
  }

  // Collect all source files
  const allFiles = collectSourceFiles(SRC);

  // Find direct dependents
  const dependents = new Set();

  for (const sourceFile of allFiles) {
    const sourceRel = path.relative(ROOT, sourceFile).replace(/\\/g, '/');
    // Skip if this file is one of the changed files
    if (changedFiles.includes(sourceRel)) continue;

    const imports = extractImports(sourceFile);
    for (const imp of imports) {
      const resolved = resolveImportToRelative(imp, sourceFile);
      for (const target of changedFiles) {
        if (importMatchesTarget(resolved, target)) {
          dependents.add(sourceRel);
          break;
        }
      }
    }
  }

  const sortedDependents = [...dependents].sort();

  if (sortedDependents.length === 0) {
    console.log('\nNo direct dependents found.\n');
  } else {
    console.log(`\nDirect dependents (${sortedDependents.length}):`);
    for (const d of sortedDependents) {
      console.log(`  ${d}`);
    }
  }

  // Collect affected modules
  const affectedModules = new Set();
  for (const f of [...changedFiles, ...sortedDependents]) {
    const mod = detectModule(f);
    if (mod) affectedModules.add(mod);
  }

  if (affectedModules.size > 0) {
    console.log('\n--- Affected Modules ---\n');
    const sortedModules = [...affectedModules].sort();
    for (const mod of sortedModules) {
      const modAbs = path.join(ROOT, mod);
      const hasPrompt = fs.existsSync(path.join(modAbs, 'ai.prompt.md'));
      const hasTests = fs.existsSync(path.join(modAbs, '__tests__'));

      console.log(`  ${mod}`);
      if (hasPrompt) {
        console.log('    📖 has ai.prompt.md — READ IT');
      } else {
        console.log('    ⚠ no ai.prompt.md');
      }
      if (hasTests) {
        console.log('    🧪 has __tests__/ — RUN THEM');
      } else {
        console.log('    ⚠ no __tests__/');
      }
      console.log('');
    }
  }
}

main();
