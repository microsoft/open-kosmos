// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// -- hoisted mocks --
const mockAreaAtomUse = vi.hoisted(() => vi.fn());
const mockActiveShapeAtomUse = vi.hoisted(() => vi.fn());
const mockShapesAtomUseCreation = vi.hoisted(() => vi.fn());
const mockShapesAtomUse = vi.hoisted(() => vi.fn());
const mockActiveToolAtomUseData = vi.hoisted(() => vi.fn());
const mockActiveToolAtomUseCreation = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockEditorTextAtomUseData = vi.hoisted(() => vi.fn());
const mockStateHandlersUse = vi.hoisted(() => vi.fn());
const mockEditorHandlersUse = vi.hoisted(() => vi.fn());
const mockGlobalKeyOn = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockIsPainterConfig = vi.hoisted(() => vi.fn(() => false));
const mockStartDrawByMouse = vi.hoisted(() => vi.fn());
const mockUpdateCursorForKeyboard = vi.hoisted(() => vi.fn());
const mockKeyboardPainterTurnOff = vi.hoisted(() => vi.fn());
const mockMessage = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// All paths relative to THIS test file:
// This file: src/renderer/screenshot/core/editor/__tests__/index.coverage.test.tsx
// Source:    src/renderer/screenshot/core/editor/index.tsx

vi.mock('../../state', () => ({
  areaAtom: { use: mockAreaAtomUse },
  activeShapeAtom: { use: mockActiveShapeAtomUse },
  shapesAtom: {
    useCreation: mockShapesAtomUseCreation,
    use: mockShapesAtomUse,
  },
  activeToolAtom: {
    useData: mockActiveToolAtomUseData,
    useCreation: mockActiveToolAtomUseCreation,
  },
  editorTextAtom: { useData: mockEditorTextAtomUseData },
  state_handlers: { use: mockStateHandlersUse },
  editor_handlers: { use: mockEditorHandlersUse },
}));

vi.mock('../../common/utils/global-key', () => ({
  default: { on: mockGlobalKeyOn },
  keydown: { has: vi.fn(() => false) },
}));

vi.mock('../painter', () => ({
  isPainterConfig: mockIsPainterConfig,
  startDrawByMouse: mockStartDrawByMouse,
  startDrawByKeyboard: vi.fn(),
  updateCursorForKeyboard: mockUpdateCursorForKeyboard,
}));

vi.mock('../../common/keyboard-painter', () => ({
  keyboardPainter: {
    turnOff: mockKeyboardPainterTurnOff,
    setCursor: vi.fn(() => ({
      trackKeydown: vi.fn(() => ({
        setLimit: vi.fn(() => ({ turnOn: vi.fn() })),
      })),
    })),
  },
}));

vi.mock('../../components/message', () => ({
  message: mockMessage,
}));

vi.mock('../../common/cursor', () => ({
  default: {
    pencil: vi.fn(() => 'pencil-cursor'),
    mosaic: vi.fn(() => 'mosaic-cursor'),
  },
}));

vi.mock('../area-resizer', () => ({
  default: () => <div data-testid="area-resizer" />,
  points: [],
  applyDelta: vi.fn(),
  Horizon: {},
  Vertical: {},
}));

vi.mock('../shape', () => ({
  createPainters: vi.fn(() => ({
    square: { current: null },
    ellipse: { current: null },
    arrow: { current: null },
    pencil: { current: null },
    mosaic: { current: { canvas: document.createElement('canvas') } },
    text: { current: null },
    preset: { current: null },
  })),
  ShapeLayers: () => <g data-testid="shape-layers" />,
  SquarePainter: React.forwardRef(() => null),
  EllipsePainter: React.forwardRef(() => null),
  ArrowPainter: React.forwardRef(() => null),
  FreeCurvePainter: React.forwardRef(() => null),
  TextPainter: React.forwardRef(() => null),
  PresetPainter: React.forwardRef(() => null),
  ShapeTextStyle: '',
  NumberTextStyle: '',
}));

vi.mock('../shape/mosaic', () => ({
  default: React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ canvas: document.createElement('canvas') }));
    return <canvas data-testid="mosaic-layer" />;
  }),
}));

vi.mock('../toolbar', () => ({
  MainToolbar: () => <div data-testid="main-toolbar" />,
}));

vi.mock('../../magnifying', () => ({
  default: () => <div data-testid="magnifying" />,
}));

vi.mock('../measure', () => ({
  default: () => <div data-testid="measure" />,
}));

vi.mock('../../common/styled', () => ({
  css: (_s: TemplateStringsArray) => 'mock-class',
}));

