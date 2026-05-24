/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Patch window before any modules load
(window as any).electronScreenshot = { invoke: vi.fn() };

vi.mock('@shared/ipc/screenshot', () => ({
  renderToMain: {
    bindRender: vi.fn(() => ({})),
  },
}));

vi.mock('../presets', () => ({
  PresetPainter: class extends React.Component { render() { return <div data-testid="preset-painter" />; } },
  PresetShape: ({ model }: any) => <div data-testid="preset-shape" />,
  NumberTextStyle: {},
}));
vi.mock('../arrow', () => ({
  ArrowPainter: class extends React.Component { render() { return <div />; } },
  ArrowShape: ({ model }: any) => <div data-testid="arrow-shape" />,
}));
vi.mock('../text', () => ({
  TextPainter: class extends React.Component { render() { return <div />; } },
  TextShape: ({ model }: any) => <div data-testid="text-shape" />,
  ShapeTextStyle: {},
}));
vi.mock('../ellipse', () => ({
  EllipsePainter: class extends React.Component { render() { return <div />; } },
  EllipseShape: ({ model }: any) => <div data-testid="ellipse-shape" />,
}));
vi.mock('../free-curve', () => ({
  FreeCurvePainter: class extends React.Component { render() { return <div />; } },
  FreeCurveShape: ({ model }: any) => <div data-testid="freecurve-shape" />,
}));
vi.mock('../mosaic', () => ({
  default: class extends React.Component { render() { return <div />; } },
}));
vi.mock('../square', () => ({
  SquarePainter: class extends React.Component { render() { return <div />; } },
  SquareShape: ({ model }: any) => <div data-testid="square-shape" />,
}));
vi.mock('../../../state', () => ({
  activeShapeAtom: { use: () => [{ id: 'a1' }, vi.fn()] },
  activeToolAtom: { useCreation: () => vi.fn() },
  shapesAtom: {
    useCreation: () => ({
      updateLayer: vi.fn(),
      getLayer: vi.fn(() => ({ type: 'square', rect: [0, 0, 10, 10] })),
    }),
  },
}));
vi.mock('../toolbar', () => ({
  getConfigOfShape: vi.fn(() => null),
}));

describe('shape/index', () => {
  it('createPainters returns refs for all shape types', async () => {
    const { createPainters } = await import('../index');
    const painters = createPainters();
    expect(painters.square).toBeDefined();
    expect(painters.ellipse).toBeDefined();
    expect(painters.arrow).toBeDefined();
    expect(painters.pencil).toBeDefined();
    expect(painters.mosaic).toBeDefined();
    expect(painters.text).toBeDefined();
    expect(painters.preset).toBeDefined();
  });

  it('ShapeLayers renders square shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { a1: { id: 'a1', type: 'square', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['a1']} elements={elements as any} />
    );
    expect(getByTestId('square-shape')).toBeTruthy();
  });

  it('ShapeLayers renders ellipse shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { e1: { id: 'e1', type: 'ellipse', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['e1']} elements={elements as any} />
    );
    expect(getByTestId('ellipse-shape')).toBeTruthy();
  });

  it('ShapeLayers renders text shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { t1: { id: 't1', type: 'text', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['t1']} elements={elements as any} />
    );
    expect(getByTestId('text-shape')).toBeTruthy();
  });

  it('ShapeLayers renders arrow shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { r1: { id: 'r1', type: 'arrow', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['r1']} elements={elements as any} />
    );
    expect(getByTestId('arrow-shape')).toBeTruthy();
  });

  it('ShapeLayers renders freeCurve shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { f1: { id: 'f1', type: 'freeCurve', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['f1']} elements={elements as any} />
    );
    expect(getByTestId('freecurve-shape')).toBeTruthy();
  });

  it('ShapeLayers renders preset shape', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { p1: { id: 'p1', type: 'preset', rect: [0, 0, 10, 10] } };
    const { getByTestId } = render(
      <ShapeLayers area={area} layers={['p1']} elements={elements as any} />
    );
    expect(getByTestId('preset-shape')).toBeTruthy();
  });

  it('ShapeLayers renders null for unknown type', async () => {
    const { ShapeLayers } = await import('../index');
    const area: [number, number, number, number] = [0, 0, 500, 500];
    const elements = { x1: { id: 'x1', type: 'unknown', rect: [0, 0, 10, 10] } };
    const { container } = render(
      <ShapeLayers area={area} layers={['x1']} elements={elements as any} />
    );
    expect(container.firstChild).toBeNull();
  });
});
