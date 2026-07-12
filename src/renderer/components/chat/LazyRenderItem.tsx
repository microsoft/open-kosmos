import React, { useRef, useEffect, useState } from 'react';

const LAZY_RENDER_MARGIN = '2000px';
const LAZY_PLACEHOLDER_HEIGHT = 48;
export const NEAR_BOTTOM_COUNT = 30;

/**
 * LazyRenderItem — renders a placeholder until the item enters the viewport vicinity,
 * then renders the real content. Prevents expensive markdown/code rendering for
 * off-screen items on initial session load.
 *
 * The 2000px rootMargin ensures items render well before entering the viewport,
 * so height changes (48px placeholder → real content) happen off-screen and
 * do not cause visible scroll jumps.
 */
const LazyRenderItem: React.FC<{
  children: React.ReactNode;
  isNearBottom: boolean;
}> = ({ children, isNearBottom }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasBeenRendered, setHasBeenRendered] = useState(isNearBottom);

  const shouldRender = isNearBottom || hasBeenRendered;

  useEffect(() => {
    if (shouldRender && !hasBeenRendered) {
      setHasBeenRendered(true);
    }
  }, [shouldRender, hasBeenRendered]);

  useEffect(() => {
    const el = containerRef.current;
    if (shouldRender || !el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenRendered(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_RENDER_MARGIN }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldRender]);

  if (!shouldRender) {
    return <div ref={containerRef} style={{ minHeight: LAZY_PLACEHOLDER_HEIGHT }} />;
  }

  return <>{children}</>;
};
LazyRenderItem.displayName = 'LazyRenderItem';

export default LazyRenderItem;
