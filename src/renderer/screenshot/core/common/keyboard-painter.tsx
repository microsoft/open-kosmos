import React, { PureComponent, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { Rect } from '../type';
import globalKey from './utils/global-key';
import { limitPointInRect } from './utils/coord';
import { Listen } from '../editor/toolbar/components/listen';
import { getString } from './localString';
import { waitWinSize } from './utils/dom';

/**
 * ----------------------------------------------------------------------------
 * React component
 * ----------------------------------------------------------------------------
 */
interface State {
  position?: Position;
  cursor?: ReactNode;
  alert: string;
}
interface Props {
  pointerMoved: () => void;
  cursorVisibleChange: (visible: boolean) => void;
}

class Pointer extends PureComponent<Props, State> {
  public state: State = { alert: '' };

  public get visible() {
    const { position, cursor } = this.state;
    return Boolean(position && cursor);
  }

  private alertMsgs = {
    left: getString('moveCursorLeft'),
    right: getString('moveCursorRight'),
    up: getString('moveCursorUp'),
    down: getString('moveCursorDown'),
  };
  public moveCursor(position: Position, direction: Direction) {
    const alert = this.alertMsgs[direction];
    this.setState({ position, alert });
  }

  public hide() {
    this.setState({ position: undefined });
  }

  public setCursor(cursor: ReactNode) {
    this.setState({ cursor });
  }

  private renderCursor() {
    const { position, cursor } = this.state;
    if (!position || !cursor) return null;
    return (
      <>
        <div style={{ width: '100vw', height: '100vh', cursor: 'none' }} onPointerMove={this.props.pointerMoved} />
        <div style={{ position: 'absolute', left: position[0], top: position[1], transform: 'translate(-50%, -50%)' }}>
          {cursor}
        </div>
      </>
    );
  }

  render() {
    const { visible, props: { cursorVisibleChange }, state: { alert } } = this;
    return (
      <>
        <div
          aria-label={alert}
          role="alert"
          aria-live="assertive"
          style={{ position: 'absolute', color: 'transparent', top: -9999, zIndex: -9999 }}
        >
          {alert}
        </div>
        {this.renderCursor()}
        <Listen deps={[visible]} change={() => cursorVisibleChange(visible)} />
      </>
    );
  }
}

function create(props: Props) {
  const ref = React.createRef<Pointer>();
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = '0';
  document.body.appendChild(container);
  ReactDOM.createRoot(container).render(<Pointer {...props} ref={ref} />);
  return { get e() { return ref.current! }  };
}

/**
 * ----------------------------------------------------------------------------
 * Painter
 * ----------------------------------------------------------------------------
 */
type Direction = 'left' | 'right' | 'up' | 'down';
type StrokeKey = 'shift' | 'space' | 'enter';
export type Position = [x: number, y: number];
type StrokenKeys = { [key in StrokeKey]?: boolean };

/**
 * if some key is pressed, return this interface to handle keymove and keyup event
 */
export interface CapturedHooks {
  /**
   * trigger move event once the cursor is moved
   */
  keymove: (position: Position, strokeKeys: Readonly<StrokenKeys>) => void;
  /**
   * trigger keyup event once the key is released
   * return true to stop capturing
   */
  keyup: (position: Position, strokeKeys: Readonly<StrokenKeys>, key: StrokeKey) => void;
  /**
   * if mouse moved, then cancel the capturing and trigger this callback
   */
  cancel?: () => void;
}

interface CaptureWithKey extends CapturedHooks {
  key: StrokeKey;
}

export interface StrokeEvent {
  point: Position;
  keys: Readonly<StrokenKeys>;
  key: StrokeKey;
}
/**
 * if some key is pressed, return capture hooks to handle keymove and keyup event
 */
type TrackKeydown = (event: StrokeEvent) => CapturedHooks | void;

const KeyCodeToDeriction: Record<number, Direction | undefined> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
};
const KeyCodeToStrokeKey: Record<number, StrokeKey | undefined> = {
  16: 'shift',
  32: 'space',
  13: 'enter',
};

const NOOP = () => {};

class Painter {
  private pointer: { readonly e: Pointer };
  private position: Position = [0, 0];
  private strokenKeys: StrokenKeys = {};
  private limit: Rect | null = null;

  private pending = false;

  public turnOff = NOOP;

