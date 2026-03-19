import React, { memo } from 'react';
import { SquareTool, ArrowTool, EllipseTool, PencilTool, TextTool, MosaicTool, PresetTool } from './tools';
import { ShapeConfigMap, ChangeToolOptions } from './common';
import { activeShapeAtom, activeToolAtom, shapesAtom } from '../../state';
import { define } from '../../context';

const changeToolMut = define.memoize((use) => {
  return (options: ChangeToolOptions) => {
    const { config, blurShape, applyShape } = options;
    const [activeShape, setActiveShape] = use(activeShapeAtom);
    const setActiveTool = use(activeToolAtom)[1];

    setActiveTool(config);
    if (!activeShape) return;
    const { changeByConfig } = use(shapesAtom)[1];
    if (config && applyShape) changeByConfig(activeShape.id, config);
    if (blurShape) setActiveShape(null);
  };
});

function PainterTools() {
  const config = activeToolAtom.useData();
  const onChangeTool = changeToolMut.use();
  const map: Partial<ShapeConfigMap> = config ? { [config.type]: config } : {};

  return (
    <>
      <SquareTool
        config={map['square']}
        onChangeTool={onChangeTool}
      />
      <EllipseTool
        config={map['ellipse']}
        onChangeTool={onChangeTool}
      />
      <ArrowTool
        config={map['arrow']}
        onChangeTool={onChangeTool}
      />
      <PencilTool
        config={map['pencil']}
        onChangeTool={onChangeTool}
      />
      <MosaicTool
        config={map['mosaic']}
        onChangeTool={onChangeTool}
      />
      <TextTool
        config={map['text']}
        onChangeTool={onChangeTool}
      />
      <PresetTool
        config={map['preset']}
        onToolChange={onChangeTool}
      />
    </>
  );
}

export default memo(PainterTools);
