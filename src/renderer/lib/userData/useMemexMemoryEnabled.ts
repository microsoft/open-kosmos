/**
 * useMemexMemoryEnabled
 *
 * Returns true when the current profile's memex.enabled === true (per-profile
 * master switch for the per-agent memory feature, stored in profile.json).
 *
 * Used by MemexMemorySidepane (and its header ToggleMemexMemory button) to
 * decide whether to render the Agent Memory pane / toggle.
 *
 * Usage:
 *   const memexEnabled = useMemexMemoryEnabled();
 */

import { useProfileData } from '../../components/userData/userDataProvider';

export function useMemexMemoryEnabled(): boolean {
  const profileData = useProfileData();
  return profileData?.data.profile?.memex?.enabled === true;
}
