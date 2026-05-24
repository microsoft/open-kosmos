/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Mock lodash throttle to call immediately
vi.mock('lodash/throttle', () => ({
  default: (fn: Function) => fn,
}));

// Mock styled
vi.mock('./common/styled', () => ({
  css: vi.fn(() => 'mocked-class'),
}));

vi.mock('../common/styled', () => ({
  css: vi.fn(() => 'mocked-class'),
}));

vi.mock('./common/utils/color', () => ({
  isBlack: vi.fn(() => false),
  isDark: vi.fn(() => false),
}));

vi.mock('../common/utils/color', () => ({
  isBlack: vi.fn(() => false),
  isDark: vi.fn(() => false),
}));

import Magnifying from '../magnifying';

const makeBg = (overrides: any = {}) => ({
  url: 'data:image/png;base64,abc',
  width: 800,
  height: 600,
  getColor: vi.fn(() => [255, 0, 0, 255]),
  ...overrides,
});

describe('Magnifying', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there is no position', () => {
    const { container } = render(<Magnifying bg={makeBg()} />);
    // No magnifying box since no mouse move happened
    expect(container.firstChild).toBeNull();
  });

  it('shows magnifying box after mouse move', () => {
    const { container } = render(<Magnifying bg={makeBg()} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200 }));
    });
    const box = container.querySelector('div');
    expect(box).toBeTruthy();
  });

  it('hides when mouse leaves document', () => {
    const { container } = render(<Magnifying bg={makeBg()} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200 }));
    });
    expect(container.querySelector('div')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseleave'));
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders with custom size and zoom props', () => {
    const { container } = render(<Magnifying bg={makeBg()} size={150} zoom={6} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
    });
    const box = container.querySelector('div') as HTMLElement;
    expect(box?.style.width).toBe('150px');
    expect(box?.style.height).toBe('150px');
  });

  it('renders MagnifyingInfo with area dimensions', () => {
    const area: [number, number, number, number] = [0, 0, 300, 200];
    const { container } = render(<Magnifying bg={makeBg()} area={area} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    });
    expect(container.textContent).toContain('300 × 200');
  });

  it('does not render MagnifyingInfo when area is not provided', () => {
    const { container } = render(<Magnifying bg={makeBg()} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    });
    expect(container.textContent).not.toContain('×');
  });

  it('removes event listeners on unmount', () => {
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Magnifying bg={makeBg()} />);
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
  });

  it('renders cross divs when visible', () => {
    const { container } = render(<Magnifying bg={makeBg()} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));
    });
    // cross: 4 divs with specific class names
    const upCross = container.querySelector('.magnify-cross-up');
    expect(upCross).toBeTruthy();
  });

  it('calls getColor on mouse move', () => {
    const getColor = vi.fn(() => [0, 0, 0, 255]);
    const bg = makeBg({ getColor });
    render(<Magnifying bg={bg} />);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 55, clientY: 77 }));
    });
    expect(getColor).toHaveBeenCalledWith(55, 77);
  });
});
