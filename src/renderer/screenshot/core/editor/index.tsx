import React, { CSSProperties, createRef, memo, useCallback, useEffect, useRef } from 'react';
import Resizer from './area-resizer';
import Magnifying from '../magnifying';
import { MainToolbar } from './toolbar';
import MosaicLayer from './shape/mosaic';
import cursor from '../common/cursor';
import { BackgroundImage } from '../common/utils/bg';
import Measure from './measure';
import globalKey from '../common/utils/global-key';
import { activeToolAtom, editorTextAtom, areaAtom, activeShapeAtom, shapesAtom, state_handlers, editor_handlers } from '../state';
import { isPainterConfig, startDrawByKeyboard, startDrawByMouse, updateCursorForKeyboard } from './painter';
import { keyboardPainter } from '../common/keyboard-painter';
import {
  createPainters, ShapeLayers, SquarePainter, EllipsePainter, ArrowPainter, FreeCurvePainter,
  TextPainter, ShapeTextStyle, PresetPainter, NumberTextStyle,
} from './shape';
import { css } from '../common/styled';
import { message } from '../components/message';


export const SEditorBox = css`
  position: absolute;
  outline: 1px dashed white;
  background-attachment: fixed;
  background-repeat: no-repeat;
  &:focus-visible {
  /* outline: 2px dashed var(--main-color); */
    outline: 2px dashed white;
  }
`;
export const SEditorBoxMask = css`
  position: absolute;
  pointer-events: none;
  outline: var(--huge-size) solid var(--mask-color);
`;


interface Props {
  bg: BackgroundImage;
}

function createRefData() {
  const svg = createRef<SVGSVGElement>();
  const painter = createPainters();
  return { svg, painter };
}

function useSelf() {
  const r = useRef<ReturnType<typeof createRefData> | null>(null);
  return r.current || (r.current = createRefData());
}

export function Editor({ bg }: Props) {
  const [area, areaActions] = areaAtom.use();
  const [activeShape, setActiveShape] = activeShapeAtom.use();
  const { isEmpty } = shapesAtom.useCreation();
  const activeTool = activeToolAtom.useData();
  const { editingId } = editorTextAtom.useData();

  const { handleKey, quit, resetAll, sendToMain } = state_handlers.use();
  const { register_elements, copy } = editor_handlers.use();

  const self = useSelf();
  useEffect(() => globalKey.on(handleKey, 10), []);
  useEffect(() => {
    const { svg, painter: { mosaic } } = self;
    return register_elements(svg.current!, mosaic.current!.canvas);
  });

  const onCopy = useCallback(async () => {
    const blob = await copy();
    await Promise.all([
      sendToMain(isEmpty() ? null : blob),
      message({ text: 'Added to clipboard', duration: 1000, modal: true }),
      resetAll(),
    ]);
    quit();
  }, [isEmpty]);

  function onStart(ev: React.PointerEvent) {
    ev.stopPropagation();
    if (editingId) return;
    if (activeShape) setActiveShape(null);

    if (isPainterConfig(activeTool)) {
      startDrawByMouse(self.painter, activeTool, ev);
    } else if (isEmpty()) {
      areaActions.startMove(ev);
    }
  };

  function getEditorAreaProps(): React.HTMLAttributes<HTMLDivElement> {
    if (!isPainterConfig(activeTool)) return {};
    return {
      // for screen reader
      'aria-label': 'canvas focused',
      // when painter tool is active, make the editor area focusable
      tabIndex: 0,
      // when it's focused, start listening to keyboard events and handle drawing
      onFocus: () => {
        updateCursorForKeyboard(activeTool)
          .trackKeydown((e) => startDrawByKeyboard(self.painter, activeTool, e))
          .setLimit(area.rect)
          .turnOn();
      },
      // when it loses focus, stop listening
      onBlur: () => keyboardPainter.turnOff(),
    }
  }

  function getCursor() {
    const tool = activeTool
    if (area.editing === 'move') return 'move';
    if (area.editing === 'resize') return undefined;
    if (activeShape && activeShape.editing) return undefined;
    if (tool) {
      switch (tool.type) {
        case 'text':
          return 'text';
        case 'pencil':
          return cursor.pencil(tool.color);
        case 'mosaic':
          return cursor.mosaic(tool.size);
        case 'square':
        case 'arrow':
        case 'ellipse':
        case 'preset':
          return 'crosshair';
        default:
          return 'move';
      }
    }
    if (isEmpty()) return 'move';
    return undefined;
  }

  const [x, y, w, h] = area.rect;
  const style: CSSProperties = { left: x, top: y, height: h, width: w };
  const editorStyle = { cursor: getCursor(), ...bg.css, ...style };

  return (
    <>
      <div className={SEditorBoxMask} style={style} />
      <div className={SEditorBox} style={editorStyle} onPointerDown={onStart} {...getEditorAreaProps()}>
        {area.editing !== 'resize' && <Measure area={area.rect} />}
        <EditorCore painter={self.painter} svgRef={self.svg} bg={bg} />
      </div>
      {area.editing === 'resize' && <Magnifying bg={bg} area={area.rect} />}
      {!area.editing && <MainToolbar area={area.rect} onCopy={onCopy} />}
    </>
  );
}

function Core(props: {
  bg: BackgroundImage;
  painter: ReturnType<typeof createPainters>;
  svgRef: React.RefObject<SVGSVGElement>;
}) {
  const { painter, svgRef, bg } = props;
  const [{ rect, editing }, { startResize, reduceRect }] = areaAtom.use();
  const [{ elements, layers, mosaic }, actions] = shapesAtom.use();

  const { addSquare, addEllipse, addArrow, addFreeCurve, addPreset, addText, isEmpty } = actions;

  return (
    <>
      <MosaicLayer
        ref={painter.mosaic}
        area={rect}
        bg={bg}
        model={mosaic}
        onChange={actions.changeMosaic}
      />
      <svg
        width="100%"
        height="100%"
        ref={svgRef}
        style={{ position: 'absolute' }}
      >
        <style>{ShapeTextStyle}</style>
        <style>{NumberTextStyle}</style>
        <ShapeLayers area={rect} layers={layers} elements={elements} />
        <SquarePainter ref={painter.square} area={rect} addSquare={addSquare} />
        <EllipsePainter ref={painter.ellipse} area={rect} addEllipse={addEllipse} />
        <ArrowPainter ref={painter.arrow} area={rect} addArrow={addArrow} />
        <FreeCurvePainter ref={painter.pencil} area={rect} addFreeCurve={addFreeCurve} />
        <PresetPainter ref={painter.preset} area={rect} addPreset={addPreset} />
      </svg>
      <TextPainter ref={painter.text} area={rect} addText={addText} />
      {isEmpty() && !editing && (
        <Resizer size={8} onChangeStart={startResize} onReduce={reduceRect} />
      )}
    </>
  );
}

const EditorCore = memo(Core);
