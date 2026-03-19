import React, { PureComponent, useRef, useEffect, CSSProperties, createRef } from 'react';
import { Point, Rect } from '../../type';
import { handleDrag } from '../../common/utils/drag';
import { measureWidth } from '../../common/utils/dom';
import globalKey from '../../common/utils/global-key';
import { TextModel, uuid } from '../model';
import { DragLimiter, type MEvent } from '../../common/drag-limiter';
import { editorTextAtom } from '../../state';
import { StrokeEvent, CapturedHooks } from '../../common/keyboard-painter';

const stopEvent = (e: React.PointerEvent) => e.stopPropagation();
const TextStyleClass = uuid();
// These style must be inlined into svg
export const ShapeTextStyle = `.${TextStyleClass} {
  display: inline-block;
  outline: none;
  border: 1px solid transparent;
  margin: 0;
  font-weight: 600;
  padding: 2px;
  overflow: hidden;
  word-break: break-all;
  word-wrap: break-word;
  max-height: 100%;
  overflow: auto;
}
.${TextStyleClass}::-webkit-scrollbar {
  display: none;
}
`;


function Inputer(props: {
  id: string;
  width: number;
  color: string;
  fontSize: number;
  defaultValue?: string;
  onEndEdit: (content: string, width: number) => void;
  onMounted?: (height: number) => void;
}) {
  const { id, width, color, fontSize, defaultValue = '', onEndEdit, onMounted } = props;
  const minWidth = Math.max(6, Math.min(width, 24));

  const ref = useRef<HTMLDivElement>(null);
  const actions = editorTextAtom.useCreation();
  useEffect(() => {
    const input = ref.current;
    if (!input) return undefined;
    input.innerText = defaultValue;
    setTimeout(() => {
      input.focus();
      input.scrollTop = input.scrollHeight;
      const selection = window.getSelection();
      selection?.selectAllChildren(input);
      selection?.collapseToEnd();
    });
    return globalKey.on(e => e.stopPropagation(), 20);
  }, []);

  // Adjust the position of the input during the first rendering to avoid appearing outside the painting.
  useEffect(() => {
    const input = ref.current;
    if (!input || !onMounted) return;
    onMounted(input.offsetHeight);
  }, [ref.current]);

  return (
    <div
      contentEditable={'plaintext-only' as any}
      className={TextStyleClass}
      ref={ref}
      style={{ borderColor: '#0078D7', color, fontSize, minWidth }}
      onBlur={({ currentTarget: el }) => {
        onEndEdit(el.innerText, measureWidth(el));
        actions.markEditing(null);
      }}
      onFocus={() => actions.markEditing(id)}
      onKeyDown={({ key, currentTarget }) => {
        if (key === 'Escape') currentTarget.blur();
      }}
    />
  );
}

interface PaintState {
  color: string;
  fontSize: number;
  position?: Point;
  areaWidth: number;
  areaHeight: number;
}
interface PaintProps {
  area: Rect;
  addText: (text: TextModel) => void;
}
class TextPainter extends PureComponent<PaintProps, PaintState> {
  public state: PaintState = {
    color: 'red',
    fontSize: 14,
    areaWidth: 100,
    areaHeight: 100,
  };
  private contrainerRef = createRef<HTMLDivElement>();
  private commit?: (pos: Point, content: string, width: number) => void;

  private startInput(color: string, fontSize: number, left: number, top: number) {
    const [x, y, areaWidth, areaHeight] = this.props.area;
    const position: Point = [left - x, top - y];
    this.setState({ color, fontSize, position, areaWidth, areaHeight });
    this.commit = (position, content, width) => {
      this.props.addText({ type: 'text', id: uuid(), color, fontSize, position, content, width });
    };
  }

