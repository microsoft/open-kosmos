import { Rect } from '../type';
import { define } from '../context';
import { handleDrag } from '../common/utils/drag';
import { DragLimiter } from '../common/drag-limiter';


interface AreaState {
  rect: Rect;
  editing: 'move' | 'resize' | null;
}

const initialRect: Rect = [0, 0, 0, 0];
function makeArea(): AreaState {
  return {
    rect: initialRect,
    editing: null,
  };
}

export function roundArea(area: Rect): Rect {
  return area.map(v => Math.round(v)) as Rect;
}

export const areaAtom = define.model('area', makeArea, (set, get, model) => {
  function reset() {
    set({ rect: initialRect, editing: null });
  }

  function setRect(rect: Rect) {
    set({ ...get(), rect: roundArea(rect) });
  }

  function reduceRect(rd: (prev: Rect) => Rect) {
    setRect(rd(get().rect));
  }

  function setStatus(editing: 'move' | 'resize' | null) {
    set({ ...get(), editing });
  }

  function startMove(ev: React.PointerEvent) {
    const limit: Rect = [0, 0, window.innerWidth, window.innerHeight];
    const limiter = new DragLimiter(limit, ev);
    const init = get().rect;
    handleDrag({
      onMove: (e: PointerEvent) => {
        set({
          rect: roundArea(limiter.moveRect(e, init)),
          editing: 'move',
        })
      },
      onEnd: () => setStatus(null),
    });
  }

  function startResize() {
    const { rect } = get();
    set({ rect, editing: 'resize' });
    return {
      init: rect,
      change: (area: Rect) => {
        const [, , w, h] = area;
        if (w <= 0 || h <= 0) return;
        setRect(area);
      },
      endChange: () => setStatus(null),
    };
  }

  return {
    set,
    reset,
    setRect,
    reduceRect,
    startMove,
    startResize,
  };
});

