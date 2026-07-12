/**
 * Generic React hook over a {@link ./sidecarListCacheManager}.
 *
 * Subscribes to a full-list-replace sidecar cache and re-renders on change.
 * Accepts an optional `fallback` (e.g. `profile.skills` / `profile.hooks` from
 * the still-present monolithic cache) returned only while the normalized cache
 * is cold, so consumers can migrate additively.
 */

import { useEffect, useRef, useState } from 'react';

/** Minimal read surface a hook needs from a sidecar list cache. */
export interface ReadableListCache<T> {
  getItems(): T[];
  subscribe(listener: (data: unknown) => void): () => void;
}

export function useSidecarList<T>(
  manager: ReadableListCache<T>,
  fallback?: T[] | null,
): T[] {
  const fallbackRef = useRef<T[] | null | undefined>(fallback);
  fallbackRef.current = fallback;

  const [items, setItems] = useState<T[]>(() => resolveList(manager, fallback));

  useEffect(() => {
    const update = () => {
      setItems(resolveList(manager, fallbackRef.current));
    };
    update();
    return manager.subscribe(update);
  }, [manager]);

  return items;
}

function resolveList<T>(
  manager: ReadableListCache<T>,
  fallback: T[] | null | undefined,
): T[] {
  const items = manager.getItems();
  if (items.length === 0 && fallback && fallback.length > 0) {
    return fallback;
  }
  return items;
}
