/**
 * macOS permission checks for Computer Use.
 *
 * Two OS gates matter:
 *  - Screen Recording (`getMediaAccessStatus('screen')`) for screenshots.
 *  - Accessibility (`isTrustedAccessibilityClient`) for synthetic input + window
 *    focus to reach OTHER apps.
 *
 * On non-darwin platforms there is no equivalent gate, so we report screen
 * recording as `granted` and accessibility as `true`.
 *
 * The Electron surface is injected via {@link PermissionDeps} so the decision
 * logic is unit-testable; {@link defaultPermissionDeps} binds the real APIs.
 */

import { systemPreferences } from 'electron';
import type { PermissionStatus } from './types';

export interface PermissionDeps {
  platform: NodeJS.Platform;
  /** macOS `systemPreferences.getMediaAccessStatus('screen')`. */
  getScreenStatus: () => string;
  /** macOS `systemPreferences.isTrustedAccessibilityClient(prompt)`. */
  isTrustedAccessibility: (prompt: boolean) => boolean;
}

/** Bind the real Electron `systemPreferences` APIs. */
export function defaultPermissionDeps(): PermissionDeps {
  return {
    platform: process.platform,
    getScreenStatus: () => systemPreferences.getMediaAccessStatus('screen'),
    isTrustedAccessibility: (prompt: boolean) =>
      systemPreferences.isTrustedAccessibilityClient(prompt),
  };
}

/**
 * Report current permission status. Pass `prompt=true` to trigger the macOS
 * Accessibility system prompt (used by the Settings "Grant" button); pass false
 * for a passive check.
 */
export function getPermissionStatus(
  prompt: boolean = false,
  deps: PermissionDeps = defaultPermissionDeps(),
): PermissionStatus {
  if (deps.platform !== 'darwin') {
    return { screenRecording: 'granted', accessibility: true };
  }
  return {
    screenRecording: deps.getScreenStatus(),
    accessibility: deps.isTrustedAccessibility(prompt),
  };
}

/** True when both screenshots and synthetic input are permitted. */
export function hasRequiredPermissions(status: PermissionStatus): boolean {
  return status.screenRecording === 'granted' && status.accessibility === true;
}

/** Human-readable, agent-facing reason a Computer Use action cannot proceed, or null when permitted. */
export function permissionBlockReason(status: PermissionStatus): string | null {
  if (status.screenRecording !== 'granted') {
    return 'Screen Recording permission is required (System Settings > Privacy & Security > Screen Recording). Restart the app after granting.';
  }
  if (status.accessibility !== true) {
    return 'Accessibility permission is required (System Settings > Privacy & Security > Accessibility) to control other apps.';
  }
  return null;
}
