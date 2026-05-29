/**
 * GitHub Skill Searcher
 *
 * Searches curated GitHub repositories for skills by name.
 *
 * Strategy:
 * - Downloads the ZIP archive of each repo's default branch via the GitHub
 *   archive URL (e.g. https://github.com/<owner>/<repo>/archive/refs/heads/main.zip).
 * - Extracts to a persistent local directory using JSZip (pure JS, no native deps).
 * - If the local directory already exists AND was downloaded recently (within TTL),
 *   skips the download and uses the existing files.
 * - Skill folders are identified by the presence of a SKILL.md file.
 * - Results point directly to the skill folder on disk.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import { app } from 'electron';
import JSZip from 'jszip';
import { createLogger } from '../unifiedLogger';
import { skillManager } from './skillManager';

const logger = createLogger();

/** Configured GitHub repositories containing curated skill collections */
export const GITHUB_SKILL_REPOS: readonly RepoConfig[] = [
  { owner: 'anthropics', repo: 'skills', branch: 'main', label: 'Anthropic Official' },
  { owner: 'sickn33', repo: 'antigravity-awesome-skills', branch: 'main', label: 'Antigravity Collection' },
];

interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  label: string;
}

interface LocalSkillEntry {
  /** Skill folder name (e.g. "pptx") */
  name: string;
  /** Absolute path to the skill folder on disk */
  localPath: string;
  /** Relative path within the repo (e.g. "skills/pptx") */
  repoRelPath: string;
}

export interface GitHubSkillResult {
  name: string;
  description: string;
  url: string;
  repo: string;
  local_folder: string;
}

// ---------------------------------------------------------------------------
// Persistent download directory
// ---------------------------------------------------------------------------

/**
 * Returns the persistent directory for downloaded GitHub skill repos.
 * Located at: <userData>/github-skill-repos/
 */
function getReposRoot(): string {
  const reposRoot = path.join(app.getPath('userData'), 'github-skill-repos');
  if (!fs.existsSync(reposRoot)) {
    fs.mkdirSync(reposRoot, { recursive: true });
  }
  return reposRoot;
}

/**
 * Returns the local directory for a specific repo's extracted contents.
 * e.g. <userData>/github-skill-repos/anthropics__skills/
 */
function repoLocalDir(owner: string, repo: string): string {
  return path.join(getReposRoot(), `${owner}__${repo}`);
}

// ---------------------------------------------------------------------------
// ZIP download + extraction
// ---------------------------------------------------------------------------

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const DOWNLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour — re-download after this

/** Marker file inside the extracted directory to record download timestamp */
const TIMESTAMP_FILE = '.download-timestamp';

/**
 * Download a URL and return the response body as a Buffer.
 * Follows up to 5 redirects (GitHub archive URLs redirect to a CDN).
 */
function downloadBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`)),
      DOWNLOAD_TIMEOUT_MS,
    );

    const doRequest = (reqUrl: string, remaining: number): void => {
      https
        .get(reqUrl, (res) => {
          // Follow redirects
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (remaining <= 0) {
              clearTimeout(timer);
              reject(new Error(`Too many redirects for ${url}`));
              return;
            }
            doRequest(res.headers.location, remaining - 1);
            return;
          }

          if (!res.statusCode || res.statusCode >= 400) {
            clearTimeout(timer);
            reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timer);
            resolve(Buffer.concat(chunks));
          });
          res.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        })
        .on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
    };

    doRequest(url, maxRedirects);
  });
}

/**
 * Extract a ZIP buffer into `destDir`.
 * GitHub archive ZIPs contain a single top-level folder like `skills-main/`.
 * We strip that prefix so files end up directly under `destDir`.
 */
async function extractZip(zipBuffer: Buffer, destDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.keys(zip.files);

  // Detect the common top-level prefix (e.g. "skills-main/")
  const topPrefix = detectTopLevelPrefix(entries);

  // Ensure clean destination
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    // Strip the top-level prefix
    const stripped = topPrefix ? relativePath.slice(topPrefix.length) : relativePath;
    if (!stripped) continue; // the prefix directory itself

    const fullPath = path.join(destDir, stripped);

    if (zipEntry.dir) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const content = await zipEntry.async('nodebuffer');
      fs.writeFileSync(fullPath, content);
    }
  }
}

/**
 * Detect the single top-level directory that GitHub wraps everything in.
 * Returns the prefix string including trailing '/', or '' if none.
 */
function detectTopLevelPrefix(entries: string[]): string {
  if (entries.length === 0) return '';
  const first = entries[0];
  const slashIdx = first.indexOf('/');
  if (slashIdx < 0) return '';
  const candidate = first.slice(0, slashIdx + 1); // e.g. "skills-main/"
  if (entries.every((e) => e.startsWith(candidate))) return candidate;
  return '';
}

/**
 * Ensure a repo is downloaded and extracted locally. If the local directory
 * already exists and was downloaded within the TTL, reuse it. Otherwise
 * re-download the ZIP archive.
 */
async function ensureRepoLocal(owner: string, repo: string, branch: string): Promise<string> {
  const localDir = repoLocalDir(owner, repo);
  const tsFile = path.join(localDir, TIMESTAMP_FILE);

  // Check if a recent download exists
  if (fs.existsSync(tsFile)) {
    try {
      const ts = parseInt(fs.readFileSync(tsFile, 'utf-8').trim(), 10);
      if (Date.now() - ts < DOWNLOAD_TTL_MS) {
        logger.info(
          `[GitHubSkillSearcher] Using cached download for ${owner}/${repo}`,
          'GitHubSkillSearcher',
        );
        return localDir;
      }
    } catch {
      // Corrupted timestamp — re-download
    }
  }

  const archiveUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  logger.info(
    `[GitHubSkillSearcher] Downloading ZIP for ${owner}/${repo} from ${archiveUrl}`,
    'GitHubSkillSearcher',
  );

  const zipBuffer = await downloadBuffer(archiveUrl);
  await extractZip(zipBuffer, localDir);

  // Write download timestamp
  fs.writeFileSync(tsFile, String(Date.now()), 'utf-8');

  logger.info(
    `[GitHubSkillSearcher] Extracted ${owner}/${repo} to ${localDir}`,
    'GitHubSkillSearcher',
  );
  return localDir;
}

// ---------------------------------------------------------------------------
// Local filesystem indexing
// ---------------------------------------------------------------------------

/**
 * Walk the local clone to find all skill folders (directories containing SKILL.md).
 * Uses an in-memory cache with TTL to avoid repeated filesystem scans.
 */
const localIndexCache = new Map<string, { skills: LocalSkillEntry[]; timestamp: number }>();
const LOCAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (local FS is fast)
const WALK_CONCURRENCY = 16;

async function indexLocalRepo(localDir: string, owner: string, repo: string): Promise<LocalSkillEntry[]> {
  const cacheKey = `${owner}/${repo}`;
  const cached = localIndexCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LOCAL_CACHE_TTL_MS) {
    return cached.skills;
  }

  const skills: LocalSkillEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const baseName = path.basename(dir);
    if (baseName.startsWith('.') && dir !== localDir) return;
    if (baseName === 'node_modules') return;

    const hasSkillMd = entries.some(
      (e) => e.isFile() && e.name.toLowerCase() === 'skill.md',
    );

    if (hasSkillMd) {
      const repoRelPath = path.relative(localDir, dir);
      skills.push({
        name: path.basename(dir),
        localPath: dir,
        repoRelPath,
      });
      return;
    }

    // Walk subdirectories with bounded concurrency to avoid EMFILE
    const subdirs = entries.filter((e) => e.isDirectory());
    for (let i = 0; i < subdirs.length; i += WALK_CONCURRENCY) {
      const batch = subdirs.slice(i, i + WALK_CONCURRENCY);
      await Promise.all(batch.map((e) => walk(path.join(dir, e.name))));
    }
  }

  await walk(localDir);

  localIndexCache.set(cacheKey, { skills, timestamp: Date.now() });
  logger.info(
    `[GitHubSkillSearcher] Indexed ${skills.length} skills from local clone of ${cacheKey}`,
    'GitHubSkillSearcher',
  );
  return skills;
}

// ---------------------------------------------------------------------------
// Metadata helper
// ---------------------------------------------------------------------------

async function readLocalSkillDescription(skillDir: string): Promise<string> {
  const candidates = [path.join(skillDir, 'SKILL.md'), path.join(skillDir, 'skill.md')];
  for (const mdPath of candidates) {
    try {
      const content = await fsp.readFile(mdPath, 'utf-8');
      const { metadata } = skillManager.parseSkillMarkdown(content);
      return metadata?.description || '';
    } catch {
      // File doesn't exist or can't be read — try next candidate
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search configured GitHub repos for skills whose folder name or description
 * matches `query`. Repos are downloaded as ZIP archives and extracted locally
 * so results point directly to the skill folder on disk.
 *
 * @param query       case-insensitive substring to match against skill names/descriptions
 * @param maxResults  maximum number of GitHub results to return (default 5)
 * @returns           matching skills with local_folder paths
 * @throws            aggregated error if all repos fail to download/index
 */
export async function searchGitHubSkills(
  query: string,
  maxResults = 5,
): Promise<GitHubSkillResult[]> {
  const queryLower = query.toLowerCase();
  const results: GitHubSkillResult[] = [];
  const errors: string[] = [];

  for (const { owner, repo, branch } of GITHUB_SKILL_REPOS) {
    try {
      // Download / reuse the repo
      const localDir = await ensureRepoLocal(owner, repo, branch);

      // Index skill folders from local filesystem
      const skills = await indexLocalRepo(localDir, owner, repo);

      // Match by folder name or description
      const matches: LocalSkillEntry[] = [];
      const matchDescriptions = new Map<string, string>();
      const maxMatches = maxResults - results.length;
      for (const s of skills) {
        if (s.name.toLowerCase().includes(queryLower)) {
          matches.push(s);
        } else {
          const desc = await readLocalSkillDescription(s.localPath);
          matchDescriptions.set(s.localPath, desc);
          if (desc.toLowerCase().includes(queryLower)) {
            matches.push(s);
          }
        }
        if (matches.length >= maxMatches) break;
      }

      if (matches.length === 0) continue;

      const toReturn = matches.slice(0, maxResults - results.length);

      for (const skill of toReturn) {
        const description = matchDescriptions.get(skill.localPath)
          ?? await readLocalSkillDescription(skill.localPath);

        results.push({
          name: skill.name,
          description,
          url: `https://github.com/${owner}/${repo}/tree/${branch}/${skill.repoRelPath}`,
          repo: `${owner}/${repo}`,
          local_folder: skill.localPath,
        });

        if (results.length >= maxResults) break;
      }

      if (results.length >= maxResults) break;
    } catch (repoError) {
      const msg = `${owner}/${repo}: ${repoError instanceof Error ? repoError.message : String(repoError)}`;
      logger.warn(`[GitHubSkillSearcher] Failed: ${msg}`, 'GitHubSkillSearcher');
      errors.push(msg);
    }
  }

  // If we got zero results and every repo failed, throw so the caller can
  // include the error details in the tool response.
  if (results.length === 0 && errors.length === GITHUB_SKILL_REPOS.length) {
    throw new Error(`All GitHub skill repos failed:\n${errors.join('\n')}`);
  }

  return results;
}

/**
 * Invalidate the local index cache for all repos.
 * Useful after a repo has been re-cloned or updated externally.
 */
export function clearLocalIndexCache(): void {
  localIndexCache.clear();
}
