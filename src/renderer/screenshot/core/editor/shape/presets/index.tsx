import React, { PureComponent } from 'react';
import { Rect } from '../../../type';
import { handleDrag } from '../../../common/utils/drag';
import { calcCursorRect, offsetRect } from '../../../common/utils/coord';
import { keydown } from '../../../common/utils/global-key';
import { PresetModel } from '../../model';
import Resizer from '../shape-resizer';
import { DragLimiter, type MEvent } from '../../../common/drag-limiter';
import { StrokeEvent, CapturedHooks } from '../../../common/keyboard-painter';
import { Painter, OrderExtraParams, TextSide } from './common';
import { OrderPainter, OrderShape, NumberTextStyle, arrowSize } from './order';
import { EmojiPainter, EmojiShape } from './emoji';

export { NumberTextStyle };
type PainterConfig = PresetModel['content'];
interface PaintState {
  rect?: Rect;
  config?: PainterConfig;
}

interface PaintProps {
  area: Rect;
  addPreset: (model: PresetModel) => void;
}

function applyRatio(origin: Rect, rect: Rect, aspectRatio: number): Rect {
  const [startX, startY] = origin;
  let [x, y, w, h] = rect;
  const ratio = w / h;
  if (ratio > aspectRatio) {
    w = h * aspectRatio;
  } else {
    h = w / aspectRatio;
  }
  const nX = x >= startX ? startX : startX - w;
  const nY = y >= startY ? startY : startY - h;
  return [nX, nY, w, h];
}

export class PresetPainter extends PureComponent<PaintProps, PaintState> {
  public state: PaintState = {};
  private ref?: Painter;

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, config: PainterConfig): CapturedHooks | void {
    this.setState({ config });
    const { point: [sx, sy], keys } = ev;
    if (keys.enter || keys.space) {
      const [left, top] = this.props.area;
      const origin: Rect = [sx - left, sy - top, 0, 0];
      let moved = false;
      return {
        keymove: ([ex, ey]) => {
          moved = true;
          let rect =  calcCursorRect(sx - left, sy - top, ex - left, ey - top);
          if (config.aspectRatio) {
            rect = applyRatio(origin, rect, config.aspectRatio);
          }
          this.setState({ rect });
        },
        keyup: ([ex, ey]) => {
          if (moved) this.ref?.finish();
          else this.ref?.createDefault([ex - left, ey - top]);
          this.setState({ rect: undefined });
        },
        cancel: () => this.setState({ rect: undefined }),
      };
    }
  };

  /**
   * try to start drawing by mouse down
   */
  public start(ev: MEvent, config: PainterConfig) {
    this.setState({ config });
    const limiter = new DragLimiter(this.props.area, ev);
    const [left, top] = this.props.area;
    const origin: Rect = [ev.clientX - left, ev.clientY - top, 0, 0];
    handleDrag({
      onMove: (e) => {
        let rect = limiter.drawRect(e, keydown.has('Shift'));
        if (config.aspectRatio) {
          rect = applyRatio(origin, rect, config.aspectRatio);
        }
        this.setState({ rect });
      },
      onEnd: (e, { moved }) => {
        const [left, top] = this.props.area;
        if (moved) this.ref?.finish();
        else this.ref?.createDefault([e.clientX - left, e.clientY - top]);
        this.setState({ rect: undefined });
      },
    });
  }

  private getRef = (ref: Painter | null) => { if (ref) this.ref = ref; };
  private renderPainter(config: PainterConfig | undefined, rect: Rect | undefined) {
    if (!config) return null;
    const ref = this.getRef;
    const attr = { rect, ...this.props };
    if (config.type === 'order') {
      return <OrderPainter ref={ref} config={config} {...attr} />;
    } else if (config.type === 'emoji') {
      return <EmojiPainter ref={ref} config={config} {...attr} />;
    }
  }

  render() {
    const { rect, config } = this.state;
    const painter = this.renderPainter(config, rect);
    return painter && (
      <>
        {painter}
      </>
    );
  }
}


interface Props {
  area: Rect;
  model: PresetModel;
  onChange: (model: PresetModel) => void;
  onActive: (id: string) => ((editing: boolean) => void);
  active: boolean;
}
interface State {
  editing?: Rect;
}

export class PresetShape extends PureComponent<Props, State> {
  public state: State = {};
  private onceMoved?: (flag: boolean) => void;

  private activate = ()=> {
    const { model, onActive, active } = this.props;
    if (active) return;
    this.onceMoved = onActive(model.id);
  }

  private onPointerDown =(ev: React.PointerEvent, params?: OrderExtraParams) => {
    ev.stopPropagation();
    const { editing } = this.state;
    const { model, onChange, area } = this.props;
    const limiter = new DragLimiter(area, ev);
    const origin = editing || model.rect;
    const [oX, oY, oW, oH] = origin;
    this.activate();
    let width = oW ;
    let height = oH;
    const { size, side, text, callback } = params || {};
    const isOrderType = model.content.type === 'order';
    if(isOrderType && text && size) {
      const [w, h] = size;
      width  += w;
      height = Math.max(oH, h);
    }
    handleDrag({
      onMove: (event: PointerEvent) => {
        // use limiter.moveRect to restrict shape in area if needed
       if (isOrderType && side && side !== TextSide.RIGHT && size) {
          const [w,] = size;
          const rect = limiter.moveRect(event, [oX - w, oY, width , height]);
          this.setState({ editing: [rect[0] + w, rect[1], oW, oH] });
        }else {
          const rect = limiter.moveRect(event, [oX, oY, width , height]);
          this.setState({ editing: [rect[0], rect[1], oW, oH] });
        }
      },
      onceMoved: this.onceMoved,
      onEnd: () => {
        callback && callback();
        const rect = this.state.editing;
        if (!rect) return;
        this.setState({ editing: undefined });
        onChange({ ...model, rect });
      },
    })
  };

  private onResizeStart = () => {
    return {
      onceMoved: this.onceMoved,
      change: (editing: Rect) => this.setState({ editing }),
      endChange: (rect?: Rect) => {
        const { model, onChange } = this.props;
        if (rect) onChange({ ...model, rect });
        this.setState({ editing: undefined });
      },
    };
  };

  private renderShape(rect: Rect, content: PresetModel['content']) {
    if (!rect) return null;
    const { area, model, active, onChange } = this.props;
    const { editing } = this.state;
    const { onResizeStart} = this;
    const attr = { rect, onPointerDown: this.onPointerDown};
    if (content.type === 'order') {
      const orderAttr = { ...attr, area, active, model, dragging: !!editing, onResizeStart, onChange };
      return <OrderShape content={content} {...orderAttr} />;
    } else if (content.type === 'emoji') {
      return <EmojiShape content={content} {...attr} />;
    }
  }

  render() {
    const { editing } = this.state;
    const { model, area, active } = this.props;
    const rect = editing || model.rect;
    const shape = this.renderShape(rect, model.content);
    if (active && model.content.type!=='order') {
      return (
        <Resizer limit={area} rect={rect} onChangeStart={this.onResizeStart} aspectRatio={model.content.aspectRatio}>
          {shape}
        </Resizer>
      );
    }
    return shape;
  }
}
