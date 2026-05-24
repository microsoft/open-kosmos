/**
 * BrowserProfileManager — Playwright persistent browser profile management
 *
 * Profiles are stored under the system temp directory (NOT userData):
 *   <tmpdir>/openkosmos-playwright-profiles/<profileName>/
 *
 * This ensures that profile data (which may contain browser localStorage
 * with auth tokens) does not persist across system reboots on most OSes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUnifiedLogger } from '../unifiedLogger';

const logger = getUnifiedLogger();

export class BrowserProfileManager {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(os.tmpdir(), 'openkosmos-playwright-profiles');
  }

  /** Get profile directory path */
  getProfilePath(profileName: string): string {
    return path.join(this.baseDir, profileName);
  }

  /** Check if profile exists (determines whether first-time login is needed) */
  profileExists(profileName: string): boolean {
    const profilePath = this.getProfilePath(profileName);
    return fs.existsSync(profilePath);
  }

  /** Ensure the profile directory exists */
  ensureProfileDir(profileName: string): string {
    const profilePath = this.getProfilePath(profileName);
    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
      logger.info(`[BrowserProfile] Created profile directory: ${profileName}`);
    }
    return profilePath;
  }

  /** Delete profile (used to clear auth state) */
  async deleteProfile(profileName: string): Promise<void> {
    const profilePath = this.getProfilePath(profileName);
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, { recursive: true, force: true });
      logger.info(`[BrowserProfile] Deleted profile: ${profileName}`);
    }
  }

  /** List all profiles */
  listProfiles(): string[] {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }
    return fs.readdirSync(this.baseDir).filter((name) => {
      const fullPath = path.join(this.baseDir, name);
      return fs.statSync(fullPath).isDirectory();
    });
  }
}
