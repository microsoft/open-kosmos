import React, { PureComponent, createRef } from 'react';
import { EditArea } from '../../type';
import { handleDrag } from '../../common/utils/drag';
import { BackgroundImage } from '../../common/utils/bg';
import { makeInvisibleCanvas } from '../../common/utils/dom';
import { MosaicModel } from '../model';
import { type MEvent } from '../../common/drag-limiter';
import { StrokeEvent, CapturedHooks } from '../../common/keyboard-painter';

interface Props {
  bg: BackgroundImage;
  area: EditArea;
  onChange: (mosaic: MosaicModel | undefined) => void;
  model?: MosaicModel;
}
class MosaicLayer extends PureComponent<Props> {
  private ref = createRef<HTMLCanvasElement>();
  private _blur_?: ImageData;

  public get canvas() {
    return this.ref.current!;
  }

  private initBrush(ctx: OffscreenCanvasRenderingContext2D) {
    ctx.strokeStyle = 'white';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  private seal(canvas: OffscreenCanvas) {
    let blur = this._blur_;
    if (blur === undefined) {
      const { bg, area } = this.props;
      blur = bg.blur(area, 6);
      this._blur_ = blur;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.putImageData(blur, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(canvas, 0, 0);
  }

  private clear() {
    const ctx = this.canvas.getContext('2d')!;
    const [, , w, h] = this.props.area;
    ctx.clearRect(0, 0, w, h);
  }

  private startDraw(size: number, sx: number, sy: number) {
    const [left, top, w, h] = this.props.area;
    const [startX, startY] = [sx- left, sy -top];

    let changed = false;
    let d = `M${startX},${startY}`;

    const invisible = makeInvisibleCanvas(w, h);
    const hidden = invisible.ctx;

    hidden.drawImage(this.canvas, 0, 0);
    this.initBrush(hidden);
    hidden.lineWidth = size;
    hidden.beginPath();
    hidden.moveTo(startX, startY);

    return {
      moveTo: (ex: number, ey: number) => {
        const [x, y] = [ex - left, ey - top];
        if (changed) {
          d += ` ${x},${y}`;
        } else {
          d += ` L${x},${y}`;
          changed = true;
        }
        hidden.lineTo(x, y);
        hidden.stroke();
        this.seal(invisible.canvas);
      },
      commit: () => {
        if (!changed) return;
        const model = this.props.model || [];
        this.props.onChange([...model, { d, size }]);
      },
    }
  }

  /**
   * try to start drawing by mouse down
   */
  public start(size: number, ev: MEvent) {
    const { moveTo, commit } = this.startDraw(size, ev.clientX, ev.clientY);
    handleDrag({
      onMove: (e) => moveTo(e.clientX, e.clientY),
      onEnd: commit,
    });
  }

  /**
   * try to start drawing by keyboard
   */
  public keyStart(ev: StrokeEvent, size: number): CapturedHooks | void {
    const { point: [sx, sy], keys } = ev;
    if (!(keys.space || keys.enter)) return;
    const { moveTo, commit } = this.startDraw(size, sx, sy);
    return {
      keymove: ([ex, ey]) => moveTo(ex, ey),
      keyup: commit,
      cancel: () => this.repaint(),
    }
  }

  private repaint() {
    const { model, area } = this.props;
    if (model === undefined || model.length === 0) {
      this.clear();
    } else {
      const [,, w, h] = area;
      const invisible = makeInvisibleCanvas(w, h);
      const hidden = invisible.ctx;
      this.initBrush(hidden);
      model.forEach(({ d, size }) => {
        const path = new Path2D(d);
        hidden.lineWidth = size;
        hidden.stroke(path);
      });
      this.seal(invisible.canvas);
    }
  }

  componentDidUpdate(prevProps: Readonly<Props>) {
    if (prevProps.model === this.props.model) return;
    this.repaint();
  }

  componentDidMount() {
    this.repaint();
  }

  render() {
    const { area } = this.props;
    const [, , w, h] = area;
    return (
      <canvas
        width={w}
        height={h}
        style={{ position: 'absolute', pointerEvents: 'none' }}
        aria-live="assertive"
        aria-label={`width:${w}px;height:${h}px`}
        ref={this.ref}
      />
    )
  }
}

export default MosaicLayer;
