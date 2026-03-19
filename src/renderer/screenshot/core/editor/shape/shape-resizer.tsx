import React from 'react';
import { EditArea, Rect } from '../../type';
import { isRectEqual } from '../../common/utils/coord';
import { points, Horizon, Vertical, applyDelta } from '../area-resizer';
import { DragLimiter } from '../../common/drag-limiter';
import { handleDrag } from '../../common/utils/drag';

export interface HandleChange {
  change: (rect: Rect) => void;
  endChange: (rect?: Rect) => void;
  onceMoved?: (flag: boolean) => void;
}

interface Props {
  limit: Rect;
  rect: Rect;
  onChangeStart: () => HandleChange;
  children?: React.ReactNode;
  aspectRatio?: number;
}

function calc(rect: Rect, size: number) {
  const [x, y, w, h] = rect;
  const half = size / 2;
  const top = y + half;
  const middle = y + h / 2;
  const bottom = y + h - half;
  const left = x + half;
  const center = x + w / 2;
  const right = x + w - half;
  const height = bottom - top;
  const width = right - left;
  return { top, middle, bottom, left, center, right, width, height };
}

function applyRatio(origin: EditArea, nRect: Rect, horizon: Horizon, vertical: Vertical, aspectRatio: number): Rect {
  const [x, y, w, h] = origin;
  let [endX, endY] = [x + w, h + y];
  let [nX, nY, nW, nH] = nRect;
  let [nEndX, nEndY] = [nX + nW, nY + nH];
  const ratio = nW / nH;
  if (ratio > aspectRatio) {
    nW = nH * aspectRatio;
  } else {
    nH = nW / aspectRatio;
  }
  return [
    horizon === 'right' ? (nEndX <= x ? x - nW : x) : (nX >= endX ? endX : endX - nW),
    vertical=== 'bottom' ?  (nEndY <= y ? y - nH : y) : (nY >= endY ? endY : endY - nH),
    nW,
    nH,
  ];
}

function startDrag(
  ev: React.PointerEvent,
  limit: Rect,
  prev: Rect,
  onChangeStart: () => HandleChange,
  horizon: Horizon,
  vertical: Vertical,
  cursor: string,
  aspectRatio?: number
) {
  ev.stopPropagation();
  const limiter = new DragLimiter(limit, ev);
  const { change, endChange, onceMoved } = onChangeStart();
  let rect = prev;
  handleDrag({
    onMove: (e: PointerEvent) => {
      const [deltaX, deltaY] = limiter.offset(e);
      rect = applyDelta(prev, horizon, vertical, deltaX, deltaY);
      if (aspectRatio) {
        rect = applyRatio(prev, rect, horizon, vertical, aspectRatio);
      }
      change(rect);
    },
    onceMoved,
    onEnd: () => {
      if (rect[2] === 0 || rect[3] === 0 || isRectEqual(rect, prev)) {
        endChange();
      } else {
        endChange(rect);
      }
    },
    cursor,
  });
}

function Resizer(props: Props) {
  const { limit, rect, children, onChangeStart, aspectRatio } = props;
  const box = calc(rect, 0);
  const { left, top, width, height } = box;
  const nodes = points.map(([h, v, cursor]) => {
    if (aspectRatio && (h === 'center' || v === 'middle')) {
      return null;
    }
    return (
      <circle
        key={h + '-' + v}
        stroke="#0078D7"
        strokeWidth={2}
        fill="white"
        cx={box[h]}
        cy={box[v]}
        r={5}
        onPointerDown={ev => startDrag(ev, limit, rect, onChangeStart, h, v, cursor, aspectRatio)}
        style={{ cursor }}
      />
    );
  });

  return (
    <>
      <rect x={left} y={top} width={width} height={height} stroke="#0078D7" strokeWidth={1} fill="none" />
      {children}
      {nodes}
    </>
  );
}

export default Resizer;
