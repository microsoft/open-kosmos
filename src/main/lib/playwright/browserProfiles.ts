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
const PROFILE_LEASE_WAIT_TIMEOUT_MS = 2 * 60 * 1000;

interface ProfileLeaseWaiter {
  grant: () => void;
}

export class BrowserProfileManager {
  private baseDir: string;
  private readonly leasedProfiles = new Set<string>();
  private readonly profileLeaseQueues = new Map<string, ProfileLeaseWaiter[]>();

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

  /**
   * Acquire exclusive in-process ownership of a persistent browser profile.
   * The returned release callback is idempotent and must be held for the full
   * browser/context lifetime, including launch and cleanup.
   */
  async acquireProfileLease(
    profileName: string,
    timeoutMs = PROFILE_LEASE_WAIT_TIMEOUT_MS,
  ): Promise<() => void> {
    const profileKey = this.getProfileLeaseKey(profileName);

    if (this.leasedProfiles.has(profileKey)) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: NodeJS.Timeout;
        const waiter: ProfileLeaseWaiter = {
          grant: () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve();
          },
        };
        const queue = this.profileLeaseQueues.get(profileKey) ?? [];
        queue.push(waiter);
        this.profileLeaseQueues.set(profileKey, queue);

        timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          const currentQueue = this.profileLeaseQueues.get(profileKey);
          const waiterIndex = currentQueue?.indexOf(waiter) ?? -1;
          if (currentQueue && waiterIndex >= 0) {
            currentQueue.splice(waiterIndex, 1);
            if (currentQueue.length === 0) {
              this.profileLeaseQueues.delete(profileKey);
            }
          }
          reject(new Error(
            `[BROWSER_PROFILE_BUSY] Timed out waiting for browser profile "${profileName}" to become available.`,
          ));
        }, timeoutMs);
      });
    } else {
      this.leasedProfiles.add(profileKey);
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const queue = this.profileLeaseQueues.get(profileKey) ?? [];
      const nextOwner = queue.shift();
      if (nextOwner) {
        if (queue.length === 0) {
          this.profileLeaseQueues.delete(profileKey);
        }
        nextOwner.grant();
        return;
      }

      this.profileLeaseQueues.delete(profileKey);
      this.leasedProfiles.delete(profileKey);
    };
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

  private getProfileLeaseKey(profileName: string): string {
    const profilePath = path.resolve(this.getProfilePath(profileName));
    return process.platform === 'win32' ? profilePath.toLowerCase() : profilePath;
  }
}
