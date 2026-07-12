/**
 * Installed global MCP server config file store (`mcp.json`).
 *
 * Profile-level installed global MCP server configs used to live inside `profile.json`
 * as the `mcp_servers` field. It is now persisted in a sibling `mcp.json` file so
 * that installed-server writes are decoupled from unrelated profile writes (and vice
 * versa). This module owns the read/serialize/write boundary for that file.
 *
 * `ProfileV2.mcp_servers` is now optional/deprecated and exists only as a
 * transient load/migration/wire-compatibility field. Runtime consumers must read
 * installed global MCP servers from `McpConfigManager`; `ProfileCacheManager` strips the
 * field from its cached profile and only re-injects it into renderer IPC payloads.
 *
 * The on-disk element shape is the existing `McpServerConfig` — no field
 * translation — so `in_use`, `source`, `remoteVersion`, `hidden`, `oauth`,
 * `headers`, `version`, and tool data round-trip losslessly. The file also
 * carries its own `updatedAt` timestamp, independent of `profile.json`'s, that
 * advances only when installed server content actually changes.
 */

import * as fs from 'fs';

import { McpServerConfig } from './types/profile';
import { writeFileAtomicallyWithRetry, AtomicWriteOptions } from './atomicFileWrite';

/**
 * Format version of `mcp.json`. Independent of `profileMigrationVersion`;
 * reserved for future `mcp.json`-only format changes.
 */
export const MCP_FILE_VERSION = '1.0';

/**
 * On-disk shape of `mcp.json`.
 */
export interface McpFile {
  /** File-format version. */
  version: string;
  /**
   * Last time installed global MCP servers changed, in ISO-8601. This is independent
   * of `profile.json`'s `updatedAt`: it only advances when installed server content
   * actually changes, never when an unrelated profile field is saved.
   */
  updatedAt: string;
  /** Installed global MCP server configs. */
  mcp_servers: McpServerConfig[];
}

/**
 * Result of attempting to read `mcp.json`.
 *
 * - `file` is the parsed installed server config file when the file exists and is valid.
 * - `file` is `null` when the file does not exist.
 * - `corrupt` is `true` when the file exists but could not be read, parsed, or
 *   validated; the caller is expected to back it up and treat installed servers as
 *   empty rather than silently dropping data.
 */
export interface ReadMcpFileResult {
  file: McpFile | null;
  corrupt: boolean;
}

/**
 * Serialize installed server configs into the canonical `mcp.json` string. The caller
 * supplies `updatedAt` (so the timestamp is explicit and the function stays
 * deterministic/testable). Kept here, not inlined by callers, so the file the
 * caller writes always matches this exact shape.
 */
export function serializeMcpFile(servers: McpServerConfig[], updatedAt: string): string {
  const payload: McpFile = {
    version: MCP_FILE_VERSION,
    updatedAt,
    mcp_servers: Array.isArray(servers) ? servers : [],
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Content fingerprint of installed server configs for dirty-checking, deliberately
 * EXCLUDING the volatile `updatedAt` timestamp. Two files with identical
 * servers (and format version) hash to the same string regardless of when they
 * were last written, so the caller can tell a real installed-server change apart from an
 * unrelated profile save and avoid both rewriting `mcp.json` and bumping its
 * `updatedAt` for a no-op. Never written to disk — comparison key only.
 */
export function fingerprintMcpServers(servers: McpServerConfig[]): string {
  return JSON.stringify({
    version: MCP_FILE_VERSION,
    mcp_servers: Array.isArray(servers) ? servers : [],
  });
}

/**
 * Read and validate `mcp.json` at `filePath`.
 *
 * Never throws: a missing file returns `{ file: null, corrupt: false }`, and any
 * read/parse/validation failure returns `{ file: null, corrupt: true }` so the
 * caller can preserve the bad file and continue with an empty installed server set. Validation
 * requires `mcp_servers` to be an array of non-null objects; a primitive/null
 * element marks the file corrupt.
 */
export async function readMcpFile(filePath: string): Promise<ReadMcpFileResult> {
  if (!fs.existsSync(filePath)) {
    return { file: null, corrupt: false };
  }

  let content: string;
  try {
    content = await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return { file: null, corrupt: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { file: null, corrupt: true };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { mcp_servers?: unknown }).mcp_servers)
  ) {
    return { file: null, corrupt: true };
  }

  // Every entry must be a non-null object. A primitive/null element means the
  // file is structurally broken (e.g. truncated or hand-edited); treat the whole
  // file as corrupt so the caller backs it up and continues with an empty
  // installed server set, rather than caching junk that later throws in the sanitizer.
  const servers = (parsed as { mcp_servers: unknown[] }).mcp_servers;
  if (servers.some(server => server == null || typeof server !== 'object')) {
    return { file: null, corrupt: true };
  }

  const record = parsed as { version?: unknown; updatedAt?: unknown; mcp_servers: McpServerConfig[] };
  return {
    file: {
      version: typeof record.version === 'string' ? record.version : MCP_FILE_VERSION,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      mcp_servers: record.mcp_servers,
    },
    corrupt: false,
  };
}

/**
 * Atomically write installed server configs to `mcp.json` (temp-file + rename with
 * transient-rename retry, consistent with the rest of this layer). `updatedAt`
 * is embedded as the installed server set's own last-changed timestamp.
 */
export async function writeMcpFile(
  filePath: string,
  servers: McpServerConfig[],
  updatedAt: string,
  options?: AtomicWriteOptions,
): Promise<void> {
  await writeFileAtomicallyWithRetry(filePath, serializeMcpFile(servers, updatedAt), options);
}
