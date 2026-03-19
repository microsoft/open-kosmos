import React, { PureComponent, createRef, useRef, useEffect, useState, forwardRef, RefObject, useImperativeHandle } from 'react';
import { Point, Rect } from '../../../type';
import { PainterProps, OrderShapeProps, TextSize, TextSide } from './common';
import { uuid, PresetOrder } from '../../model';
import { Number } from './assets';
import { NumberColor } from '../../toolbar/tools/preset/list';
import { editorTextAtom } from '../../../state';
import globalKey from '../../../common/utils/global-key';
import Resizer from '../shape-resizer';
import cloneDeep from 'lodash/cloneDeep';
import { measureDomRect } from '../../../common/utils/dom';

function Graph(props: {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  onPointerDown?: (ev: React.PointerEvent) => void;
}) {
  const { index, fill, onPointerDown, ...attrs } = props;
  const coord = { ...attrs, cursor: 'move' };
  return React.createElement(Number,
    // @ts-ignore
    { index, fill: NumberColor[fill], coord: coord, onPointerDown });
}

const stopEvent = (e: KeyboardEvent) => e.stopPropagation();
const TextStyleClass = uuid();
const textDefaultWidth = 24;
const textDefaultHeight = 24;
export const arrowSize = 10;
// These style must be inlined into svg
export const NumberTextStyle = `.${TextStyleClass} {
  display: inline-block;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  outline: none;
  margin: 0;
  font-weight: 600;
  padding: 0 10px;
  word-break: break-all;
  word-wrap: break-word;
  max-height: 100%;
  overflow: auto;
  max-width: 100%;
  max-height: 100%;
  pointer-events: auto;
  white-space: pre-wrap;
  line-height: ${textDefaultHeight}px;
}
.${TextStyleClass}::-webkit-scrollbar {
  display: none;
}
  .inputer {
    display: flex;
    align-items: flex-start;
    width: 100%;
    height: 100%;
  }
  .arrow {
    border-width: ${arrowSize / 2}px;
    border-style: solid;
  }
  .arrow.right{
    border-color: transparent rgba(0, 0, 0, 0.5) transparent transparent;
  }
  .arrow.left{
    border-color: transparent  transparent transparent rgba(0, 0, 0, 0.5);
  }
`;

interface InputerRef {
  element: RefObject<HTMLDivElement | null>;
}
interface InputerProps {
  id: string;
  minWidth: number;
  minHeight: number;
  active: boolean;
  rightSide: boolean;
  dragging: boolean;
  graphHeight?: number;
  zoom: number;
  onEndEdit: (content: string) => void;
  onPointerDown?: (ev: React.PointerEvent) => void;
  value?: string;
};

const Inputer = forwardRef<InputerRef, InputerProps>((props, ref ) => {
  const { id, minWidth, minHeight, rightSide, active, dragging, graphHeight, zoom, onEndEdit, onPointerDown, value } = props;

  const element = useRef<HTMLDivElement>(null);
  const actions = editorTextAtom.useCreation();
  const [editingText, setEditingText] = useState(true);
  const [marginTop, setMarginTop] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const input = element.current!;
    setTimeout(() => {
      input.focus();
    });
  }, []);

  useEffect(() => {
    if (editingText || value === undefined) return;
    const input = element.current!;
    input.innerText = value;
  }, [value, editingText]);


  useEffect(() => {
    let textHeight = element?.current?.clientHeight;
    let marginTop = 0;
    if (textHeight && graphHeight && textHeight < graphHeight) {
      marginTop = (graphHeight - textHeight) / 2;
    }
    setMarginTop(marginTop);
  }, [graphHeight]);

  useImperativeHandle(ref, () => ({
    element,
  }), []);

  const textStyle = {
    minWidth,
    minHeight,
    width:  editingText ? 'auto' : width + 'px',
    cursor: active && !dragging ? 'text' : 'move',
    marginTop,
    fontSize: Math.max(14 * zoom, 10) + 'px',
    lineHeight: Math.max(14 * zoom, 10) + 10 + 'px',
  };

  return (
    <div
      className='inputer'
      style={{flexDirection: rightSide ? 'row' : 'row-reverse', }}
      onDoubleClick={(e) => {e.stopPropagation();}} >
      <div className={'arrow ' + (rightSide ? 'right' : 'left')} style={{marginTop: Math.max(((graphHeight || 0) - arrowSize)/ 2, 2)}}></div>
      <div
        contentEditable={editingText ? 'plaintext-only' as any : false}
        className={TextStyleClass}
        ref={element}
        style={textStyle}
        onBlur={({ currentTarget: el }) => {
          setEditingText(false);
          if (element.current) {
            const size = measureDomRect(element.current);
            setWidth(size[0]);
          }
          onEndEdit(el.innerText);
          actions.markEditing(null);
          el.scrollTop = 0;
          globalKey.off(stopEvent);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (active) {
            setEditingText(true);
          }else {
            onPointerDown?.(e);
          }
        }}
        onDragStart={e => e.preventDefault()}
        onFocus={({ currentTarget: el }) => {
          globalKey.on(stopEvent, 20);
          actions.markEditing(id);
          el.scrollTop = el.scrollHeight;
          const selection = window.getSelection();
          selection?.selectAllChildren(el);
          selection?.collapseToEnd();
        }}
        onKeyDown={({ key, currentTarget }) => {
          if (key === 'Escape') currentTarget.blur();
        }}>
      </div>
    </div>
  );
});

