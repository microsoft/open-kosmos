import { Rect, Point } from '../type';

export interface SquareModel {
  type: 'square';
  id: string;
  stroke: string;
  strokeWidth: number;
  rect: Rect;
}

export interface EllipseModel {
  type: 'ellipse';
  id: string;
  stroke: string;
  strokeWidth: number;
  rect: Rect;
}

export interface ArrowModel {
  type: 'arrow';
  id: string;
  fill: string;
  size: number;
  from: Point,
  to: Point,
}

export interface FreeCurveModel {
  type: 'freeCurve';
  id: string;
  stroke: string;
  strokeWidth: number;
  d: string;
  offset: [number, number];
}

export type MosaicModel = Array<{ d: string; size: number }>;

export interface TextModel {
  type: 'text';
  id: string;
  color: string;
  fontSize: number;
  position: Point;
  content: string;
  width: number;
}

export interface PresetOrder {
  type: 'order';
  index: number;
  style: string;
  aspectRatio?: number;
  text?: string;
}
export interface PresetEmoji {
  type: 'emoji';
  emoji: 'heart' | 'flag' | 'pushpin' | 'roundPushpin';
  aspectRatio?: number;
}

export interface PresetModel {
  type: 'preset';
  id: string;
  rect: Rect;
  content: PresetOrder | PresetEmoji;
}

export type LayerModel = SquareModel | EllipseModel | ArrowModel | FreeCurveModel | TextModel | PresetModel;
export interface ModelData {
  layers: string[];
  elements: {
    [id: string]: LayerModel;
  };
  mosaic?: MosaicModel;
}

export const uuid = () => Math.ceil((Math.random() + 0.5) * Date.now()).toString(36);
