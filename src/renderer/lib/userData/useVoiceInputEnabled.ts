/**
 * useVoiceInputEnabled
 *
 * Returns true when voiceInput.voiceInputEnabled === true.
 * Used by ChatInput (together with the feature flag) to show the mic button.
 *
 * Usage:
 *   const voiceInputEnabled = useVoiceInputEnabled();
 */

import { useState, useEffect } from 'react';
import { appDataManager } from './appDataManager';

export function useVoiceInputEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(
    () => {
      const vi = appDataManager.getConfig().voiceInput;
      return vi?.voiceInputEnabled === true;
    }
  );

  useEffect(() => {
    const check = (config: ReturnType<typeof appDataManager.getConfig>) => {
      const vi = config.voiceInput;
      setEnabled(vi?.voiceInputEnabled === true);
    };

    // Pick up current value
    check(appDataManager.getConfig());

    // Subscribe to future updates
    const unsub = appDataManager.subscribe(check);
    return unsub;
  }, []);

  return enabled;
}