  /**
   * try to start drawing by mouse down
   */
  public start(color: string, fontSize: number, ev: MEvent) {
    this.startInput(color, fontSize, ev.clientX, ev.clientY);
  }

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, color: string, fontSize: number): CapturedHooks | void {
    if (ev.keys.enter || ev.keys.space) {
      return {
        keymove: () => {},
        keyup: ([ex, ey]) => this.startInput(color, fontSize, ex, ey),
      };
    }
  }

  private onEndEdit = (content: string, width: number) => {
    const { position } = this.state;
    this.setState({ position: undefined });
    if (content && position && this.commit) {
      this.commit(position, content, width);
    }
    delete this.commit;
  };

  public onMounted = (height: number) => {
    let { position, areaHeight } = this.state;
    if (!position) return;
    const [left, top] = position;
    if(top + height > areaHeight) {
      const newPosition: Point = [left, areaHeight - height];
      this.setState({ position: newPosition });
    } else {
      const height = areaHeight - top;
      if (this.contrainerRef.current) {
        this.contrainerRef.current.style.height = height + 'px';
      }
    }
  }

  render() {
    const { color, fontSize, position, areaWidth } = this.state;
    if (!position) return null;
    const [left, top] = position;
    const width = areaWidth - left;
    const attrs = { width, color, fontSize };
    const boxStyle: CSSProperties = { position: 'absolute', left, top, width };
    return (
      <div style={boxStyle} ref={this.contrainerRef} onPointerDown={stopEvent}>
        <Inputer id="unkown" {...attrs} onEndEdit={this.onEndEdit} onMounted={this.onMounted}/>
      </div>
    );
  }
}


interface Props {
  area: Rect;
  model: TextModel;
  onChange: (model: TextModel) => void;
  onActive: (id: string) => ((editing: boolean) => void);
  active: boolean;
}
interface State {
  editingPos?: Point;
  editingText?: boolean;
}

class TextShape extends PureComponent<Props, State> {
  public state: State = {};
  private markeEditing?: (flag: boolean) => void;

  private activate() {
    const { model, onActive, active } = this.props;
    if (active) return;
    this.markeEditing = onActive(model.id);
  }

  private onPointerDown =(ev: React.PointerEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    const { editingPos } = this.state;
    const { model, onChange, area } = this.props;

    const limiter = new DragLimiter(area, ev);
    const { width, height } = ev.currentTarget.getBoundingClientRect();
    const [x, y] = editingPos || model.position;
    this.activate();
    handleDrag({
      onMove: (e: PointerEvent) => {
        const rect = limiter.moveRect(e, [x, y, width, height]);
        this.setState({ editingPos: [rect[0], rect[1]] });
      },
      onceMoved: this.markeEditing,
      onEnd: () => {
        const { editingPos: position } = this.state;
        if (!position) return;
        this.setState({ editingPos: undefined });
        onChange({ ...model, position });
      },
    });
  };

  private onDoubleClick = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    this.setState({ editingText: true });
    this.markeEditing?.(true);
  };

  private onEndEdit = (content: string, width: number) => {
    this.setState({ editingText: false });
    const { model, onChange } = this.props;
    if (content !== model.content || width !== model.width) {
      onChange({ ...model, content, width });
    }
  };

  private renderText(width: number) {
    const { editingText } = this.state;
    const { model, active } = this.props;
    const { color, fontSize, content, id } = model;

    if (editingText) {
      const { onEndEdit } = this;
      const attrs = { id, onEndEdit, width, fontSize, color };
      return (
        <div onPointerDown={stopEvent} style={{ pointerEvents: 'auto',height: '100%'}}>
          <Inputer {...attrs} defaultValue={content} />
        </div>
      );
    }

    const style: CSSProperties = {
      color,
      fontSize,
      borderColor: active ? '#0078D7' : undefined,
      cursor: 'move',
      whiteSpace: 'pre-wrap',
      userSelect: 'none',
      pointerEvents: 'auto',
      width: model.width,
      overflow: 'hidden',
    };

    // !important: this is used for dom query when font size changed
    const guid = `shape-text-${id}`;
    return (
      <div
        id={guid}
        onPointerDown={this.onPointerDown}
        onDoubleClick={this.onDoubleClick}
        className={TextStyleClass}
        style={style}
      >
        {content}
      </div>
    );
  }

  render() {
    const { editingPos } = this.state;
    const { model, area } = this.props;
    const [, , areaWidth, areaHeight] = area;
    const [x, y] = editingPos || model.position;
    const width = areaWidth - x;
    return (
      <foreignObject x={x} y={y} width={width} height={areaHeight - y} style={{ pointerEvents: 'none' }}>
        {this.renderText(width)}
      </foreignObject>
    );
  }
}

export {
  TextPainter,
  TextShape,
};
