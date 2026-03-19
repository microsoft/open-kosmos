import { IsKey } from "../common/utils/global-key";
import { define } from "../context";
import { areaAtom } from "./area";
import { activeShapeAtom, activeToolAtom, editorTextAtom } from "./editor";
import { initialAtom } from "./initial";
import { shapesAtom } from "./shape";


export const state_handlers = define.memoize((use, model) => {
  function resetAll() {
    // Reset all editor state
    use(areaAtom)[1].reset();
    use(shapesAtom)[1].reset();
    use(activeShapeAtom)[1](null);
    use(activeToolAtom)[1](null);
    use(editorTextAtom)[1].markEditing(null);
  }

  function quit() {
    use(initialAtom)[0].closeWindow();
  }

  async function sendToMain(blob: Blob | null) {
    const { rect } = use(areaAtom)[0];
    const send = use(initialAtom)[0].sendToMain;
    if (blob) {
      const buffer = await blob.arrayBuffer();
      return send(rect, Buffer.from(buffer));
    }
    return send(rect);
  }

  function resetStatusInUndoRedo() {
    use(activeShapeAtom)[1](null);
    // use(activeToolAtom)[1](null);
    use(editorTextAtom)[1].markEditing(null);
  }

  function undo() {
    if (!model.canUndo) return;
    resetStatusInUndoRedo();
    model.undo();
  }

  function redo() {
    if (!model.canRedo) return;
    resetStatusInUndoRedo();
    model.redo();
  }

  function handleKey(event: KeyboardEvent, is: IsKey) {
    const [activeShape, setActiveShape] = use(activeShapeAtom);
    const [activeTool, setActiveTool] = use(activeToolAtom);
    const { deleteLayer } = use(shapesAtom)[1];

    if (activeShape) {
      if (is.Backspace || is.Delete) {
        setActiveShape(null);
        deleteLayer(activeShape.id);
      } else if (is.Escape) {
        event.stopPropagation();
        setActiveShape(null);
      }
    } else if (is.Escape) {
      event.stopPropagation();
      if (activeTool) {
        setActiveTool(null);
      } else {
        quit();
      }
    } else if (event.code === 'KeyZ') {
      if (event.ctrlKey || event.metaKey) {
        if (event.shiftKey) redo();
        else undo();
      }
    } else if (event.code === 'KeyY') {
      if (event.ctrlKey || event.metaKey) {
        redo();
      }
    }
  }

  return { resetAll, quit, undo, redo, handleKey, sendToMain };
});

