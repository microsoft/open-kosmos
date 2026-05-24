/**
 * React hooks for sub-agent task viewing
 */

import { useSyncExternalStore, useEffect, useState, useCallback } from 'react';
import { subAgentTaskCacheManager } from './subAgentTaskCacheManager';
import type { SubAgentTaskViewStatus } from '@shared/types/subAgentStreamingTypes';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;

    setLoading(true);
    setError(null);

    subAgentTaskCacheManager.open(taskId)
      .then((cache) => {
        if (!cache) setError('Task not found');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    return () => {
      subAgentTaskCacheManager.close(taskId).catch(() => {});
    };
  }, [taskId]);

  const messages = useSubAgentTaskMessages(taskId);
  const status = useSubAgentTaskStatus(taskId);

  return { messages, status, loading, error };
}
