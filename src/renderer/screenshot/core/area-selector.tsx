import React, { PureComponent, useMemo, CSSProperties } from 'react';
import Magnifying from './magnifying';
import { FrameBox, optimizeFrames } from './frame';
import { EditArea, Point, Rect } from './type';
import { handleDrag } from './common/utils/drag';
import { calcCursorRect, limitPointInRect } from './common/utils/coord';
import { BackgroundImage } from './common/utils/bg';
import { initialAtom, roundArea } from './state';
import { CrossCursor } from './common/cursor';
import { keyboardPainter } from './common/keyboard-painter';
import { waitWinSize } from './common/utils/dom';
import { SEditorBox, SEditorBoxMask } from './editor';

type OnSelectArea = (area: EditArea) => void;

/**
 * component for render detected windows
 */
function Frames(props: { onSeleted: OnSelectArea }) {
  const { bg, frames: rawFrames } = initialAtom.useData();
  const frames = useMemo(() => optimizeFrames(rawFrames), [rawFrames]);
  return (
    <>
      {frames.map((data) => (
        <FrameBox key={data.id} onSelect={props.onSeleted} data={data} bgCss={bg.css} />
      )).reverse()}
    </>
  );
}

interface Props {
  bg: BackgroundImage;
  onSeleted: OnSelectArea;
  hideFRE: VoidFunction;
  enableFrames?: boolean;
}
interface State {
  input?: 'mouse' | 'keyboard';
  start: Point;
  end: Point;
}

const PageCenter: Point = [window.innerWidth / 2, window.innerHeight / 2];
const DefaultState: State = { input: undefined, start: PageCenter, end: PageCenter };
waitWinSize((w, h) => {
  PageCenter[0] = w / 2;
  PageCenter[1] = h / 2;
});

function isSamePoint(a: Point, b: Point) {
  return a[0] === b[0] && a[1] === b[1];
}

export class AreaSelector extends PureComponent<Props, State> {
  public state: State = DefaultState;

  componentDidMount() {
    keyboardPainter.setCursor(<CrossCursor size={14}/>)
      .trackKeydown(({ point: start, keys }) => {
        if (!keys.shift) return;
        this.setState({ input: 'keyboard', start, end: start });
        return {
          keymove: (end) => this.setState({ input: 'keyboard', end }),
          keyup: () => this.commit(),
          cancel: () => this.setState(DefaultState),
        };
      })
      .trackCursor((visible) => {
        if (visible) {
          this.props.hideFRE();
          if (this.state.input === 'keyboard') return;
          this.setState({ input: 'keyboard', start: PageCenter, end: PageCenter });
        } else {
          this.setState(DefaultState);
        }
      })
      .turnOn();
  }

  componentWillUnmount() {
    keyboardPainter.turnOff();
  }

  private commit() {
    const { input, start, end } = this.state;
    if (input === undefined) return;
    const area = calcCursorRect(start[0], start[1], end[0], end[1]);
    if (area[2] === 0 || area[3] === 0) {
      this.setState(DefaultState);
    } else {
      this.props.onSeleted(area);
    }
  }

  public start(ev: React.PointerEvent) {
    const start: Point = [ev.clientX, ev.clientY];
    const limit: Rect = [0, 0, window.innerWidth, window.innerHeight];
    /**
     * this is use for fixing mouse event bug on windows:
     * - when the window is inactive mousedown will also trigger mousemove
     * - for mac mousedown won't trigger on inactive window
     */
    let neverMoved = true;
    handleDrag({
      onMove: (e) => {
        /**
         * !Note: move cursor when mouse down
         * Even if the cursor is out of the window, the mousemove event will still be triggered
         */
        const end = limitPointInRect(limit, e.clientX, e.clientY);
        if (neverMoved) {
          if (isSamePoint(start, end)) return;
          neverMoved = false;
        }
        this.setState({ input: 'mouse', start, end });
      },
      onEnd: () => this.commit(),
    });
  }

  render() {
    const { input, start, end } = this.state;
    const { bg, onSeleted, enableFrames } = this.props;

    // Unified mask: always use SEditorBoxMask (outline-based).
    // When no selection, 0×0 at origin → outline covers entire screen.
    // During selection, outline covers everything outside the selected area.
    const hasInput = input !== undefined;
    const area = hasInput
      ? roundArea(calcCursorRect(start[0], start[1], end[0], end[1]))
      : [0, 0, 0, 0] as EditArea;
    const [left, top, width, height] = area;
    const maskStyle: CSSProperties = { left, top, width, height };

    return (
      <>
        <div style={maskStyle} className={SEditorBoxMask} />
        {!hasInput && enableFrames && <Frames onSeleted={onSeleted} />}
        {!hasInput && <Magnifying bg={bg} />}
        {hasInput && (width > 0 || height > 0) && (
          <>
            <div style={maskStyle} className={SEditorBox} />
            {input === 'mouse' && <Magnifying bg={bg} area={area} />}
          </>
        )}
      </>
    );
  }
}
