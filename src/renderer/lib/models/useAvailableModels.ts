import { useCallback, useEffect, useRef, useState } from 'react'
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes'
import { getAllOpenKosmosUsedModels } from './ghcModels'

export interface UseAvailableModelsOptions {
  /**
   * When the local cache is empty on first load, also issue an IPC call to
   * proactively fetch the model list from the main process. Defaults to
   * `false` (passive mode: only read cache + listen to `modelCacheUpdated`).
   */
  fetchOnEmpty?: boolean
}

export interface UseAvailableModelsResult {
  models: GhcCopilotModel[]
  isLoading: boolean
  error: string | null
  /**
   * Re-read the cache. Pass `true` to also fall back to a backend IPC call
   * when the cache is empty (used e.g. when the user opens a dropdown and
   * we want to surface models even if the cache hasn't warmed up yet).
   */
  refresh: (allowBackendFetch?: boolean) => Promise<void>
}

/**
 * Shared hook for renderer components that need the OpenKosmos model list.
 *
 * Behaviour:
 * - Reads from the renderer-side cache via `getAllOpenKosmosUsedModels()`.
 * - Subscribes to the `modelCacheUpdated` window event so the list refreshes
 *   automatically when the main process pushes new data.
 * - Optionally falls back to an `electronAPI.models.getAllOpenKosmosUsedModels()`
 *   IPC call when the cache is empty (`fetchOnEmpty` or explicit `refresh(true)`).
 *
 * Replaces duplicated model-loading code that previously lived in
 * `ModelSelector` and `SubAgentModelSelect`.
 */
export function useAvailableModels(
  options: UseAvailableModelsOptions = {},
): UseAvailableModelsResult {
  const { fetchOnEmpty = false } = options

  const [models, setModels] = useState<GhcCopilotModel[]>(() => {
    try {
      return getAllOpenKosmosUsedModels()
    } catch {
      return []
    }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async (allowBackendFetch = false) => {
    try {
      const cached = getAllOpenKosmosUsedModels()
      if (!isMountedRef.current) return

      setModels(cached)
      setError(null)

      if (cached.length > 0 || !allowBackendFetch) {
        return
      }

      const modelsApi = window.electronAPI?.models
      if (!modelsApi?.getAllOpenKosmosUsedModels) {
        setError('Model list is not available yet')
        return
      }

      setIsLoading(true)
      const result = await modelsApi.getAllOpenKosmosUsedModels()
      if (!isMountedRef.current) return

      if (result.success) {
        setModels(result.data || [])
        setError(null)
      } else {
        setError(result.error || 'Failed to load models')
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setModels([])
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh(fetchOnEmpty)

    const handleModelCacheUpdated = () => {
      void refresh(false)
    }

    window.addEventListener('modelCacheUpdated', handleModelCacheUpdated)
    return () => {
      window.removeEventListener('modelCacheUpdated', handleModelCacheUpdated)
    }
  }, [refresh, fetchOnEmpty])

  return { models, isLoading, error, refresh }
}
