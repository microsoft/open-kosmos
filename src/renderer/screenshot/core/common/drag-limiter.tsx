import { EditArea, Rect, Point } from '../type';
import { calcCursorRect, LimitBothOverflow, limitPointInRect, limitRectOverflow, offsetRect } from './utils/coord';

export type MEvent = PointerEvent | React.PointerEvent;

export class DragLimiter {
  private startX: number;
  private startY: number;

  constructor(
    private area: EditArea,
    startEvent: MEvent,
  ) {
    this.startX = startEvent.clientX;
    this.startY = startEvent.clientY;
  }

  private alignEndToStart(endX: number, endY: number): Point {
    const { area, startX, startY } = this;
    const [left, top, width, height] = area;
    const d = Math.min(
      Math.max(Math.abs(endX - startX), Math.abs(endY - startY)),
      (endX < startX) ? (startX - left) : (left + width - startX),
      (endY < startY) ? (startY - top) : (top + height - startY),
    );
    endX = startX + (startX < endX ? d : -d);
    endY = startY + (startY < endY ? d : -d);
    return [endX, endY];
  }

  public drawRect(ev: MEvent, align = false) {
    const { area, startX, startY } = this;
    const [left, top] = area;
    const [endX, endY] = align
      ? this.alignEndToStart(ev.clientX, ev.clientY)
      : limitPointInRect(area, ev.clientX, ev.clientY);
    const rect = calcCursorRect(startX, startY, endX, endY);
    return offsetRect(rect, -left, -top);
  }

  public position(ev: MEvent): Point {
    const [x, y] = limitPointInRect(this.area, ev.clientX, ev.clientY);
    const [left, top] = this.area;
    return [x - left, y - top];
  }

  public offset(ev: MEvent): Point {
    const { startX, startY, area } = this;
    const [x, y] = limitPointInRect(area, ev.clientX, ev.clientY);
    return [x - startX, y - startY];
  }

  public moveRect(ev: MEvent, rect: Rect) {
    const { startX, startY, area } = this;
    const [,, w, h] = area;
    const [dx, dy] = [ev.clientX - startX, ev.clientY - startY];
    return limitRectOverflow(w, h, offsetRect(rect, dx, dy));
  }

  public moveArrow(ev: MEvent, from: Point, to: Point): [Point, Point] {
    const { startX, startY, area } = this;
    const [,, w, h] = area;
    const [dx, dy] = [ev.clientX - startX, ev.clientY - startY];
    const [fx, tx] = LimitBothOverflow(w, from[0] + dx, to[0] + dx);
    const [fy, ty] = LimitBothOverflow(h, from[1] + dy, to[1] + dy);
    return [[fx, fy], [tx, ty]];
  }
}


