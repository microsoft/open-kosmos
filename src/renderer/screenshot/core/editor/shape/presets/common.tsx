import React from 'react';
import { Point, Rect } from '../../../type';
import { PresetEmoji, PresetModel, PresetOrder } from '../../model';
import { HandleChange } from '../shape-resizer';

export type PresetType = PresetModel['content']['type'];
export interface PresetContentMap {
  order: PresetOrder;
  emoji: PresetEmoji;
}

export interface PainterProps<K extends PresetType> {
  area: Rect;
  rect?: Rect;
  config: PresetContentMap[K];
  addPreset: (model: PresetModel) => void;
}

export interface Painter {
  createDefault: (at: Point) => void;
  finish: () => void;
}

export type TextSize = [w: number, h: number];

export enum TextSide {
  LEFT = 'left',
  RIGHT = 'right',
}
export interface OrderExtraParams {
  size: TextSize,
  side?: TextSide,
  text: string,
  callback: () => void,
}

export interface ShapeProps<K extends PresetType> {
  rect: Rect;
  content: PresetContentMap[K];
  onPointerDown: (ev: React.PointerEvent, orderParams?: OrderExtraParams) => void;
}

export interface OrderShapeProps extends ShapeProps<'order'> {
  area: Rect;
  model: PresetModel;
  active: boolean;
  dragging: boolean;
  markeEditing?: (flag: boolean) => void;
  onResizeStart: () => HandleChange;
  onChange: (model: PresetModel) => void;
}

export function Outline(props: { rect?: Rect }) {
  const { rect } = props;
  if (!rect) return null;
  const [x, y, w, h] = rect;
  return <rect x={x} y={y} width={w || 0.01} height={h || 0.01} fill="none" stroke="black" strokeWidth="1" />;
}
