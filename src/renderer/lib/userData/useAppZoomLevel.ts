import { useEffect, useState } from 'react';
import { appDataManager } from './appDataManager';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[UseAppZoomLevel]');

export function useAppZoomLevel(): number {
  const [zoomLevel, setZoomLevel] = useState<number>(
    () => appDataManager.getConfig().zoomLevel ?? 0,
  );

  useEffect(() => {
    const updateZoomLevel = (config: ReturnType<typeof appDataManager.getConfig>) => {
      setZoomLevel(config.zoomLevel ?? 0);
    };

    const syncWithWindowZoom = async () => {
      try {
        const actualZoomLevel = await window.electronAPI?.window?.getZoomLevel?.();
        if (typeof actualZoomLevel === 'number') {
          setZoomLevel(actualZoomLevel);
        }
      } catch (error) {
        logger.error('[useAppZoomLevel] Failed to read actual window zoom level:', error);
      }
    };

    updateZoomLevel(appDataManager.getConfig());
    void syncWithWindowZoom();

    const unsub = appDataManager.subscribe(updateZoomLevel);
    const cleanupZoomChanged = window.electronAPI?.window?.onZoomChanged?.((level) => {
      setZoomLevel(level);
    });

    return () => {
      unsub();
      cleanupZoomChanged?.();
    };
  }, []);

  return zoomLevel;
}