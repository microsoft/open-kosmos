import React, { PureComponent } from 'react';
import { Rect } from '../../type';
import { handleDrag } from '../../common/utils/drag';
import { calcCursorRect, offsetRect } from '../../common/utils/coord';
import { keydown } from '../../common/utils/global-key';
import { SquareModel, uuid } from '../model';
import Resizer from './shape-resizer';
import { DragLimiter, type MEvent } from '../../common/drag-limiter';
import { StrokeEvent, CapturedHooks } from '../../common/keyboard-painter';

interface PaintState {
  stroke: string;
  strokeWidth: number;
  rect?: Rect;
}
interface PaintProps {
  addSquare: (model: SquareModel) => void;
  area: Rect;
}

class SquarePainter extends PureComponent<PaintProps, PaintState> {
  public state: PaintState = {
    stroke: 'blue',
    strokeWidth: 6,
  };

  private commit() {
    const { rect, stroke, strokeWidth } = this.state;
    if (!rect) return;
    if (rect[2] > 0 && rect[3] > 0) {
      this.props.addSquare({ type: 'square', id: uuid(), stroke, strokeWidth, rect });
    }
    this.setState({ rect: undefined });
  }

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, stroke: string, strokeWidth: number): CapturedHooks | void {
    const { point: [sx, sy], keys } = ev;
    if (keys.enter || keys.space) {
      const [left, top] = this.props.area;
      this.setState({ stroke, strokeWidth });
      return {
        keymove: ([ex, ey]) => {
          this.setState({ rect: calcCursorRect(sx - left, sy - top, ex - left, ey - top) });
        },
        keyup: () => this.commit(),
        cancel: () => this.setState({ rect: undefined }),
      };
    }
  };

  /**
   * try to start drawing by mouse down
   */
  public start(stroke: string, strokeWidth: number, ev: MEvent) {
    this.setState({ stroke, strokeWidth });
    const limiter = new DragLimiter(this.props.area, ev);
    handleDrag({
      onMove: (e) => {
        const rect = limiter.drawRect(e, keydown.has('Shift'));
        this.setState({ rect });
      },
      onEnd: () => this.commit(),
    });
  }

  render() {
    const { rect, stroke, strokeWidth } = this.state;
    if (!rect) return null;
    const [x, y, w, h] = rect;
    // use 0.01 to make sure that the painter rect is visible
    const attrs = { x, y, width: w || 0.01, height: h || 0.01, stroke, strokeWidth, fill: 'none'};
    return <rect {...attrs} aria-live="assertive" aria-label='render rect'/>
  }
}


interface Props {
  area: Rect;
  model: SquareModel;
  onChange: (model: SquareModel) => void;
  onActive: (id: string) => ((editing: boolean) => void);
  active: boolean;
}
interface State {
  editing?: Rect;
}

class SquareShape extends PureComponent<Props, State> {
  public state: State = {};
  private onceMoved: ((flag: boolean) => void) | undefined;

  private activate() {
    const { model, onActive, active } = this.props;
    if (active) return;
    this.onceMoved = onActive(model.id);
  }

  private onPointerDown =(ev: React.PointerEvent) => {
    ev.stopPropagation();
    const { editing } = this.state;
    const { model, onChange, area } = this.props;
    const limiter = new DragLimiter(area, ev);
    const origin = editing || model.rect;
    this.activate();
    handleDrag({
      onMove: (event: PointerEvent) => {
        // use limiter.moveRect to restrict shape in area if needed
        const [dx, dy] = limiter.offset(event);
        const editing = offsetRect(origin, dx, dy);
        this.setState({ editing });
      },
      onceMoved: this.onceMoved,
      onEnd: () => {
        const rect = this.state.editing;
        if (!rect) return;
        this.setState({ editing: undefined });
        onChange({ ...model, rect });
      },
    });
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

  render() {
    const { editing } = this.state;
    const { model, area, active } = this.props;
    const rect = editing || model.rect;

    const [x, y, width, height] = rect;
    const { stroke, strokeWidth } = model;
    const attrs = { x, y, width, height, stroke, strokeWidth, fill: 'none'};

    const shape =  (
      <rect
        {...attrs}
        style={{ cursor: 'move' }}
        onPointerDown={this.onPointerDown}
      />
    );

    if (active) {
      return (
        <Resizer limit={area} rect={rect} onChangeStart={this.onResizeStart}>
          {shape}
        </Resizer>
      );
    }
    return shape;
  }
}

export {
  SquarePainter,
  SquareShape,
};
