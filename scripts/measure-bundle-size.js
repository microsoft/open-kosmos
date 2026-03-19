#!/usr/bin/env node
/**
 * measure-bundle-size.js
 *
 * Recursively calculates the total byte size of all files under a directory and outputs a JSON report.
 * Usage:
 *   node scripts/measure-bundle-size.js [--dist-dir ./dist] [--output sizes.json]
 *
 * Output format:
 *   { "main": 14000000, "renderer": 31000000, "total": 45000000 }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CLI argument parsing ───────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}

const distDir  = path.resolve(getArg('--dist-dir', './dist'));
const outputFile = getArg('--output', null);

// ─── Recursive size calculation ─────────────────────────────────────────────
function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

// ─── Measure each subdirectory ──────────────────────────────────────────────
const result = {};
if (!fs.existsSync(distDir)) {
  console.error(`[ERROR] dist directory not found: ${distDir}`);
  process.exit(1);
}

let total = 0;
for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const size = dirSize(path.join(distDir, entry.name));
    result[entry.name] = size;
    total += size;
  }
}
result.total = total;

// ─── Output ─────────────────────────────────────────────────────────────────
const json = JSON.stringify(result, null, 2);
console.log(json);

if (outputFile) {
  fs.writeFileSync(outputFile, json, 'utf8');
  console.error(`Sizes written to: ${outputFile}`);
}
