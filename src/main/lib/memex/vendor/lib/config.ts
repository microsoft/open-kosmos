import { readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// VENDOR PATCH: embedding and semantic-search provider config removed.
// OpenKosmos does not use semantic search. See vendor/PATCHES.md.
export interface MemexConfig {
  nestedSlugs: boolean;
  searchDirs?: string[];
  /** Extra directories whose Markdown files count as valid link-health targets. */
  extraLinkDirs?: string[];
  /** Experimental feature flags. */
  experimental?: {
    /** Enable A-MEM-inspired agentic memory skill workflow. Default: false. */
    agenticMemory?: boolean;
  };
}

/**
 * Read config from $MEMEX_HOME/.memexrc
 * Returns default config if file doesn't exist or is invalid.
 */
export async function readConfig(memexHome: string): Promise<MemexConfig> {
  const configPath = join(memexHome, ".memexrc");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    return {
      nestedSlugs: parsed.nestedSlugs === true,
      searchDirs: Array.isArray(parsed.searchDirs) ? parsed.searchDirs : undefined,
      extraLinkDirs: Array.isArray(parsed.extraLinkDirs) ? parsed.extraLinkDirs : undefined,
      experimental: parseExperimental(parsed.experimental),
    };
  } catch {
    // File doesn't exist or invalid JSON - return defaults
    return {
      nestedSlugs: false,
    };
  }
}

function parseExperimental(value: unknown): MemexConfig["experimental"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const agenticMemory = obj.agenticMemory === true ? true : undefined;
  if (agenticMemory === undefined) {
    return undefined;
  }
  return { agenticMemory };
}

/**
 * Walk up from `startDir` looking for a `.memexrc` file.
 * Returns the directory containing the file, or undefined if not found.
 * Stops at the filesystem root.
 */
export async function findMemexrcUp(startDir: string): Promise<string | undefined> {
  let dir = startDir;
  for (;;) {
    try {
      await access(join(dir, ".memexrc"));
      return dir;
    } catch {
      // not found, keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve the memex home directory.
 * Precedence: MEMEX_HOME env var > walk-up .memexrc discovery > ~/.memex fallback.
 */
export async function resolveMemexHome(): Promise<string> {
  if (process.env.MEMEX_HOME) {
    return process.env.MEMEX_HOME;
  }
  const found = await findMemexrcUp(process.cwd());
  if (found) {
    return found;
  }
  return join(homedir(), ".memex");
}

/**
 * Warn to stderr if the cards directory doesn't exist or is empty.
 */
export async function warnIfEmptyCards(home: string): Promise<void> {
  const cardsDir = join(home, "cards");
  try {
    const entries = await readdir(cardsDir);
    if (entries.length === 0) {
      process.stderr.write(`Warning: cards directory is empty (${cardsDir})\n`);
    }
  } catch {
    process.stderr.write(`Warning: cards directory not found (${cardsDir})\n`);
  }
}
