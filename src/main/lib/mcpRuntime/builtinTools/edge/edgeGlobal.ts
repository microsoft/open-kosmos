import path from 'path';

/**
 * Global singleton for managing Edge build environment state.
 * Tracks repository path, build path, and initialization status.
 */
class EdgeGlobal {
  private static instance: EdgeGlobal;
  private _repoPath: string | null = null;
  private _initialized = false;
  private _buildPath: string | null = null;

  private constructor() {}

  static getInstance(): EdgeGlobal {
    if (!EdgeGlobal.instance) {
      EdgeGlobal.instance = new EdgeGlobal();
    }
    return EdgeGlobal.instance;
  }

  setBuildPath(value: string): boolean {
    if (this._buildPath === null || this._buildPath !== value) {
      console.info(`[EdgeGlobal] Setting build path to: ${value}`);
      this._buildPath = value;
      return true;
    }
    return false;
  }

  getRepoPath(): string | null {
    return this._repoPath;
  }

  setRepoPath(value: string): boolean {
    if (this._repoPath === null || this._repoPath !== value) {
      console.info(`[EdgeGlobal] Setting repository path to: ${value}`);
      this._repoPath = value;
      return true;
    }
    return false;
  }

  getInitialized(): boolean {
    return this._initialized;
  }

  setInitialized(value: boolean): void {
    if (this._initialized !== value) {
      console.info(`[EdgeGlobal] Setting initialization status to: ${value}`);
    }
    this._initialized = value;
  }

  getBuildPath(): string {
    if (!this._repoPath || this._repoPath.trim() === '') {
      throw new Error('Repository path not set. Call init_edge_environment first.');
    }
    return path.join(this._repoPath, 'out', this._buildPath || 'debug_x64');
  }
}

export const edgeGlobal = EdgeGlobal.getInstance();
