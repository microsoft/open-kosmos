import React, { PureComponent } from 'react';
import { Rect } from '../../type';
import { handleDrag } from '../../common/utils/drag';
import { FreeCurveModel, uuid } from '../model'
import { DragLimiter, type MEvent } from '../../common/drag-limiter';
import { StrokeEvent, CapturedHooks } from '../../common/keyboard-painter';
import { keydown } from '../../common/utils/global-key';

interface PaintProps {
  area: Rect;
  addFreeCurve: (model: FreeCurveModel) => void;
}

class Curve {
  private archive = '';
  private d: string = '';
  private changed = false;
  private unbind: () => void;
  private shift = keydown.has('Shift');

  constructor(x: number, y: number, private repaint: (d: string) => void) {
    this.unbind = keydown.onChange(() => {
      const shift = keydown.has('Shift');
      if (shift === this.shift) return;
      this.shift = shift;
      if (shift) this.archive = this.d;
      else this.archive = '';
    });
    if (this.shift) this.archive = `M${x},${y}`;
    else this.d = `M${x},${y}`;
  }

  public moveTo(x: number, y: number) {
    const end = this.changed ? ` ${x},${y}` : ` L${x},${y}`;
    this.changed = true;
    this.d = (this.shift ? this.archive : this.d) + end;
    this.repaint(this.d);
  }

  public finish() {
    this.repaint('');
    this.unbind();
    return this.d;
  }
}

class FreeCurvePainter extends PureComponent<PaintProps, { d: string }> {
  private config = { stroke: 'blue', strokeWidth: 6 };
  public state = { d: '' };

  private repaint = (d: string) => this.setState({ d });
  private commit(d: string) {
    if (!d) return;
    this.props.addFreeCurve({ type: 'freeCurve', id: uuid(), ...this.config, d, offset: [0, 0] });
  }

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, stroke: string, strokeWidth: number): CapturedHooks | void {
    const { point: [sx, sy], keys } = ev;
    if (keys.enter || keys.space) {
      const [left, top] = this.props.area;
      this.config = { stroke, strokeWidth };
      const curve = new Curve(sx - left, sy - top, this.repaint);

      return {
        keymove: ([ex, ey]) => curve.moveTo(ex - left, ey - top),
        keyup: () => this.commit(curve.finish()),
        cancel: () => curve.finish(),
      };
    }
  }

  /**
   * try to start drawing by mouse down
   */
  public start(stroke: string, strokeWidth: number, ev: MEvent) {
    const [left, top] = this.props.area;
    this.config = { stroke, strokeWidth };
    const curve = new Curve(ev.clientX - left, ev.clientY - top, this.repaint);

    // Todo simplify path：http://paperjs.org/tutorials/paths/smoothing-simplifying-flattening/#simplifying-paths
    handleDrag({
      onMove: (e) => curve.moveTo(e.clientX - left, e.clientY - top),
      onEnd: () => this.commit(curve.finish()),
    });
  }

  render() {
    const { d } = this.state;
    const { stroke, strokeWidth } = this.config;
    const attrs = { d, stroke, strokeWidth, fill: 'none' };
    return <path {...attrs} />;
  }
}


interface Props {
  area: Rect;
  model: FreeCurveModel;
  onChange: (model: FreeCurveModel) => void;
  onActive: (id: string) => ((editing: boolean) => void);
  active: boolean;
}
interface State {
  editing?: [number, number];
}

class FreeCurveShape extends PureComponent<Props, State> {
  public state: State = {};
  private outline?: DOMRect;
  private onceMoved?: (editing: boolean) => void;

  private activate() {
    const { model, onActive, active } = this.props;
    if (active) return;
    this.onceMoved = onActive(model.id);
  }

  private onPointerDown =(ev: React.PointerEvent<SVGPathElement>) => {
    if (!this.outline) {
      this.outline = ev.currentTarget.getBBox();
    }
    ev.stopPropagation();
    const { editing } = this.state;
    const { model, onChange, area } = this.props;
    const limiter = new DragLimiter(area, ev);
    const [x, y] = editing || model.offset;
    this.activate();
    handleDrag({
      onMove: (event: PointerEvent) => {
        const [dx, dy] = limiter.offset(event);
        this.setState({ editing: [x + dx, y + dy] });
      },
      onceMoved: this.onceMoved,
      onEnd: () => {
        const offset = this.state.editing;
        if (!offset) return;
        this.setState({ editing: undefined });
        onChange({ ...model, offset });
      },
    });
  };

  private renderOutline(transform: string) {
    const { outline } = this;
    if (!outline) return null;
    const { x, y, width, height } = outline;
    const attrs = { x, y, width, height, transform, fill: 'none', stroke: '#0078D7', strokeWidth: 1 };
    return <rect {...attrs} />;
  }

  render() {
    const { editing } = this.state;
    const { model, active } = this.props;

    const { d, stroke, strokeWidth, offset } = model;
    const attrs = { d, stroke, strokeWidth, fill: 'none' };
    const transform = `translate(${(editing || offset).join(',')})`;

    const shape = (
      <path
        {...attrs}
        style={{ cursor: 'move' }}
        transform={transform}
        strokeLinecap="round"
        strokeLinejoin="round"
        onPointerDown={this.onPointerDown}
      />
    );

    if (active) {
      return (
        <g>
          {this.renderOutline(transform)}
          {shape}
        </g>
      );
    }
    return shape;
  }
}

export {
  FreeCurvePainter,
  FreeCurveShape,
};