  constructor() {
    waitWinSize((w, h) => this.position = [w / 2, h / 2]);
    this.pointer = create({
      /**
       * once mouse moved, it means the user will no longer use keyboard
       * then we should clear related context this time
       */
      pointerMoved: () => {
        this.pointer.e.hide();
        this.captured?.cancel?.();
        this.captured = undefined;
        this.strokenKeys = {};
      },
      /**
       * triggered once the cursor turns to visible or invisible
       */
      cursorVisibleChange: (visible) => {
        this.cursorVisibleTracker?.(visible);
      },
    });
  }

  private keydown = ({ keyCode }: KeyboardEvent) => {
    if (this.pending) return;
    /**
     * if arrow keys are pressed, then move the cursor
     */
    const direction = KeyCodeToDeriction[keyCode];
    if (direction) {
      this.handleMove(direction);
      return;
    }
    /**
     * if shift, space or enter is pressed, then trigger the tracker
     */
    const key = KeyCodeToStrokeKey[keyCode];
    if (!key) return;
    const { strokenKeys: keys, tracker, captured, position: point, pointer } = this;
    keys[key] = true;
    if (captured || !tracker) return;
    const hooks = tracker({ point, keys, key });
    if (hooks) {
      this.captured = { ...hooks, key };
      pointer.e.setState({ position: point });
    }
  };

  /**
   * if shift, space or enter is released, then trigger the captured keyup event
   * then clear the captured context if needed
   */
  private keyup = ({ keyCode }: KeyboardEvent) => {
    if (this.pending) return;

    const key = KeyCodeToStrokeKey[keyCode];
    const { captured, strokenKeys: keys, position } = this;
    if (key && keys[key]) {
      keys[key] = false;
      if (captured && captured.key === key) {
        captured.keyup(position, keys, key);
        this.captured = undefined;
      }
    }
  };

  public holdon(pending: boolean) {
    this.pending = pending;
  }

  private lastMove: [Direction, number, number] = ['up', 0, 0];
  private handleMove(direction: Direction) {
    /**
     * if the same direction is pressed in 200ms, then increase the distance
     * so that the cursor can move faster
     */
    let distance = 1;
    const now = Date.now();
    const [lastDir, lastDis, lastTime] = this.lastMove;
    if ((lastDir === direction) && (now - lastTime < 200)) {
      distance = Math.min(20, lastDis + 1);
    }
    this.lastMove = [direction, distance, now];

    let [x, y] = this.position;
    switch (direction) {
      case 'left':
        x -= distance;
        break;
      case 'right':
        x += distance;
        break;
      case 'up':
        y -= distance;
        break;
      case 'down':
        y += distance;
        break;
    }
    const MaxArea: Rect = [0, 0, window.innerWidth, window.innerHeight];
    [x, y] = limitPointInRect(this.limit || MaxArea, x, y);

    if (this.position[0] === x && this.position[1] === y) return;
    this.position = [x, y];
    this.pointer.e.moveCursor(this.position, direction);
    this.captured?.keymove(this.position, this.strokenKeys);
  }

  public setCursor(cursor: ReactNode) {
    this.pointer.e.setCursor(cursor);
    return this;
  }

  /**
   * set the limit area, so that the cursor can't move out of it
   * if it's null, then the cursor can move freely
   */
  public setLimit(limit: Rect | null) {
    if (this.limit === limit) return this;
    this.limit = limit;
    if (limit) {
      this.position = [limit[0] + limit[2] / 2, limit[1] + limit[3] / 2];
    } else {
      this.position = [window.innerWidth / 2, window.innerHeight / 2];
    }
    return this;
  }

  private tracker?: TrackKeydown;
  private captured?: CaptureWithKey;
  public trackKeydown(track: TrackKeydown) {
    this.tracker = track;
    return this;
  }

  private cursorVisibleTracker?: (v: boolean) => void;
  public trackCursor(tracker: (v: boolean) => void) {
    this.cursorVisibleTracker = tracker;
    return this;
  }

  public resetTrack() {
    this.tracker = undefined;
    this.captured = undefined;
    this.cursorVisibleTracker = undefined;
  }

  /**
   * turn on means to start listening to the keyboard event and move the cursor
   * and handle the specific interaction behavior
   */
  private running = false;
  public turnOn() {
    if (this.running) return this;
    globalKey.on(this.keydown);
    document.addEventListener('keyup', this.keyup);
    this.turnOff = () => {
      globalKey.off(this.keydown);
      document.removeEventListener('keyup', this.keyup);
      this.resetTrack();
      this.running = false;
      this.strokenKeys = {};
      this.turnOff = NOOP;
    };
    this.running = true;
    return this;
  }
}

export const keyboardPainter = new Painter();
