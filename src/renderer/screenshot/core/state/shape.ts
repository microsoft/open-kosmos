import { define } from "../context";
import { ArrowModel, EllipseModel, FreeCurveModel, LayerModel, ModelData, MosaicModel, PresetModel, SquareModel, TextModel } from "../editor/model";
import { produce } from 'immer';
import { ShapeConfig } from "../editor/toolbar";
import { measureWidth } from "../common/utils/dom";

function defauleShapes(): ModelData {
  return {
    layers: [],
    elements: {},
  };
}
export const shapesAtom = define.model('shapes', defauleShapes, (set, get, model) => {
  function reset() {
    set(defauleShapes());
  }

  function addLayer(layer: LayerModel) {
    model.startTransaction();
    set(produce((d) => {
      d.elements[layer.id] = layer;
      d.layers.push(layer.id);
    }));
    requestAnimationFrame(model.endTransaction);
  }

  function updateLayer(layer: LayerModel) {
    if (get().elements[layer.id] === layer) return;
    model.startTransaction();
    set(produce((d) => {
      d.elements[layer.id] = layer;
    }));
    requestAnimationFrame(model.endTransaction);
  }

  function deleteLayer(id: string) {
    if (!get().elements[id]) return;
    model.startTransaction();
    set(produce((d) => {
      delete d.elements[id];
      d.layers = d.layers.filter(l => l !== id);
    }));
    requestAnimationFrame(model.endTransaction);
  }

  function getLayer(id: string): LayerModel | undefined {
    return get().elements[id];
  }

  type FnShape<T> = (v: T) => void;
  const addSquare: FnShape<SquareModel> = addLayer;
  const addEllipse: FnShape<EllipseModel> = addLayer;
  const addArrow: FnShape<ArrowModel> = addLayer;
  const addFreeCurve: FnShape<FreeCurveModel> = addLayer;
  const addText: FnShape<TextModel> = addLayer;
  const addPreset: FnShape<PresetModel> = addLayer;
  const updateSquare: FnShape<SquareModel> = updateLayer;
  const updateEllipse: FnShape<EllipseModel> = updateLayer;
  const updateArrow: FnShape<ArrowModel> = updateLayer;
  const updateFreeCurve: FnShape<FreeCurveModel> = updateLayer;
  const updateText: FnShape<TextModel> = updateLayer;
  const updatePreset: FnShape<PresetModel> = updateLayer;

  function changeMosaic(data: MosaicModel | undefined) {
    if (get().mosaic == data) return;
    model.startTransaction();
    set(produce((d) => {
      d.mosaic = data;
    }));
    requestAnimationFrame(model.endTransaction);
  }

  function isEmpty() {
    const { layers, mosaic } = get();
    return layers.length === 0 && mosaic == undefined;
  }

  function changeByConfig(id: string, config: ShapeConfig) {
    switch (config.type) {
      case 'square': {
        const shape = getLayer(id);
        if (!shape || shape.type !== 'square') break;
        updateLayer({ ...shape, stroke: config.color, strokeWidth: config.size });
        break;
      }
      case 'ellipse': {
        const shape = getLayer(id);
        if (!shape || shape.type !== 'ellipse') break;
        updateLayer({ ...shape, stroke: config.color, strokeWidth: config.size });
        break;
      }
      case 'arrow': {
        const shape = getLayer(id);
        if (!shape || shape.type !== 'arrow') break;
        updateLayer({ ...shape, fill: config.color, size: config.size });
        break;
      }
      case 'pencil': {
        const shape = getLayer(id);
        if (!shape || shape.type !== 'freeCurve') break;
        updateLayer({ ...shape, stroke: config.color, strokeWidth: config.size });
        break;
      }
      case 'text': {
        const old = getLayer(id);
        if (!old || old.type !== 'text') break;
        const { color, size: fontSize } = config;
        const shape = { ...old, color, fontSize };
        if (fontSize !== old.fontSize) {
          const element = document.getElementById(`shape-text-${id}`);
          if (element) {
            element.style.width = '';
            element.style.fontSize = `${fontSize}px`;
            shape.width = measureWidth(element);
          }
        }
        updateLayer(shape);
        break;
      }
    }
  }

  return {
    reset,
    addLayer,
    updateLayer,
    addSquare,
    addEllipse,
    addArrow,
    addFreeCurve,
    addText,
    addPreset,
    updateSquare,
    updateEllipse,
    updateArrow,
    updateFreeCurve,
    updateText,
    updatePreset,
    changeMosaic,
    deleteLayer,
    getLayer,
    isEmpty,
    changeByConfig,
    model,
  }
});
