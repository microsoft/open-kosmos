import React, { PureComponent } from 'react';
import { handleDrag } from '../../common/utils/drag';
import { ArrowModel, uuid } from '../model'
import { Rect, Point} from '../../type';
import { DragLimiter, type MEvent } from '../../common/drag-limiter';
import { StrokeEvent, CapturedHooks } from '../../common/keyboard-painter';

interface PaintState {
  fill: string;
  size: number;
  from: Point;
  to?: Point;
}
interface PaintProps {
  area: Rect;
  addArrow: (model: ArrowModel) => void;
}

function equal(from: Point, to: Point) {
  return (from[0] === to[0] && from[1] === to[1]);
}

function draw(from: Point, to: Point, size = 20) {
  const [x, y] = from;
  const [tx, ty] = to;
  const [relativeX, relativeY] = [tx -x, ty - y];

  const length = Math.sqrt(relativeX**2 + relativeY**2);
  const [sin, cos] = [relativeY / length, relativeX / length];

  function calc(along: number, raduis: number) {
    const d = length - along;
    const [mx, my] = [d * cos + x, d * sin + y];
    const [dx, dy] = [raduis * sin, raduis * cos];
    return {
      mid: mx + ',' + my,
      left: (mx - dx) + ',' + (my + dy),
      right: (mx + dx) + ',' + (my - dy),
    };
  };

  const p1 = calc(size / 1.5, size / 4);
  const p2 = calc(size, size / 2);
  const p3 = calc(length, 0.5);

  return {
    line: `M${p3.right} L${p3.left} L${p1.left} ${p1.right} Z`,
    arrow: `M${tx},${ty} L${p2.left} ${p1.mid} ${p2.right} Z`,
  };
}

class ArrowPainter extends PureComponent<PaintProps, PaintState> {
  public state: PaintState = {
    fill: 'blue',
    size: 6,
    from: [0, 0],
  };

  private commit() {
    const { from, to, fill, size } = this.state;
    if (!to) return;
    if (!equal(from, to)) {
      this.props.addArrow({ type: 'arrow', id: uuid(), fill, size, from, to });
    }
    this.setState({ to: undefined });
  }

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, fill: string, size: number): CapturedHooks | void {
    const { point: [sx, sy], keys } = ev;
    if (keys.enter || keys.space) {
      const [left, top] = this.props.area;
      this.setState({ fill, size, from: [sx - left, sy - top] });
      return {
        keymove: ([ex, ey]) => this.setState({ to: [ex - left, ey - top]}),
        keyup: () => this.commit(),
        cancel: () => this.setState({ to: undefined }),
      };
    }
  }

  /**
   * try to start drawing by mouse down
   */
  public start(fill: string, size: number, ev: MEvent) {
    this.setState({ fill, size });
    const limiter = new DragLimiter(this.props.area, ev);
    const from = limiter.position(ev);
    handleDrag({
      onMove: (e) => this.setState({ from, to: limiter.position(e) }),
      onEnd: () => this.commit(),
    });
  }

  render() {
    const { from, to, fill, size } = this.state;
    if (!to) return null;
    const { line, arrow } = draw(from, to, size);
    return (
      <g fill={fill} aria-live="assertive" aria-label='render arrow'>
        <path d={line} />
        <path d={arrow} />
      </g>
    );
  }
}


interface Props {
  area: Rect;
  model: ArrowModel;
  onChange: (model: ArrowModel) => void;
  onActive: (id: string) => ((editing: boolean) => void);
  active: boolean;
}
interface State {
  editing?: { from: Point, to: Point };
}

class ArrowShape extends PureComponent<Props, State> {
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
    const { from, to } = editing || model;
    this.activate();
    handleDrag({
      onMove: (event: PointerEvent) => {
        // use limiter.moveArrow to restrict shape in area if needed
        const [dx, dy] = limiter.offset(event);
        this.setState({
          editing: { from: [from[0] + dx, from[1] + dy], to: [to[0] + dx, to[1] + dy] },
        });
      },
      onceMoved: this.onceMoved,
      onEnd: () => {
        const data = this.state.editing;
        if (!data) return;
        this.setState({ editing: undefined });
        onChange({ ...model, ...data });
      },
    })
  };

  private onResize = (event: React.PointerEvent) => {
    event.stopPropagation();
    const { editing } = this.state;
    const { model, onChange, area } = this.props;
    const limiter = new DragLimiter(area, event);
    const { from, to } = editing || model;

    const pos = (event as any).target.dataset.pos as 'from' | 'to';
    handleDrag({
      onMove: (e: PointerEvent) => {
        const points = { from, to };
        points[pos] = limiter.position(e);
        if (equal(points.from, points.to)) return;
        this.setState({ editing: points });
      },
      onceMoved: this.onceMoved,
      onEnd: () => {
        const { editing } = this.state;
        if (!editing) return;
        this.setState({ editing: undefined });
        onChange({ ...model, ...editing });
      },
    });
  };

  private renderResizer(from: Point, to: Point) {
    const style = { cursor: 'default' };
    const pointAttrs = { stroke: '#0078D7', fill: 'white', strokeWidth: 2, r: 5, onPointerDown: this.onResize ,style };
    return (
      <>
        <circle {...pointAttrs} cx={from[0]} cy={from[1]} data-pos="from"/>
        <circle {...pointAttrs} cx={to[0]} cy={to[1]} data-pos="to"/>
      </>
    );
  }

  render() {
    const { editing } = this.state;
    const { model, active } = this.props;

    const { from, to } = editing || model;
    const { fill, size } = model;
    const { onPointerDown } = this;
    const { line, arrow } = draw(from, to, size);

    return (
      <g fill={fill} style={{ cursor: 'move' }}>
        <path d={line} onPointerDown={onPointerDown}/>
        <path d={arrow} onPointerDown={onPointerDown}/>
        {active && this.renderResizer(from, to)}
      </g>
    );
  }
}

export {
  ArrowPainter,
  ArrowShape,
};