beforeAll(() => {
  SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 } as SVGRect);
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(public d: string) {} };
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => ({
      putImageData: vi.fn(), globalCompositeOperation: '',
      drawImage: vi.fn(), clearRect: vi.fn(),
    })),
    configurable: true,
  });
});

function makeAreaActions() {
  return {
    startMove: vi.fn(),
    startResize: vi.fn(() => ({ init: [0,0,100,100], change: vi.fn(), endChange: vi.fn() })),
    reduceRect: vi.fn(),
  };
}

function makeShapesActions(isEmpty = true) {
  return {
    isEmpty: vi.fn(() => isEmpty),
    updateLayer: vi.fn(),
    getLayer: vi.fn(),
    addSquare: vi.fn(),
    addEllipse: vi.fn(),
    addArrow: vi.fn(),
    addFreeCurve: vi.fn(),
    addPreset: vi.fn(),
    addText: vi.fn(),
    changeMosaic: vi.fn(),
  };
}

function setupDefaults(overrides: {
  area?: any;
  activeShape?: any;
  activeTool?: any;
  editorText?: any;
  isEmpty?: boolean;
} = {}) {
  const areaActions = makeAreaActions();
  mockAreaAtomUse.mockReturnValue([
    overrides.area ?? { rect: [10, 10, 800, 600], editing: null },
    areaActions,
  ]);

  const setActiveShape = vi.fn();
  mockActiveShapeAtomUse.mockReturnValue([
    overrides.activeShape ?? null,
    setActiveShape,
  ]);

  const shapesActions = makeShapesActions(overrides.isEmpty ?? true);
  mockShapesAtomUseCreation.mockReturnValue(shapesActions);
  mockShapesAtomUse.mockReturnValue([
    { elements: {}, layers: [], mosaic: undefined },
    shapesActions,
  ]);

  mockActiveToolAtomUseData.mockReturnValue(overrides.activeTool ?? null);
  mockEditorTextAtomUseData.mockReturnValue(overrides.editorText ?? { editingId: null });

  const handlers = {
    handleKey: vi.fn(),
    quit: vi.fn(),
    resetAll: vi.fn(),
    sendToMain: vi.fn(() => Promise.resolve()),
  };
  mockStateHandlersUse.mockReturnValue(handlers);

  const copy = vi.fn(() => Promise.resolve(new Blob()));
  const register_elements = vi.fn(() => vi.fn());
  mockEditorHandlersUse.mockReturnValue({ register_elements, copy });

  return { areaActions, setActiveShape, handlers, copy, shapesActions };
}

import { Editor } from '../index';

