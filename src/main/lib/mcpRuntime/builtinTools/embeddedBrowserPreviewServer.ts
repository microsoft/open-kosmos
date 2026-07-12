import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { randomBytes } from 'crypto';

const MAX_PREVIEW_TOKENS = 100;
const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

export class WorkspacePreviewServer {
  private static instance: WorkspacePreviewServer | null = null;
  private server: http.Server | null = null;
  private port: number | null = null;
  private roots = new Map<string, { sessionId: string; workspaceRoot: string; baseDir: string; filePath: string; relativeName: string; allowedRelatives: Set<string>; createdAt: number }>();

  static shared(): WorkspacePreviewServer {
    WorkspacePreviewServer.instance ??= new WorkspacePreviewServer();
    return WorkspacePreviewServer.instance;
  }

  async register(sessionId: string, workspaceRootInput: string, filePathInput: string): Promise<{
    url: string;
    filePath: string;
    workspaceRoot: string;
  }> {
    const workspaceRoot = fs.realpathSync(path.resolve(workspaceRootInput));
    const filePath = fs.realpathSync(path.resolve(workspaceRoot, filePathInput));
    if (!this.isInside(workspaceRoot, filePath)) {
      throw new Error('open_local_file can only serve files inside the workspace root.');
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error('open_local_file requires a file path.');
    }
    await this.ensureListening();
    this.pruneRoots();
    const token = randomBytes(16).toString('hex');
    const baseDir = path.dirname(filePath);
    const relativeName = path.basename(filePath);
    const allowedRelatives = this.collectAllowedRelativeAssets(filePath, relativeName);
    this.roots.set(token, { sessionId, workspaceRoot, baseDir, filePath, relativeName, allowedRelatives, createdAt: Date.now() });
    this.pruneRoots();
    const relative = encodeURIComponent(path.basename(filePath));
    return {
      url: `http://127.0.0.1:${this.port}/preview/${token}/${relative}`,
      filePath,
      workspaceRoot,
    };
  }

  private ensureListening(): Promise<void> {
    if (this.server && this.port) return Promise.resolve();
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as { port: number };
        this.port = address.port;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const match = parsed.pathname.match(/^\/preview\/([^/]+)\/(.*)$/);
      if (!match) {
        res.writeHead(404).end('Not found');
        return;
      }
      const [, token, encodedRelative] = match;
      this.pruneRoots();
      const entry = this.roots.get(token);
      if (!entry) {
        res.writeHead(404).end('Unknown preview token');
        return;
      }
      const relative = decodeURIComponent(encodedRelative || '').replace(/\0/g, '');
      if (relative !== entry.relativeName && !entry.allowedRelatives.has(this.normalizeRelativeAsset(relative))) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const requestedPath = relative === entry.relativeName ? entry.filePath : path.resolve(entry.baseDir, relative);
      const filePath = fs.realpathSync(requestedPath);
      if (!this.isInside(entry.baseDir, filePath) || !this.isInside(entry.workspaceRoot, filePath)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (relative === entry.relativeName && filePath !== entry.filePath) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        res.destroy(err instanceof Error ? err : undefined);
      });
      stream.on('open', () => {
        res.writeHead(200, {
          'Content-Type': this.mimeType(filePath),
          'Content-Length': stat.size,
          'Cache-Control': 'no-store',
        });
        stream.pipe(res);
      });
    } catch {
      res.writeHead(404).end('Not found');
    }
  }

  private isInside(root: string, child: string): boolean {
    const relative = path.relative(root, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private collectAllowedRelativeAssets(filePath: string, relativeName: string): Set<string> {
    const allowed = new Set<string>();
    if (!/\.(html?|svg)$/i.test(relativeName)) return allowed;
    const content = this.readTextFile(filePath);
    if (content === null) return allowed;
    this.collectAssetReferences(content, allowed, true);
    this.collectLinkedCssAssets(path.dirname(filePath), allowed);
    return allowed;
  }

  private collectLinkedCssAssets(baseDir: string, allowed: Set<string>): void {
    const scanned = new Set<string>();
    const queue = Array.from(allowed).filter((relative) => /\.css$/i.test(relative));

    for (let index = 0; index < queue.length; index += 1) {
      const relative = queue[index];
      if (scanned.has(relative)) continue;
      scanned.add(relative);

      const filePath = this.resolveSameDirectoryAsset(baseDir, relative);
      if (!filePath) continue;
      const content = this.readTextFile(filePath);
      if (content === null) continue;

      const before = allowed.size;
      this.collectAssetReferences(content, allowed, false);
      if (allowed.size === before) continue;
      for (const next of allowed) {
        if (/\.css$/i.test(next) && !scanned.has(next) && !queue.includes(next)) {
          queue.push(next);
        }
      }
    }
  }

  private resolveSameDirectoryAsset(baseDir: string, relative: string): string | null {
    try {
      const filePath = fs.realpathSync(path.resolve(baseDir, relative));
      if (!this.isInside(baseDir, filePath)) return null;
      const stat = fs.statSync(filePath);
      return stat.isFile() ? filePath : null;
    } catch {
      return null;
    }
  }

  private readTextFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private collectAssetReferences(content: string, allowed: Set<string>, includeHtmlAttributes: boolean): void {
    if (includeHtmlAttributes) {
      const attrPattern = /\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi;
      for (const match of content.matchAll(attrPattern)) {
        const normalized = this.normalizeRelativeAsset(match[2]);
        if (normalized) allowed.add(normalized);
      }
    }

    const cssPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
    for (const match of content.matchAll(cssPattern)) {
      const normalized = this.normalizeRelativeAsset(match[2]);
      if (normalized) allowed.add(normalized);
    }
  }

  private normalizeRelativeAsset(value: string): string {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return '';
    const noQuery = raw.split(/[?#]/, 1)[0];
    if (!noQuery || noQuery.startsWith('/')) return '';
    return path.posix.normalize(noQuery.replace(/\\/g, '/'));
  }

  private pruneRoots(now = Date.now()): void {
    for (const [token, entry] of this.roots) {
      if (now - entry.createdAt > PREVIEW_TOKEN_TTL_MS) {
        this.roots.delete(token);
      }
    }
    while (this.roots.size > MAX_PREVIEW_TOKENS) {
      const oldestToken = this.roots.keys().next().value;
      this.roots.delete(oldestToken!);
    }
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.roots.clear();
      this.close();
      return;
    }
    for (const [token, entry] of this.roots) {
      if (entry.sessionId === sessionId) this.roots.delete(token);
    }
  }

  close(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
  }

  private mimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain; charset=utf-8',
    };
    return types[ext] || 'application/octet-stream';
  }
}
