/**
 * useEmbeddedBrowserEnabled
 *
 * Returns true when the current profile's browser.enabled === true (per-profile
 * master switch for the embedded browser feature, stored in profile.json).
 *
 * Used by ChatViewHeader to decide whether to show the Browser (Globe) button.
 *
 * Usage:
 *   const browserEnabled = useEmbeddedBrowserEnabled();
 */

import { useProfileData } from '../../components/userData/userDataProvider';

export function useEmbeddedBrowserEnabled(): boolean {
  const profileData = useProfileData();
  return profileData?.data.profile?.browser?.enabled === true;
}
