import { setToClipboard } from "../common/utils/dom";
import { nextTick } from "../common/utils/time";
import { define } from "../context";
import { ShapeConfig } from "../editor/toolbar";
import { areaAtom } from "./area";
import { initialAtom } from "./initial";
import { shapesAtom } from "./shape";

export const activeToolAtom = define.view<ShapeConfig | null>(
  'active-tool',
  () => null
);

interface EditorTextState {
  editingId: string | null;
}

export const editorTextAtom = define.view(
  'editor-text',
  (): EditorTextState => ({ editingId: null }),
  (set) => {
    function markEditing(id: string | null) {
      set({ editingId: id });
    }
    return { markEditing, set };
  }
);

export interface ActiveShape {
  id: string;
  editing?: boolean;
}
export const activeShapeAtom = define.view<ActiveShape | null>(
  'active-shape',
  () => null
);

export const editor_handlers = define.memoize((use) => {
  const default_els = {
    mosaic: document.createElement('canvas'),
    svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  };
  let elements = default_els;

  async function compose() {
    const [activeShape, setActiveShape] = use(activeShapeAtom);
    if (activeShape) {
      setActiveShape(null);
      await nextTick();
    }
    const bg = use(initialAtom)[0].bg;
    const area = use(areaAtom)[0].rect;
    return bg.compose(area, elements.mosaic, elements.svg);
  }

  async function save() {
    const area = use(areaAtom)[0].rect;
    const { saveToFile, closeWindow } = use(initialAtom)[0];
    const isEmpty = use(shapesAtom)[1].isEmpty();

    const result = isEmpty
      ? await saveToFile(area)
      : await saveToFile(area, await composeBuffer());

    if (result.type === 'success') closeWindow();
  }

  async function composeBuffer() {
    const canvas = await compose();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    return blob ? Buffer.from(await blob.arrayBuffer()) : undefined;
  }

  async function copy() {
    const canvas = await compose();
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
        if (!blob) return;
        setToClipboard(blob);
      },'image/png');
    });
  }

  function unregister_elements() {
    elements = default_els;
  }
  function register_elements(svg: SVGSVGElement, mosaic: HTMLCanvasElement) {
    elements = { svg, mosaic };
    return unregister_elements;
  }

  return {
    compose,
    save,
    copy,
    register_elements
  };
});
