import React, { useRef, useEffect } from 'react';

const stopMoveBubble = (e: MouseEvent) => e.stopPropagation();
export function useStopMove() {
  const r = useRef<HTMLDivElement>(null);
  useEffect(() => {
    r.current?.addEventListener('mousemove', stopMoveBubble);
    return () => r.current?.removeEventListener('mousemove', stopMoveBubble);
  }, []);
  return r;
}