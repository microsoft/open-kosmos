#!/usr/bin/env node
/**
 * gen-runtime-versions-ts.js
 * Generates src/renderer/lib/runtime/runtimeVersions.ts from runtime-versions.json
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'runtime-versions.json');
const outPath = path.join(__dirname, '../src/renderer/lib/runtime/runtimeVersions.ts');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const bunVersions = data.bun.versions.map((v) => v.version);
const uvVersions = data.uv.versions.map((v) => v.version);
const pythonVersions = data.python.versions.map((v) => v.version);

const out = `// src/renderer/lib/runtime/runtimeVersions.ts
// Auto-generated — do not edit manually.
// Re-generate: node scripts/gen-runtime-versions-ts.js
// Source:      scripts/runtime-versions.json  (updated via: node scripts/fetch-runtime-versions.js --json > scripts/runtime-versions.json)
// Last updated: ${data.fetchedAt}

export interface RuntimeVersionEntry {
  version: string;
  label: string;
}

function toEntries(versions: string[]): RuntimeVersionEntry[] {
  return versions.map((v) => ({ version: v, label: v }));
}

// ─── Default versions bundled with the app ───────────────────────────────────
export const DEFAULT_BUN_VERSION = '1.3.6';
export const DEFAULT_UV_VERSION = '0.6.17';
export const DEFAULT_PYTHON_VERSION = '3.10.12';

// ─── Available versions (newest first) ───────────────────────────────────────
export const BUN_VERSIONS: RuntimeVersionEntry[] = toEntries(${JSON.stringify(bunVersions, null, 2)});

export const UV_VERSIONS: RuntimeVersionEntry[] = toEntries(${JSON.stringify(uvVersions, null, 2)});

export const PYTHON_VERSIONS: RuntimeVersionEntry[] = toEntries(${JSON.stringify(pythonVersions, null, 2)});
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
console.log('Generated:', outPath);
