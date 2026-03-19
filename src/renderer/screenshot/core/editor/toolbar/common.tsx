import { LayerModel, PresetModel } from '../model';

export const COLORS: Array<[string, string?]> = [
  ['black'], ['#00D6E8'], ['#E61B1B'], ['#26E600'], ['#FFE600'], ['white', '#e6e6e6'],
];
export const COLORS_DESC: { [key: string]: string } = {
  'black': 'Black',
  '#00D6E8': 'Bright Cyan Blue',
  '#E61B1B': 'Red',
  '#26E600': 'Green',
  '#FFE600': 'Yellow',
  'white': 'White',
};

export interface SquareConfig {
  type: 'square';
  size: number;
  color: string;
}
export const DefaultSquareConfig: SquareConfig = { type: 'square', size: 4, color: COLORS[2][0] };
export interface EllipseConfig {
  type: 'ellipse';
  size: number;
  color: string;
}
export const DefaultEllipseConfig: EllipseConfig = { type: 'ellipse', size: 4, color: COLORS[2][0] };
export interface ArrowConfig {
  type: 'arrow';
  size: number;
  color: string;
}
export const DefaultArrowConfig: ArrowConfig = { type: 'arrow', size: 15, color: COLORS[2][0] };
export interface PencilConfig {
  type: 'pencil';
  size: number;
  color: string;
}
export const DefaultPencilConfig: PencilConfig = { type: 'pencil', size: 4, color: COLORS[2][0] };
export interface MosaicConfig {
  type: 'mosaic';
  size: number;
}
export const DefaultMosaicConfig: MosaicConfig = { type: 'mosaic', size: 24 };
export interface TextConfig {
  type: 'text';
  size: number;
  color: string;
}
export const DefaultTextConfig: TextConfig = { type: 'text', size: 30, color: COLORS[2][0] };
export interface PresetConfig {
  type: 'preset';
  content: PresetModel['content'];
}

export interface TextDetectorConfig {
  type: 'textDetector';
}

export type PainterConfig = SquareConfig | EllipseConfig | ArrowConfig | PencilConfig | MosaicConfig | TextConfig | PresetConfig;
export type PainterType = ShapeConfig['type'];
export type ShapeConfig = PainterConfig | TextDetectorConfig;
export type ShapeType = ShapeConfig['type'];
export type ShapeConfigMap = {
  square: SquareConfig;
  ellipse: EllipseConfig;
  arrow: ArrowConfig;
  pencil: PencilConfig;
  mosaic: MosaicConfig;
  text: TextConfig;
  textDetector: TextDetectorConfig;
  preset: PresetConfig;
}

export interface ChangeToolOptions {
  config: ShapeConfig | null;
  blurShape?: boolean;
  applyShape?: boolean;
}
export type ChangeToolMethod = (options: ChangeToolOptions) => void;

export const SizeRangeConfig = {
    square: { min: 2, max: 6 },
    ellipse: { min: 2, max: 6 },
    arrow: { min: 10, max: 20 },
    pencil: { min: 2, max: 6 },
    mosaic: { min: 12, max: 40 },
};

export function getConfigOfShape(shape?: LayerModel): ShapeConfig | undefined {
  if (!shape) return undefined;
  switch (shape.type) {
    case 'square':
      return { type: 'square', size: shape.strokeWidth, color: shape.stroke };
    case 'ellipse':
      return { type: 'ellipse', size: shape.strokeWidth, color: shape.stroke };
    case 'arrow':
      return { type: 'arrow', size: shape.size, color: shape.fill };
    case 'freeCurve':
      return { type: 'pencil', size: shape.strokeWidth, color: shape.stroke };
    case 'text':
      return { type: 'text', size: shape.fontSize, color: shape.color };
    case 'preset':
      return { type: 'preset', content: shape.content };
  }
}
