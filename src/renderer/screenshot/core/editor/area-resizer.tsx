import React, { memo, CSSProperties } from 'react';
import { EditArea, Rect } from '../type';
import { handleDrag } from '../common/utils/drag';
import { calcCursorRect, limitPointInRect } from '../common/utils/coord';
import { css } from '../common/styled';


const SDrager = css`
  transform: translate(-50%, -50%);
  position: absolute;
  border: 2px solid black;
  border-radius: 10px;
  background-color: white;
  user-select: none;
`;

/**
 * ----------------------------------------------------------------------------
 * Commonly used types and functions
 * ----------------------------------------------------------------------------
 */
export type Horizon = 'left' | 'center' | 'right';
export type Vertical = 'top' | 'middle' | 'bottom';

interface HandleChange {
  init: EditArea,
  change: (area: EditArea) => void;
  endChange: () => void;
}

type ReduceResize = (reduce: (input: EditArea) => EditArea) => void;

/**
 * One corner of the origin area is changed by deltaX and deltaY
 * this method calculates the new area
 */
export function applyDelta(origin: EditArea, horizon: Horizon, vertical: Vertical, deltaX: number, deltaY: number) {
  let [x, y, w, h] = origin;
  let [endX, endY] = [x + w, h + y];
  if (vertical === 'top') y += deltaY;
  if (vertical === 'bottom') endY += deltaY;
  if (horizon === 'left') x += deltaX;
  if (horizon === 'right') endX += deltaX;
  return calcCursorRect(x, y, endX, endY);
}

/**
 * Judge from the event: which key is pressed
 * and call the function to output the movement by deltaX and deltaY
 */
function judgeKeyMove(ev: React.KeyboardEvent<any>, call: (dx: number, dy: number) => void) {
  switch (ev.keyCode) {
    case 37: // left
      call(-1, 0);
      break;
    case 38: // up
      call(0, -1);
      break;
    case 39: // right
      call(1, 0);
      break;
    case 40: // down
      call(0, 1);
      break;
    default: break;
  }
}

/**
 * One corner of the origin area is choosed by mouse down
 * then implement the drag operation
 */
function startDrag(
  ev: React.PointerEvent,
  onChangeStart: () => HandleChange,
  horizon: Horizon,
  vertical: Vertical,
  cursor: string,
) {
  ev.stopPropagation();
  const [startX, startY] = [ev.clientX, ev.clientY];
  const { init, change, endChange } = onChangeStart();
  const limit: Rect = [0, 0, window.innerWidth, window.innerHeight];
  handleDrag({
    onMove: (e: PointerEvent) => {
      /**
       * !Note: move cursor when mouse down
       * Even if the cursor is out of the window, the mousemove event will still be triggered
       */
      const [endX, endY] = limitPointInRect(limit, e.clientX, e.clientY);
      const [deltaX, deltaY] = [endX - startX, endY - startY];
      change(applyDelta(init, horizon, vertical, deltaX, deltaY));
    },
    onEnd: endChange,
    cursor,
  });
}

/**
 * ----------------------------------------------------------------------------
 * implementation for the main Resizer component
 * ----------------------------------------------------------------------------
 */
export const points: Array<[Horizon, Vertical, string]> = [
  ['left', 'top', 'nwse-resize'],
  ['center', 'top', 'ns-resize'],
  ['right', 'top', 'nesw-resize'],
  ['right', 'middle', 'ew-resize	'],
  ['right', 'bottom', 'nwse-resize'],
  ['center', 'bottom', 'ns-resize'],
  ['left', 'bottom', 'nesw-resize'],
  ['left', 'middle', 'ew-resize'],
];

const Position = {
  x: { left: 0, center: '50%', right: '100%' },
  y: { top: 0, middle: '50%', bottom: '100%' },
};

interface ScreenshotProps {
  size?: number;
  onChangeStart: () => HandleChange;
  onReduce: ReduceResize;
}
function ResizeScreenshot(props: ScreenshotProps) {
  const { size = 6, onChangeStart, onReduce } = props;
  const list = points.map(([h, v, cursor]) => {
    const left = Position.x[h];
    const top = Position.y[v];
    const style: CSSProperties = { height: size, width: size, left, top, cursor };

    let tabIndex: number | undefined;
    let onKeyDown: React.KeyboardEventHandler<HTMLDivElement> | undefined;
    if (h !== 'center' && v !== 'middle') {
      tabIndex = 1;
      onKeyDown = (ev) => {
        judgeKeyMove(ev, (dx, dy) => {
          ev.preventDefault();
          onReduce((origin) => applyDelta(origin, h, v, dx, dy));
        });
      };
    }

    return (
      <div
        key={h + v}
        style={style}
        className={SDrager}
        onPointerDown={ev => startDrag(ev, onChangeStart, h, v, cursor)}
        role="button"
        aria-label={ `${h} ${v} resize handle`}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
      />
    );
  });
  return <>{list}</>;
}

export default memo(ResizeScreenshot);
