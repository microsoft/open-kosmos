export interface IsKey {
  Escape?: boolean;
  Backspace?: boolean;
  Delete?: boolean;
  Enter?: boolean;
}

interface Listener {
  priority: number;
  time: number;
  callback: (event: KeyboardEvent, is: IsKey) => void;
}

enum KeyOrder {
  Shift,
  Ctrl,
  Alt,
  Meta,
}
class DownKey {
  private state = '0000';
  private listeners = new Set<(instance: DownKey) => void>();

  constructor() {
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  private onKey = (event: KeyboardEvent) => {
    const keys: number[] = [];
    keys[KeyOrder.Shift] = event.shiftKey ? 1 : 0;
    keys[KeyOrder.Ctrl] = event.ctrlKey ? 1 : 0;
    keys[KeyOrder.Alt] = event.altKey ? 1 : 0;
    keys[KeyOrder.Meta] = event.metaKey ? 1 : 0;
    const state = keys.join('');

    if (state !== this.state) {
      this.state = state;
      this.listeners.forEach(call => call(this));
    }
  };

  private onBlur = () => { this.state = '0000'; };

  public has<K extends keyof (typeof KeyOrder)>(key: K) {
    return this.state[KeyOrder[key]] === '1';
  }

  public onChange(listen: (instance: DownKey) => void) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }
}

export const keydown = new DownKey();

class Manager {
  private listeners: Listener[] = [];

  constructor(
    private eventType: 'keydown' | 'keyup' | 'keypress',
  ) {}

  private dispatch = (event: KeyboardEvent) => {
    const is: IsKey = { [event.key]: true };
    const stop = event.stopPropagation;
    let isStop = false;
    event.stopPropagation = () => {
      stop.call(event);
      isStop = true;
    };
    for (const one of this.listeners) {
      one.callback(event, is);
      if (isStop) break;
    }
  };

  public on(callback: Listener['callback'], priority = 1) {
    const { listeners, dispatch, eventType } = this;
    if (listeners.length === 0) {
      document.addEventListener(eventType, dispatch);
    }
    const time = Date.now();
    listeners.push({ time, callback, priority });
    listeners.sort((a, b) => ((b.priority - a.priority) || (a.time - b.time)));
    return () => this.off(callback);
  }

  public off(callback: Listener['callback']) {
    const { listeners, dispatch, eventType } = this;
    this.listeners = listeners.filter((one) => one.callback !== callback);
    if (this.listeners.length === 0) {
      document.removeEventListener(eventType, dispatch);
    }
  }
}

const globalKey = new Manager('keydown');
export default globalKey;