const DefaultIndex: number = 1;
const DefaultSize: number = 20;
export class OrderPainter extends PureComponent<PainterProps<'order'>> {
  private index = DefaultIndex;
  private size = DefaultSize;

  public createDefault(at: Point) {
    const { area, config, addPreset } = this.props;
    const { size } = this;
    const half = size / 2;
    const [ , , w, h ] = area;
    let [ x, y ] = at;
    x = Math.max(half, Math.min(x, w - half));
    y = Math.max(half, Math.min(y, h - half));
    const id = uuid();
    addPreset({
      id,
      type: 'preset',
      rect: [x - half, y - half, size, size],
      content: { ...config, index: this.index++, text: '' },
    });
  }

  public finish() {
    const { rect, config, addPreset } = this.props;
    if (!rect) return;
    const [x, y, w, h] = rect;
    this.size = Math.max(Math.min(w, h), DefaultSize);
    const id = uuid();
    addPreset({
      id,
      type: 'preset',
      rect: [x, y, this.size, this.size],
      content: { ...config, index: this.index++, text: '' },
    });
  }

  componentDidUpdate(prevProps: Readonly<PainterProps<'order'>>) {
    if(prevProps.config.style !== this.props.config.style) {
      this.setDefault();
    }
  }

  private setDefault() {
    this.index = DefaultIndex;
    this.size = DefaultSize;
  }

  public render() {
    const { rect, config } = this.props;
    if (!rect) return null;
    const [x, y, w, h] = rect;
    const size = Math.min(w, h);
    return (
      <Graph x={x} y={y} width={size} height={size} index={this.index} fill={config.style} />
    );
  }
}
interface State {
  textDisplay: boolean;
}

export class OrderShape extends PureComponent<OrderShapeProps> {
  public state: State = {
    textDisplay: true,
  };
  private initialRect: Rect | undefined = undefined;
  private textSide: TextSide | undefined = undefined;
  private text = createRef<InputerRef>();

  private onEndEdit = (content: string) => {
    const model  = cloneDeep(this.props.model);
    (model.content as PresetOrder).text = content;
    if (!content) {
      this.setState({
        textDisplay: false
      })
    };
    this.props.onChange(model);
  };

  private handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const { onPointerDown } = this.props;
    const text = this.text.current;
    let size: TextSize = [0, 0];
    if (text && text.element.current) {
      const [tW, tH] = measureDomRect(text.element.current);
      size = [tW + arrowSize, tH];
    }
    onPointerDown?.(e,
      {
        size,
        side: this.textSide,
        text: text?.element.current?.innerText || '',
        callback: () => {
          if (!this.state.textDisplay) {
            this.setState({
              textDisplay: true
            });
          }
        }
    });
  };

  private calcSpace = () => {
    const { rect, area } = this.props;
    const [, , areaWidth, areaHeight] = area;
    const [x, y, w, h] = rect;
    const rightWidth = areaWidth - x - w;
    const leftPoi = [0, y, x, areaHeight - y];
    const rightPoi = [x + w , y, rightWidth, areaHeight - y];
    if(this.textSide && this.text.current?.element.current?.innerText) {
      return this.textSide === TextSide.RIGHT ? rightPoi : leftPoi;
    } else {
      if ((rightWidth >= textDefaultWidth || (x <= textDefaultWidth && x <= rightWidth))) {
        this.textSide = TextSide.RIGHT;
        return rightPoi;
      }
      this.textSide = TextSide.LEFT;
      return leftPoi;
    }
  }

  public render() {
    const { rect, area,content, model, dragging, active, onResizeStart } = this.props;
    const { textDisplay } = this.state;
    const [x, y, w, h] = rect;
    const [pX, pY, pW, pH] = this.calcSpace();
    const graph = <Graph x={x} y={y} width={w} height={h} index={content.index} fill={content.style} onPointerDown={this.handlePointerDown}/>;

    if(!this.initialRect) {
      this.initialRect = rect;
    }
    const zoom =  this.initialRect && rect ?  Math.round(rect[2] / this.initialRect[2] * 10 ) / 10 : 1;
    return (
      <>
        {
          active ? (
            <Resizer limit={area} rect={rect} onChangeStart={onResizeStart} aspectRatio={model.content.aspectRatio}>
              {graph}
            </Resizer>
          ) :
          graph
        }
        {textDisplay && (
            <foreignObject x={pX} y={pY} width={pW} height={pH} style={{pointerEvents: 'none'}}>
              <Inputer
                id={uuid()}
                value={content.text}
                ref={this.text}
                minWidth={Math.min(pW, textDefaultWidth)}
                minHeight={Math.min(pH, textDefaultHeight)}
                rightSide={pX >= x}
                graphHeight={h}
                active={active}
                dragging={dragging}
                zoom={zoom}
                onPointerDown={this.handlePointerDown}
                onEndEdit={this.onEndEdit}  />
            </foreignObject>
          )
        }
      </>
    )
  }
}
