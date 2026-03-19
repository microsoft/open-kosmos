interface MoveContext {
  first?: boolean;
}
interface EndContext {
  moved?: boolean;
}

interface HandleDragHooks {
  onMove: (event: PointerEvent, cxt: MoveContext) => void,
  onEnd?: (event: PointerEvent, ctx: EndContext) => void,
  onceMoved?: (editing: boolean) => void;
  cursor?: string;
}

const NOOP = () => {};

function setCursor(cursor?: string) {
  if (!cursor) return NOOP;
  const { body } = document;
  const old = body.style.cursor;
  body.style.setProperty('cursor', cursor, 'important');
  return () => body.style.cursor = old;
}

export function handleDrag({ onMove, onEnd = NOOP, cursor, onceMoved = NOOP }: HandleDragHooks) {
  const restoreCursor = setCursor(cursor);

  let noMove = true;
  const handleMove = (event: PointerEvent) => {
    if (noMove) {
      noMove = false;
      onceMoved(true);
      onMove(event, { first: true });
    } else {
      onMove(event, {});
    }
  };

  const handleUp = (event: PointerEvent) => {
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleUp);
    restoreCursor();
    if (noMove) {
      onEnd(event, {});
    } else {
      onEnd(event, { moved: true });
      onceMoved(false);
    }
  };
  document.addEventListener('pointermove', handleMove);
  document.addEventListener('pointerup', handleUp);
}
