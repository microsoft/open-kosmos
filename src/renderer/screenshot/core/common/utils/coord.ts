import { Rect, Point } from '../../type';

export function calcCursorRect(startX: number, startY: number, endX: number, endY: number): Rect {
  const [x, w] = (startX < endX) ? [startX, endX - startX] : [endX, startX - endX];
  const [y, h] = (startY < endY) ? [startY, endY - startY] : [endY, startY - endY];
  return [x, y, w, h];
}

export function offsetRect(rect: Rect, offsetX: number, offsetY: number): Rect {
  const [x, y, w, h] = rect;
  return [x + offsetX, y + offsetY, w, h];
}


function limitPointInSection(start: number, length: number, value: number) {
  if (value < start) return start;
  const end = start + length;
  if (value > end) return end;
  return value;
}

export function limitPointInRect(area: Rect, cx: number, cy: number): Point {
  const [x, y, w, h] = area;
  return [
    limitPointInSection(x, w, cx),
    limitPointInSection(y, h, cy),
  ];
}

export function isRectEqual(a: Rect, b: Rect) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}


function limitSectionOverflow(max: number, from: number, count: number): Point {
  if (from < 0) {
    return [0, count];
  }
  const end = from + count;
  if (end > max) {
    return [max - count, count];
  }
  return [from, count];
}

export function limitRectOverflow(width: number, height: number, rect: Rect): Rect {
  const [x, w] = limitSectionOverflow(width, rect[0], rect[2]);
  const [y, h] = limitSectionOverflow(height, rect[1], rect[3]);
  return [x, y, w, h];
}

export function LimitBothOverflow(max: number, a: number, b: number) {
  let [start, end] = (a < b) ? [a, b] : [b, a];
  if (start < 0) {
    const count = end - start;
    [start, end] = [0, count];
  } else if (end > max) {
    const count = end - start;
    [start, end] = [max - count, max];
  }
  return (a < b) ? [start, end] : [end, start];
}

// Function to check if the inner rect is inside or equal to outer rect.
export function isRectWithinOrEqualTo(outerRect: Rect, innerRect: Rect) {
  const [outerRectX, outerRectY, outerRectW, outerRectH] = outerRect;
  const [innerRectX, innerRectY, innerRectW, innerRectH] = innerRect;
  const [outerRectEndX, outerRectEndY] = [
    outerRectX + outerRectW,
    outerRectY + outerRectH,
  ];
  const [innerRectEndX, innerRectEndY] = [
    innerRectX + innerRectW,
    innerRectY + innerRectH,
  ];

  return (
    innerRectX >= outerRectX &&
    innerRectY >= outerRectY &&
    outerRectEndX >= innerRectEndX &&
    outerRectEndY >= innerRectEndY
  );
}

export function isNotIntersected(rect1: Rect, rect2: Rect) {
  const [x1, y1, w1, h1] = rect1;
  const [x2, y2, w2, h2] = rect2;
  return (x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
}

export function isIntersected(rect1: Rect, rect2: Rect) {
  return !isNotIntersected(rect1, rect2);
}

export function isContain(rect1: Rect, rect2: Rect) {
  const [x1, y1, w1, h1] = rect1;
  const [x2, y2, w2, h2] = rect2;
  return (x1 <= x2 && y1 <= y2 && x1 + w1 >= x2 + w2 && y1 + h1 >= y2 + h2);
}
