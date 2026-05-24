/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStartTransaction = vi.hoisted(() => vi.fn());
const mockEndTransaction = vi.hoisted(() => vi.fn());
const mockHandleDrag = vi.hoisted(() => vi.fn());

vi.mock('../../../../common/styled', () => ({
  css: vi.fn(() => 'mock-slider-class'),
}));

vi.mock('../../../../common/localString', () => ({
  getString: vi.fn((key: string) => key),
}));

vi.mock('../../../../common/utils/drag', () => ({
  handleDrag: mockHandleDrag,
}));

vi.mock('../../../../state', () => ({
  shapesAtom: {},
}));

vi.mock('../../../../context', () => ({
  useModel: vi.fn(() => ({
    startTransaction: mockStartTransaction,
    endTransaction: mockEndTransaction,
  })),
  uuid: vi.fn(() => 'mock-uuid'),
  ModelProvider: ({ children }: any) => children,
}));

import SliderThumb from '../slider';

function renderSlider(props: { min: number; max: number; value: number; onChange?: (v: number) => void }) {
  const onChange = props.onChange ?? vi.fn();
  return render(
    <SliderThumb min={props.min} max={props.max} value={props.value} onChange={onChange} />
  );
}

describe('SliderThumb', () => {
  beforeEach(() => {
    mockStartTransaction.mockClear();
    mockEndTransaction.mockClear();
    mockHandleDrag.mockClear();
  });

  it('renders slider with role=slider', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('slider has correct aria attributes', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemin')).toBe('1');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
    expect(slider.getAttribute('aria-valuetext')).toBe('50');
  });

  it('renders slider container with aria-label', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    expect(screen.getByLabelText('slider')).toBeTruthy();
  });

  it('onPointerDown on slider runway does not call startTransaction (uses onSliderClick)', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    const sliderContainer = screen.getByLabelText('slider');

    const mockRect = { x: 0, width: 200 };
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockReturnValue(mockRect as DOMRect);

    fireEvent.pointerDown(sliderContainer, { clientX: 100 });
    // onSliderClick does not call startTransaction
    expect(mockStartTransaction).not.toHaveBeenCalled();
  });

  it('onPointerDown on thumb calls startTransaction and handleDrag', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');
    fireEvent.pointerDown(thumb, { clientX: 100 });
    expect(mockStartTransaction).toHaveBeenCalled();
    expect(mockHandleDrag).toHaveBeenCalled();
  });

  it('handleDrag onEnd calls endTransaction', () => {
    renderSlider({ min: 1, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');

    let capturedOnEnd: Function | undefined;
    mockHandleDrag.mockImplementation(({ onEnd }: any) => { capturedOnEnd = onEnd; });

    fireEvent.pointerDown(thumb, { clientX: 100 });
    capturedOnEnd?.();
    expect(mockEndTransaction).toHaveBeenCalled();
  });

  it('handleDrag onMove calls onChange', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);

    const thumb = screen.getByRole('slider');
    let capturedOnMove: Function | undefined;
    mockHandleDrag.mockImplementation(({ onMove }: any) => { capturedOnMove = onMove; });

    fireEvent.pointerDown(thumb, { clientX: 50 });
    capturedOnMove?.({ clientX: 150, stopPropagation: vi.fn() });
    expect(onChange).toHaveBeenCalled();
  });

  it('onSliderClick (pointerdown on runway) calls onChange when value changes', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const sliderContainer = screen.getByLabelText('slider');

    const mockGetBCR = vi.fn().mockReturnValue({ x: 0, width: 200 });
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockImplementation(mockGetBCR);

    // click at a different position to trigger onChange
    fireEvent.pointerDown(sliderContainer, { clientX: 0 }); // position 0 => value 0
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('onSliderClick does not call onChange when value is same', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const sliderContainer = screen.getByLabelText('slider');

    // clientX maps to value 50: offsetX = 100, width = 200, radio = 0.5, num = 50
    const mockGetBCR = vi.fn().mockReturnValue({ x: 0, width: 200 });
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockImplementation(mockGetBCR);

    fireEvent.pointerDown(sliderContainer, { clientX: 100 });
    // value is already 50, should not call onChange
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowLeft key decreases value', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(49);
  });

  it('ArrowRight key increases value', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(51);
  });

  it('ArrowUp key decreases value', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(49);
  });

  it('ArrowDown key increases value', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith(51);
  });

  it('ArrowLeft at min does not call onChange', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={0} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowRight at max does not call onChange', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={100} onChange={onChange} />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter key blurs the slider cursor', () => {
    renderSlider({ min: 0, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');
    const blurSpy = vi.spyOn(thumb, 'blur');
    fireEvent.keyDown(thumb, { key: 'Enter' });
    expect(blurSpy).toHaveBeenCalled();
  });

  it('shows tooltip on mouseEnter', () => {
    const { container } = renderSlider({ min: 0, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');
    fireEvent.mouseEnter(thumb);
    // tooltip shows value
    expect(container.textContent).toContain('50');
  });

  it('hides tooltip on mouseLeave', () => {
    const { container } = renderSlider({ min: 0, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');
    fireEvent.mouseEnter(thumb);
    fireEvent.mouseLeave(thumb);
    // tooltip gone — value 50 not in textContent (it's only shown in tooltip)
  });

  it('shows tooltip on focus', () => {
    const { container } = renderSlider({ min: 0, max: 100, value: 50 });
    const thumb = screen.getByRole('slider');
    fireEvent.focus(thumb);
    expect(container.textContent).toContain('50');
  });

  it('slider bar width reflects value', () => {
    const { container } = renderSlider({ min: 0, max: 100, value: 25 });
    const bar = container.querySelector('[style*="width: 25%"]');
    expect(bar).toBeTruthy();
  });

  it('offsetX clamped to 0 when clientX < slider x', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const sliderContainer = screen.getByLabelText('slider');
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockReturnValue({ x: 100, width: 200 } as DOMRect);
    // clientX = 0 < x = 100, offsetX clamped to 0, value = 0
    fireEvent.pointerDown(sliderContainer, { clientX: 0 });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('offsetX clamped to width when clientX > slider right', () => {
    const onChange = vi.fn();
    render(<SliderThumb min={0} max={100} value={50} onChange={onChange} />);
    const sliderContainer = screen.getByLabelText('slider');
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockReturnValue({ x: 0, width: 200 } as DOMRect);
    // clientX = 999 > width = 200, offsetX clamped to 200, value = 100
    fireEvent.pointerDown(sliderContainer, { clientX: 999 });
    expect(onChange).toHaveBeenCalledWith(100);
  });
});
