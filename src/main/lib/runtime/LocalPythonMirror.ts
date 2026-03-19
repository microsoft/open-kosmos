import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { AddressInfo } from 'net';

const logger = createLogger();

export class LocalPythonMirror {
  private static instance: LocalPythonMirror;
  private server: http.Server | null = null;
  private port: number = 0;
  private resourcesPath: string;

  private constructor() {
    this.resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'python')
      : path.join(process.cwd(), 'resources', 'python');
      
    logger.debug(`[LocalPythonMirror] Initialized with resources path: ${this.resourcesPath}`, 'RuntimeManager');
  }

  public static getInstance(): LocalPythonMirror {
    if (!LocalPythonMirror.instance) {
      LocalPythonMirror.instance = new LocalPythonMirror();
    }
    return LocalPythonMirror.instance;
  }

  public async start(): Promise<string> {
    if (this.server) {
        return this.getBaseUrl();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on random port on localhost
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as AddressInfo;
        this.port = address.port;
        logger.info(`[LocalPythonMirror] Started on port ${this.port}`, 'RuntimeManager');
        resolve(this.getBaseUrl());
      });
      
      this.server.on('error', (err) => {
        logger.error(`[LocalPythonMirror] Server error`, 'RuntimeManager', { error: err });
        // If we haven't resolved yet (startup error), we should probably reject
        if (this.port === 0) {
            reject(err);
        }
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getBaseUrlIfRunning(): string | null {
      if (this.server && this.port > 0) {
          return `http://127.0.0.1:${this.port}`;
      }
      return null;
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
      logger.info(`[LocalPythonMirror] Stopped`, 'RuntimeManager');
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Expected format: /TAG/FILENAME
    // e.g. /20240106/cpython-3.12.1+20240106-x86_64-pc-windows-msvc-install_only.tar.gz
    logger.debug(`[LocalPythonMirror] Received request: ${req.url}`, 'RuntimeManager');
    try {
        const decodedUrl = req.url ? decodeURIComponent(req.url) : '';
        const urlParts = decodedUrl.split('/').filter(Boolean);
        if (urlParts.length < 2) {
            res.statusCode = 400;
            res.end('Invalid request format');
            return;
        }

        // uv uses {MIRROR}/{TAG}/{FILENAME}
        const tag = urlParts[urlParts.length - 2];
        const filename = urlParts[urlParts.length - 1];
        
        // Check local file
        const localFilePath = path.join(this.resourcesPath, tag, filename);
        
        if (fs.existsSync(localFilePath)) {
            logger.info(`[LocalPythonMirror] Serving local file: ${filename}`, 'RuntimeManager');
            try {
                const stat = fs.statSync(localFilePath);
                res.writeHead(200, {
                    'Content-Type': 'application/gzip',
                    'Content-Length': stat.size
                });
                const readStream = fs.createReadStream(localFilePath);
                readStream.pipe(res);
            } catch (fileErr) {
                 logger.error(`[LocalPythonMirror] Error reading file: ${filename}`, 'RuntimeManager', { error: fileErr });
                 res.statusCode = 500;
                 res.end('Error reading local file');
            }
        } else {
            // Redirect to GitHub
            const githubUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${filename}`;
            logger.info(`[LocalPythonMirror] File not found locally (${filename}), redirecting to: ${githubUrl}`, 'RuntimeManager');
            res.writeHead(302, { 'Location': githubUrl });
            res.end();
        }
    } catch (error) {
        logger.error(`[LocalPythonMirror] Request handling error`, 'RuntimeManager', { error });
        res.statusCode = 500;
        res.end('Internal Server Error');
    }
  }
}
