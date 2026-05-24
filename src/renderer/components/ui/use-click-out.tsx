import { useEffect } from 'react';

export function useClickOut(
  ref: React.RefObject<HTMLElement | null>,
  handle: VoidFunction,
) {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      const element = ref.current;
      if (element && !element.contains(event.target as Node)) {
        handle();
      }
    };
    document.addEventListener('mousedown', listener, true);
    return () => document.removeEventListener('mousedown', listener, true);
  }, [ref, handle]);
}
