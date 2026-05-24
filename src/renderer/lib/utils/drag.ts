import React from 'react';
import { Point } from './coord';

interface MoveContext {
  offset: Point;
  first: boolean;
}

interface EndContext {
  offset: Point;
  duration: number;
}

export interface DragHooks {
  onMove: (context: MoveContext, event: MouseEvent) => void;
  onEnd?: (context: EndContext, event: MouseEvent) => void;
}

const NOOP = () => {};
export function handleDrag(
  startEvent: React.MouseEvent | MouseEvent,
  { onMove, onEnd = NOOP }: DragHooks
) {
  let moved = false;
  let offset = new Point();
  let startTime = 0;
  const [sx, sy] = [startEvent.clientX, startEvent.clientY];

  const handleMove = (event: MouseEvent) => {
    offset = new Point(event.x - sx, event.y - sy);
    if (moved) {
      onMove({ offset, first: false }, event);
    } else {
      startTime = Date.now();
      onMove({ offset, first: true }, event);
      moved = true;
    }
  };

  const handleUp = (event: MouseEvent) => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
    if (!moved) return;
    onEnd({
      offset: offset.clone(),
      duration: Date.now() - startTime,
    }, event);
  };

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
}

