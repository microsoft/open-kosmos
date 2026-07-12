/**
 * memexHome — resolves and initializes Memex home directories.
 *
 * Each agent (identified by agentId) gets an isolated current-agent memory tree:
 *   <userData>/profiles/<alias>/agents/<agentId>/memory
 *
 * Each profile also gets a shared profile-memory tree:
 *   <userData>/profiles/<alias>/profile-memory
 *     ├── cards/      active cards (<slug>.md)
 *     └── archive/    archived cards
 */

import * as path from 'path';
import { mkdir } from 'node:fs/promises';

export interface MemexHome {
  /** Root home directory for this memory scope. */
  root: string;
  /** Active cards directory (<root>/cards). */
  cardsDir: string;
  /** Archive directory (<root>/archive). */
  archiveDir: string;
}

/**
 * Reject a path component that is not a single, literal directory segment.
 * `alias` and `agentId` are interpolated into the home path; a value containing
 * a separator, a `.`/`..` traversal segment, or an absolute path could escape
 * `profiles/<alias>/agents/<agentId>/memory` and read or write another agent's
 * (or user's) memory. With all of these rejected, the subsequent `path.join`
 * cannot escape the intended root, so no extra resolve-confinement check is needed.
 * Rejects absolute paths and parent-directory traversal.
 */
function assertSafeSegment(value: string, label: string): void {
  // isAbsolute first so each OR arm is independently reachable: on POSIX an
  // absolute path also contains '/', which would otherwise mask this arm.
  if (
    path.isAbsolute(value) ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(
      `buildMemexHome: ${label} must be a single path segment (no separators or traversal): ${value}`,
    );
  }
}

/**
 * Build the home paths for an agent. Pure — does not touch the filesystem.
 * Throws if alias or agentId is empty (both are required to isolate memory) or if
 * either is not a single, safe path segment (path-traversal guard).
 */
export function buildAgentMemexHome(userDataDir: string, alias: string, agentId: string): MemexHome {
  if (!userDataDir) throw new Error('buildMemexHome: userDataDir is required');
  if (!alias) throw new Error('buildMemexHome: alias is required');
  if (!agentId) throw new Error('buildMemexHome: agentId is required');

  assertSafeSegment(alias, 'alias');
  assertSafeSegment(agentId, 'agentId');

  const root = path.join(userDataDir, 'profiles', alias, 'agents', agentId, 'memory');
  return {
    root,
    cardsDir: path.join(root, 'cards'),
    archiveDir: path.join(root, 'archive'),
  };
}

/**
 * Build the shared profile-memory home paths. Pure — does not touch the filesystem.
 * This scope is shared by every agent in the profile but remains isolated from
 * other profiles by alias.
 */
export function buildProfileMemexHome(userDataDir: string, alias: string): MemexHome {
  if (!userDataDir) throw new Error('buildProfileMemexHome: userDataDir is required');
  if (!alias) throw new Error('buildProfileMemexHome: alias is required');

  assertSafeSegment(alias, 'alias');

  const root = path.join(userDataDir, 'profiles', alias, 'profile-memory');
  return {
    root,
    cardsDir: path.join(root, 'cards'),
    archiveDir: path.join(root, 'archive'),
  };
}

/** Backwards-compatible alias for the current-agent scope. */
export function buildMemexHome(userDataDir: string, alias: string, agentId: string): MemexHome {
  return buildAgentMemexHome(userDataDir, alias, agentId);
}

/**
 * Ensure the cards directory exists (creates the full tree if missing).
 * The archive directory is created lazily by CardStore.archiveCard when needed.
 * Idempotent.
 */
export async function ensureHome(home: MemexHome): Promise<void> {
  await mkdir(home.cardsDir, { recursive: true });
}
