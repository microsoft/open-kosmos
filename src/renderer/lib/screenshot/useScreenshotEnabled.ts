import { useState, useEffect } from 'react';
import { useFeatureFlag } from '../featureFlags';
import { appDataManager } from '../userData/appDataManager';

export function useScreenshotEnabled(): boolean {
  const featureEnabled = useFeatureFlag('kosmosFeatureScreenshot');
  const [enabled, setEnabled] = useState<boolean>(
    () => appDataManager.getConfig().screenshotSettings?.enabled ?? false,
  );

  useEffect(() => {
    const check = (config: ReturnType<typeof appDataManager.getConfig>) => {
      setEnabled(config.screenshotSettings?.enabled ?? false);
    };

    check(appDataManager.getConfig());
    const unsub = appDataManager.subscribe(check);
    return unsub;
  }, []);

  if (!featureEnabled) return false;
  return enabled;
}
