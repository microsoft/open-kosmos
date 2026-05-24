#!/usr/bin/env bun
/**
 * trim-trailing-spaces.ts — Remove trailing whitespace from all source files under src/.
 * Run with: bun scripts/trim-trailing-spaces.ts
 * Zero external dependencies — uses only bun/node built-ins.
 */

import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(import.meta.dir, "../src");
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".scss",
  ".html",
  ".md",
]);

let filesChanged = 0;
let totalLinesFixed = 0;

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(SRC_DIR);

for (const file of files) {
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");
  let changed = false;
  let linesFixed = 0;

  const trimmed = lines.map((line) => {
    const t = line.replace(/[ \t]+$/, "");
    if (t !== line) {
      changed = true;
      linesFixed++;
    }
    return t;
  });

  if (changed) {
    fs.writeFileSync(file, trimmed.join("\n"), "utf-8");
    const rel = path.relative(path.resolve(import.meta.dir, ".."), file);
    console.log(`  ${rel} (${linesFixed} lines)`);
    filesChanged++;
    totalLinesFixed += linesFixed;
  }
}

if (filesChanged === 0) {
  console.log("No trailing whitespace found.");
} else {
  console.log(
    `\nDone: ${filesChanged} files changed, ${totalLinesFixed} lines trimmed.`
  );
}
