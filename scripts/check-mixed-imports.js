#!/usr/bin/env node
'use strict';

/**
 * check-mixed-imports.js — Scan .ts/.tsx files under src and find modules
 * that are referenced by both static imports and dynamic import() calls,
 * including relative file paths and third-party packages.
 *
 * Usage:
 *   node scripts/check-mixed-imports.js          Human-readable report; exits with code 1 if mixed usage is found
 *   node scripts/check-mixed-imports.js --quiet  Silent when clean; prints a brief error and exits with code 1 on failure
 *
 * Type-only rule: purely type-only imports do not count as static runtime
 * references because they are not emitted into runtime code.
 *   - import type X from 'm'                  -> excluded
 *   - import type { A, B } from 'm'           -> excluded
 *   - import { type A, type B } from 'm'      -> excluded (all named imports are type-only)
 *   - import { type A, B } from 'm'           -> counts as static (B is a value import)
 *   - import 'm'                              -> counts as static (side-effect import)
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// -- Collect source files ---------------------------------------------------

function walk(dir, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__mocks__') continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

// -- Shared: normalize specifiers -------------------------------------------

function isRelative(spec) {
  return spec.startsWith('.') || spec.startsWith('/');
}

function normalizeSpecifier(spec, fromFile) {
  if (!isRelative(spec)) return spec;
  const baseDir = path.dirname(fromFile);
  const resolved = path.resolve(baseDir, spec);
  const candidates = [
    resolved, resolved + '.ts', resolved + '.tsx', resolved + '.js', resolved + '.jsx',
    path.join(resolved, 'index.ts'), path.join(resolved, 'index.tsx'), path.join(resolved, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return path.relative(ROOT, c);
    }
  }
  return path.relative(ROOT, resolved);
}

function parseSourceFile(file, text) {
  return ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Returns whether an import declaration contains at least one value binding.
 * Type-only forms are excluded because they are used only for compile-time
 * checking and never appear at runtime.
 */
function importHasValueBinding(node) {
  const clause = node.importClause;
  if (!clause) return true; // Side-effect import: import 'm'
  if (clause.isTypeOnly) return false;
  if (clause.name) return true; // default import
  const nb = clause.namedBindings;
  if (!nb) return false;
  if (ts.isNamespaceImport(nb)) return true;
  return nb.elements.some(el => !el.isTypeOnly);
}

function exportHasValueBinding(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause) return true;            // export * from 'm'
  if (ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some(el => !el.isTypeOnly);
}

// -- Scan -------------------------------------------------------------------

function scanAll(files) {
  const refs = new Map();

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = parseSourceFile(file, text);

    const record = (spec, kind, node) => {
      if (!spec) return;
      const key = normalizeSpecifier(spec, file);
      let entry = refs.get(key);
      if (!entry) { entry = { static: [], dynamic: [] }; refs.set(key, entry); }
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      entry[kind].push({ importer: path.relative(ROOT, file), kind, line: line + 1 });
    };

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (importHasValueBinding(node)) record(node.moduleSpecifier.text, 'static', node);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (exportHasValueBinding(node)) record(node.moduleSpecifier.text, 'static', node);
      } else if (ts.isImportEqualsDeclaration(node) &&
                 ts.isExternalModuleReference(node.moduleReference) &&
                 ts.isStringLiteral(node.moduleReference.expression)) {
        if (!node.isTypeOnly) record(node.moduleReference.expression.text, 'static', node);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) record(arg.text, 'dynamic', node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const mixed = [];
  for (const [mod, r] of refs) {
    if (r.static.length > 0 && r.dynamic.length > 0) {
      mixed.push({ module: mod, static: r.static, dynamic: r.dynamic });
    }
  }
  mixed.sort((a, b) => a.module.localeCompare(b.module));
  return mixed;
}

// -- Output -----------------------------------------------------------------

function printDetailedReport(mixed) {
  console.error(`❌ Found ${mixed.length} module(s) with both static and dynamic references:\n`);
  for (const m of mixed) {
    const isThirdParty = !m.module.includes(path.sep) || m.module.startsWith('@');
    const tag = isThirdParty ? '[pkg]' : '[file]';
    console.error(`${tag} ${m.module}`);
    console.error(`  Static references (${m.static.length}):`);
    for (const r of m.static) console.error(`    - ${r.importer}:${r.line}`);
    console.error(`  Dynamic references (${m.dynamic.length}):`);
    for (const r of m.dynamic) console.error(`    - ${r.importer}:${r.line}`);
    console.error('');
  }
  console.error(`Total: ${mixed.length} module(s) need cleanup.`);
  console.error('Tip: use `import type ...` for type-only references; for runtime dependencies, pick either static import or dynamic import consistently.');
}

function printQuietReport(mixed) {
  console.error(`❌ Found ${mixed.length} module(s) referenced by both static and dynamic imports:`);
  for (const m of mixed) {
    console.error(`  - ${m.module}  (${m.static.length} static, ${m.dynamic.length} dynamic)`);
  }
  console.error('Run `node scripts/check-mixed-imports.js` for the full report.');
}

// -- Entry ------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const quiet = argv.includes('--quiet');

  const files = walk(SRC);
  const mixed = scanAll(files);

  if (mixed.length === 0) {
    if (!quiet) console.log('✅ check passed');
    process.exit(0);
  }

  if (quiet) printQuietReport(mixed);
  else printDetailedReport(mixed);
  process.exit(1);
}

main();
