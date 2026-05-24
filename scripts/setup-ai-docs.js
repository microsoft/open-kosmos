/**
 * Creates AI documentation symlinks for multi-agent compatibility.
 *
 * CLAUDE.md is the single source of truth. This script creates symlinks
 * (or copies on Windows without symlink support) so that other AI agents
 * (Codex, Gemini CLI, Cursor, GitHub Copilot) find their expected config files.
 *
 * Runs automatically via `npm install` postinstall hook.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const LINKS = [
  { link: 'AGENTS.md', target: 'CLAUDE.md' },
  { link: 'GEMINI.md', target: 'CLAUDE.md' },
  { link: '.cursorrules', target: 'CLAUDE.md' },
  { link: path.join('.github', 'copilot-instructions.md'), target: path.join('..', 'CLAUDE.md') },
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

for (const { link, target } of LINKS) {
  const linkPath = path.join(ROOT, link);
  const targetResolved = path.join(path.dirname(linkPath), target);

  // Skip if target doesn't exist (e.g. fresh clone before CLAUDE.md is created)
  if (!fs.existsSync(targetResolved)) {
    console.log(`[setup-ai-docs] skip ${link} — target ${target} not found`);
    continue;
  }

  // Remove existing file/symlink at the link path
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(linkPath);
    }
  } catch {
    // doesn't exist yet — fine
  }

  ensureDir(linkPath);

  try {
    fs.symlinkSync(target, linkPath);
    console.log(`[setup-ai-docs] symlink ${link} -> ${target}`);
  } catch {
    // Windows without Developer Mode: fall back to file copy
    fs.copyFileSync(targetResolved, linkPath);
    console.log(`[setup-ai-docs] copy ${link} <- ${target} (symlink not supported)`);
  }
}