describe('Editor', () => {
  it('renders without crashing', () => {
    setupDefaults();
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container).toBeDefined();
  });

  it('renders main toolbar when area.editing is null', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: null } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { getByTestId } = render(<Editor bg={bg} />);
    expect(getByTestId('main-toolbar')).toBeDefined();
  });

  it('does not render main toolbar when area.editing is resize', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: 'resize' } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { queryByTestId } = render(<Editor bg={bg} />);
    expect(queryByTestId('main-toolbar')).toBeNull();
  });

  it('renders magnifying when area.editing is resize', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: 'resize' } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { getByTestId } = render(<Editor bg={bg} />);
    expect(getByTestId('magnifying')).toBeDefined();
  });

  it('does not render magnifying when area.editing is null', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: null } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { queryByTestId } = render(<Editor bg={bg} />);
    expect(queryByTestId('magnifying')).toBeNull();
  });

  it('renders measure when area.editing is not resize', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: null } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { getByTestId } = render(<Editor bg={bg} />);
    expect(getByTestId('measure')).toBeDefined();
  });

  it('does not render measure when area.editing is resize', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: 'resize' } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { queryByTestId } = render(<Editor bg={bg} />);
    expect(queryByTestId('measure')).toBeNull();
  });

  it('onPointerDown calls startDrawByMouse when isPainterConfig is true', () => {
    setupDefaults();
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.pointerDown(editorDiv);
    expect(mockStartDrawByMouse).toHaveBeenCalled();
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('onPointerDown calls startMove when no activeTool and isEmpty=true', () => {
    const { areaActions } = setupDefaults({ activeTool: null, isEmpty: true });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.pointerDown(editorDiv);
    expect(areaActions.startMove).toHaveBeenCalled();
  });

  it('onPointerDown does not call startMove when isEmpty=false', () => {
    const { areaActions } = setupDefaults({ activeTool: null, isEmpty: false });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.pointerDown(editorDiv);
    expect(areaActions.startMove).not.toHaveBeenCalled();
  });

  it('onPointerDown clears activeShape when it is set', () => {
    const { setActiveShape } = setupDefaults({ activeShape: { id: 'shape1' } });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.pointerDown(editorDiv);
    expect(setActiveShape).toHaveBeenCalledWith(null);
  });

  it('onPointerDown does nothing if editingId is set', () => {
    const { areaActions } = setupDefaults({ editorText: { editingId: 'text-123' } });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.pointerDown(editorDiv);
    expect(areaActions.startMove).not.toHaveBeenCalled();
  });

  it('editor area gets tabIndex and aria-label when isPainterConfig is true', () => {
    setupDefaults({ activeTool: { type: 'square', color: 'red', size: 4 } });
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    expect(editorDiv.getAttribute('tabindex')).toBe('0');
    expect(editorDiv.getAttribute('aria-label')).toBe('canvas focused');
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('editor area has no tabIndex when isPainterConfig is false', () => {
    setupDefaults({ activeTool: null });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    expect(editorDiv.getAttribute('tabindex')).toBeNull();
  });

  it('onFocus calls updateCursorForKeyboard', () => {
    setupDefaults({ activeTool: { type: 'square', color: 'red', size: 4 } });
    mockIsPainterConfig.mockReturnValue(true);
    mockUpdateCursorForKeyboard.mockReturnValue({
      trackKeydown: vi.fn(() => ({
        setLimit: vi.fn(() => ({ turnOn: vi.fn() })),
      })),
    });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.focus(editorDiv);
    expect(mockUpdateCursorForKeyboard).toHaveBeenCalled();
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('onBlur calls keyboardPainter.turnOff', () => {
    setupDefaults({ activeTool: { type: 'square', color: 'red', size: 4 } });
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    fireEvent.blur(editorDiv);
    expect(mockKeyboardPainterTurnOff).toHaveBeenCalled();
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('getCursor returns move when area.editing=move', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: 'move' } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    expect(editorDiv.style.cursor).toBe('move');
  });

  it('getCursor returns empty/undefined when area.editing=resize', () => {
    setupDefaults({ area: { rect: [10, 10, 800, 600], editing: 'resize' } });
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    const editorDiv = container.querySelectorAll('div')[1];
    expect(editorDiv.style.cursor).toBe('');
  });

  it('getCursor returns text for text tool', () => {
    setupDefaults({ activeTool: { type: 'text', color: 'red', size: 14 } });
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container.querySelectorAll('div')[1].style.cursor).toBe('text');
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('getCursor returns crosshair for square tool', () => {
    setupDefaults({ activeTool: { type: 'square', color: 'red', size: 4 } });
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container.querySelectorAll('div')[1].style.cursor).toBe('crosshair');
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('getCursor returns crosshair for ellipse tool', () => {
    setupDefaults({ activeTool: { type: 'ellipse', color: 'red', size: 4 } });
    mockIsPainterConfig.mockReturnValue(true);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container.querySelectorAll('div')[1].style.cursor).toBe('crosshair');
    mockIsPainterConfig.mockReturnValue(false);
  });

  it('getCursor returns crosshair for arrow/preset tools', () => {
    for (const type of ['arrow', 'preset']) {
      setupDefaults({ activeTool: { type, color: 'red', size: 4 } });
      mockIsPainterConfig.mockReturnValue(true);
      const bg = { css: {}, blur: vi.fn() } as any;
      const { container } = render(<Editor bg={bg} />);
      expect(container.querySelectorAll('div')[1].style.cursor).toBe('crosshair');
      mockIsPainterConfig.mockReturnValue(false);
    }
  });

  it('getCursor returns move when no tool and isEmpty=true', () => {
    setupDefaults({ activeTool: null, isEmpty: true });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container.querySelectorAll('div')[1].style.cursor).toBe('move');
  });

  it('getCursor returns empty string when no tool and isEmpty=false', () => {
    setupDefaults({ activeTool: null, isEmpty: false });
    mockIsPainterConfig.mockReturnValue(false);
    const bg = { css: {}, blur: vi.fn() } as any;
    const { container } = render(<Editor bg={bg} />);
    expect(container.querySelectorAll('div')[1].style.cursor).toBe('');
  });
});

describe('SEditorBox / SEditorBoxMask exports', () => {
  it('SEditorBox is exported as a string', async () => {
    const mod = await import('../index');
    expect(typeof mod.SEditorBox).toBe('string');
  });

  it('SEditorBoxMask is exported as a string', async () => {
    const mod = await import('../index');
    expect(typeof mod.SEditorBoxMask).toBe('string');
  });
});
