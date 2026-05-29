/**
 * ClawHub Skill Searcher
 *
 * Searches the ClawHub (clawhub.ai) public skill registry — the official
 * OpenClaw skill marketplace — using its v1 HTTP API.
 *
 * Strategy:
 * - Calls the public search endpoint which uses semantic (embedding-based)
 *   search over skill names, descriptions, and content.
 * - Downloads a matching skill's ZIP via the download endpoint.
 * - Extracts to a persistent local directory using JSZip.
 * - If the local directory already exists AND was downloaded recently (within TTL),
 *   skips the download and uses the existing files.
 * - Results point to the skill folder on disk so that subsequent
 *   apply_skill_to_agents calls can use the local path.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { app } from 'electron';
import JSZip from 'jszip';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

/** ClawHub Convex site URL — public, no auth required */
const CLAWHUB_API_BASE = 'https://wry-manatee-359.convex.site';

const DOWNLOAD_TIMEOUT_MS = 60_000; // 1 minute
const DOWNLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour — re-download after this
const TIMESTAMP_FILE = '.clawhub-download-timestamp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClawHubSearchResultRaw {
  score: number;
  slug: string;
  displayName: string;
  summary: string | null;
  version: string | null;
  updatedAt: number;
}

export interface ClawHubSkillResult {
  name: string;
  slug: string;
  description: string;
  version: string | null;
  score: number;
  url: string;
  local_folder: string | null;
}

// ---------------------------------------------------------------------------
// Persistent download directory
// ---------------------------------------------------------------------------

function getClawHubRoot(): string {
  const root = path.join(app.getPath('userData'), 'clawhub-skills');
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

function skillLocalDir(slug: string): string {
  return path.join(getClawHubRoot(), slug);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Request timed out after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`)),
      DOWNLOAD_TIMEOUT_MS,
    );

    https
      .get(url, (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          clearTimeout(timer);
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const text = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(text) as T);
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${url}: ${e}`));
          }
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
  });
}

function downloadBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`)),
      DOWNLOAD_TIMEOUT_MS,
    );

    const doRequest = (reqUrl: string, remaining: number): void => {
      https
        .get(reqUrl, (res) => {
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

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

async function extractZip(zipBuffer: Buffer, destDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (!relativePath || relativePath.startsWith('__MACOSX')) continue;
    const fullPath = path.join(destDir, relativePath);

    if (zipEntry.dir) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const content = await zipEntry.async('nodebuffer');
      fs.writeFileSync(fullPath, content);
    }
  }
}

// ---------------------------------------------------------------------------
// Download + cache a single skill
// ---------------------------------------------------------------------------

async function ensureSkillLocal(slug: string): Promise<string> {
  const localDir = skillLocalDir(slug);
  const tsFile = path.join(localDir, TIMESTAMP_FILE);

  // Check if a recent download exists
  if (fs.existsSync(tsFile)) {
    try {
      const ts = parseInt(fs.readFileSync(tsFile, 'utf-8').trim(), 10);
      if (Date.now() - ts < DOWNLOAD_TTL_MS) {
        logger.info(
          `[ClawHubSearcher] Using cached download for ${slug}`,
          'ClawHubSearcher',
        );
        return localDir;
      }
    } catch {
      // Corrupted timestamp — re-download
    }
  }

  const downloadUrl = `${CLAWHUB_API_BASE}/api/v1/download?slug=${encodeURIComponent(slug)}`;
  logger.info(
    `[ClawHubSearcher] Downloading skill ${slug} from ${downloadUrl}`,
    'ClawHubSearcher',
  );

  const zipBuffer = await downloadBuffer(downloadUrl);
  await extractZip(zipBuffer, localDir);

  // Write download timestamp
  fs.writeFileSync(tsFile, String(Date.now()), 'utf-8');

  logger.info(
    `[ClawHubSearcher] Extracted ${slug} to ${localDir}`,
    'ClawHubSearcher',
  );
  return localDir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search the ClawHub registry for skills matching `query`.
 *
 * @param query       search query (semantic search via embeddings)
 * @param maxResults  maximum number of results (default 5)
 * @returns           matching skills with metadata and optional local_folder
 */
export async function searchClawHubSkills(
  query: string,
  maxResults = 5,
): Promise<ClawHubSkillResult[]> {
  const searchUrl = `${CLAWHUB_API_BASE}/api/v1/search?q=${encodeURIComponent(query)}&limit=${maxResults}&nonSuspicious=true`;

  logger.info(
    `[ClawHubSearcher] Searching ClawHub for "${query}"`,
    'ClawHubSearcher',
  );

  const data = await httpsGetJson<{ results: ClawHubSearchResultRaw[] }>(searchUrl);

  if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
    return [];
  }

  const results: ClawHubSkillResult[] = [];

  for (const item of data.results.slice(0, maxResults)) {
    let localFolder: string | null = null;
    try {
      localFolder = await ensureSkillLocal(item.slug);
    } catch (e) {
      logger.warn(
        `[ClawHubSearcher] Failed to download ${item.slug}: ${e instanceof Error ? e.message : String(e)}`,
        'ClawHubSearcher',
      );
    }

    results.push({
      name: item.slug,
      slug: item.slug,
      description: item.summary || item.displayName,
      version: item.version,
      score: item.score,
      url: `https://clawhub.ai/skills/${item.slug}`,
      local_folder: localFolder,
    });
  }

  logger.info(
    `[ClawHubSearcher] Found ${results.length} skills for "${query}"`,
    'ClawHubSearcher',
  );

  return results;
}
