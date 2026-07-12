/**
 * React hooks for sub-agent task viewing
 */

import { useSyncExternalStore, useEffect, useRef, useState } from 'react';
import { subAgentTaskCacheManager } from './subAgentTaskCacheManager';
import type { SubAgentTaskViewStatus } from '@shared/types/subAgentStreamingTypes';
import { useI18n } from '../i18n/useI18n';

/**
 * Get messages for a sub-agent task (live-updating during streaming)
 */
export function useSubAgentTaskMessages(taskId: string | null): any[] {
  const snapshot = useSyncExternalStore(
    (cb) => subAgentTaskCacheManager.subscribe(cb),
    () => subAgentTaskCacheManager.getSnapshot(),
  );

  if (!taskId) return [];
  return snapshot.get(taskId)?.messages ?? [];
}

/**
 * Get status for a sub-agent task
 */
export function useSubAgentTaskStatus(taskId: string | null): SubAgentTaskViewStatus | undefined {
  const snapshot = useSyncExternalStore(
    (cb) => subAgentTaskCacheManager.subscribe(cb),
    () => subAgentTaskCacheManager.getSnapshot(),
  );

  if (!taskId) return undefined;
  return snapshot.get(taskId)?.status;
}

/**
 * Open and manage a sub-agent task view lifecycle
 */
export function useSubAgentTask(taskId: string | null) {
  const { t } = useI18n();
  const tRef = useRef(t);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!taskId) return;

    let disposed = false;
    setLoading(true);
    setError(null);

    subAgentTaskCacheManager.open(taskId)
      .then((cache) => {
        if (!cache && !disposed) setError(tRef.current('sidepane.subAgents.taskNotFound'));
      })
      .catch((err) => {
        if (!disposed) setError(err.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      subAgentTaskCacheManager.close(taskId).catch(() => {});
    };
  }, [taskId]);

  const messages = useSubAgentTaskMessages(taskId);
  const status = useSubAgentTaskStatus(taskId);

  return { messages, status, loading, error };
}
