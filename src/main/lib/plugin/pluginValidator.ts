/**
 * Plugin manifest validation and discovery.
 *
 * Supports the Claude Code plugin format:
 *   1. `.claude-plugin/plugin.json`  (primary)
 *   2. Root `plugin.json`            (fallback)
 *
 * Only `name` is required.  Missing `version`, `description`, and
 * `author` are filled with sensible defaults.
 *
 * After loading the manifest, the loader layer auto-discovers:
 *   - skills  → `skills/<name>/SKILL.md`
 *   - hooks   → `hooks/hooks.json`
 *   - MCP     → `.mcp.json`
 */

import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import type { OpenKosmosPluginManifest, PluginError } from './types';

// ---------------------------------------------------------------------------
// Zod schemas — intentionally lenient to match Claude Code
// ---------------------------------------------------------------------------

const PluginAuthorSchema = z.union([
  z.object({
    name: z.string().min(1),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
  z.string().transform(name => ({ name })),
]).optional();

const PluginMcpServerConfigSchema = z.object({
  transport: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
}).passthrough();

const CommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  async: z.boolean().optional(),
}).passthrough();

/**
 * Manifest schema — only `name` is required.
 * Uses `.passthrough()` to not strip unknown keys that Claude Code may emit.
 */
const OpenKosmosPluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  author: PluginAuthorSchema,
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  mcpServers: z.union([
    z.record(z.string(), PluginMcpServerConfigSchema),
    z.string(), // path to .mcp.json
  ]).optional(),
  hooks: z.any().optional(), // validated separately after merging with hooks.json
  homepage: z.string().optional(),
  repository: z.union([z.string(), z.object({ url: z.string() }).passthrough()]).optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Manifest discovery
// ---------------------------------------------------------------------------

/**
 * Find the manifest file following Claude Code conventions:
 *   1. `.claude-plugin/plugin.json`
 *   2. `plugin.json` (root)
 *
 * @returns Absolute path to the manifest, or null.
 */
export function findManifestPath(pluginDir: string): string | null {
  const primary = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(primary)) return primary;

  const fallback = path.join(pluginDir, 'plugin.json');
  if (fs.existsSync(fallback)) return fallback;

  return null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateRelativePath(pluginDir: string, relativePath: string): string | null {
  const resolved = path.resolve(pluginDir, relativePath);
  const rel = path.relative(pluginDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate and parse a plugin manifest.
 *
 * @param pluginDir  Absolute path to the plugin root directory
 */
export function validatePluginManifest(
  pluginDir: string,
): { manifest: OpenKosmosPluginManifest; errors: PluginError[] } | { manifest: null; errors: PluginError[] } {
  const errors: PluginError[] = [];

  // 1. Find manifest
  const manifestPath = findManifestPath(pluginDir);
  if (!manifestPath) {
    errors.push({ message: `No plugin.json found in ${pluginDir} (checked .claude-plugin/ and root)` });
    return { manifest: null, errors };
  }

  // 2. Parse JSON
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    errors.push({ message: `Failed to parse ${manifestPath}: ${e instanceof Error ? e.message : String(e)}` });
    return { manifest: null, errors };
  }

  // 3. Schema validation
  const result = OpenKosmosPluginManifestSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    errors.push({ message: `Manifest validation failed: ${formatted}` });
    return { manifest: null, errors };
  }

  // 4. Normalize to OpenKosmosPluginManifest with defaults
  const data = result.data;
  const manifest: OpenKosmosPluginManifest = {
    name: data.name,
    version: data.version || '0.0.0',
    description: data.description || '',
    author: (typeof data.author === 'object' && data.author !== null)
      ? data.author as { name: string; email?: string; url?: string }
      : { name: typeof data.author === 'string' ? data.author : 'Unknown' },
    skills: data.skills,
    mcpServers: typeof data.mcpServers === 'object' && data.mcpServers !== null && !Array.isArray(data.mcpServers)
      ? data.mcpServers as Record<string, any>
      : undefined,
    hooks: undefined, // will be resolved in the loader
    homepage: data.homepage,
    repository: typeof data.repository === 'string' ? data.repository : (data.repository as any)?.url,
    license: data.license,
    keywords: data.keywords,
  };

  // 5. Validate explicitly listed skill paths
  const skillPaths = typeof manifest.skills === 'string'
    ? [manifest.skills]
    : manifest.skills ?? [];

  for (const sp of skillPaths) {
    const resolved = validateRelativePath(pluginDir, sp);
    if (!resolved) {
      errors.push({ pluginId: manifest.name, message: `Path traversal blocked in skills: "${sp}"` });
    }
    // Note: we don't error on missing paths here — the loader will handle auto-discovery
  }

  if (errors.some(e => e.message.includes('Path traversal'))) {
    return { manifest: null, errors };
  }

  return { manifest, errors };
}
