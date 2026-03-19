import React, { useCallback } from 'react';

import { PresetPainter, PresetShape, NumberTextStyle } from './presets';
import { ArrowPainter, ArrowShape } from './arrow';
import { TextPainter, TextShape, ShapeTextStyle } from './text';
import { EllipsePainter, EllipseShape } from './ellipse';
import { FreeCurvePainter, FreeCurveShape } from './free-curve';
import MosaicLayer from './mosaic';
import { SquarePainter, SquareShape } from './square';
import { Rect } from '../../type';
import { LayerModel } from '../model';
import { activeShapeAtom, activeToolAtom, shapesAtom } from '../../state';
import { getConfigOfShape } from '../toolbar';

export {
  PresetPainter, PresetShape,
  ArrowPainter, ArrowShape,
  TextPainter, TextShape, ShapeTextStyle,
  EllipsePainter, EllipseShape,
  FreeCurvePainter, FreeCurveShape,
  MosaicLayer,
  SquarePainter, SquareShape, NumberTextStyle,
};

export function createPainters() {
  return {
    square: React.createRef<SquarePainter>(),
    ellipse: React.createRef<EllipsePainter>(),
    arrow: React.createRef<ArrowPainter>(),
    pencil: React.createRef<FreeCurvePainter>(),
    mosaic: React.createRef<MosaicLayer>(),
    text: React.createRef<TextPainter>(),
    preset: React.createRef<PresetPainter>(),
  };
}

export type Painters = ReturnType<typeof createPainters>;

export function ShapeLayers(props: {
  area: Rect;
  layers: string[];
  elements: { [key: string]: LayerModel };
}) {
  const { area, layers, elements } = props;

  const [activeShape, setActiveShape] = activeShapeAtom.use();
  const setTool = activeToolAtom.useCreation();
  const { updateLayer, getLayer } = shapesAtom.useCreation();

  const onActive = useCallback((id: string) => {
    const shape = getLayer(id);
    const tl = getConfigOfShape(shape);
    setActiveShape({ id });
    setTool(tl || null);
    return (editing: boolean) => {
      setActiveShape({ id, editing });
    };
  }, []);

  const list = layers.map((id) => {
    const element = elements[id];
    const active = id === activeShape?.id;
    const attrs = { area, active, onChange: updateLayer, onActive };
    switch (element.type) {
      case 'square':
        return <SquareShape key={id} model={element} {...attrs} />;
      case 'ellipse':
        return <EllipseShape key={id} model={element} {...attrs} />;
      case 'arrow':
        return <ArrowShape key={id} model={element} {...attrs} />;
      case 'freeCurve':
        return <FreeCurveShape key={id} model={element} {...attrs} />;
      case 'text':
        return <TextShape key={id} model={element} {...attrs} />;
      case 'preset':
        return <PresetShape key={id} model={element} {...attrs} />;
      default:
        return null;
    }
  });
  return <>{list}</>
}
