/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LazyRenderItem from '../LazyRenderItem';

let observers: Array<{
  callback: (entries: Array<{ isIntersecting: boolean }>) => void;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
}> = [];

const OriginalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  observers = [];
  // @ts-expect-error mock
  globalThis.IntersectionObserver = class {
    callback: any;
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    constructor(callback: any) {
      this.callback = callback;
      observers.push({ callback, disconnect: this.disconnect, observe: this.observe });
    }
  };
});

afterEach(() => {
  globalThis.IntersectionObserver = OriginalIntersectionObserver;
});

function triggerIntersection(isIntersecting: boolean) {
  const last = observers[observers.length - 1];
  if (last) {
    act(() => {
      last.callback([{ isIntersecting } as IntersectionObserverEntry]);
    });
  }
}

describe('LazyRenderItem', () => {
  it('renders children immediately when isNearBottom is true', () => {
    render(
      <LazyRenderItem isNearBottom={true}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(observers).toHaveLength(0);
  });

  it('renders a placeholder when isNearBottom is false', () => {
    const { container } = render(
      <LazyRenderItem isNearBottom={false}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.queryByTestId('child')).toBeNull();
    const placeholder = container.firstElementChild as HTMLElement;
    expect(placeholder.style.minHeight).toBe('48px');
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledTimes(1);
  });

  it('renders children after IntersectionObserver triggers', () => {
    render(
      <LazyRenderItem isNearBottom={false}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.queryByTestId('child')).toBeNull();

    triggerIntersection(true);

    expect(screen.getByTestId('child')).toBeDefined();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('does not render children for non-intersecting callback', () => {
    render(
      <LazyRenderItem isNearBottom={false}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );

    triggerIntersection(false);

    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('disconnects observer on unmount', () => {
    const { unmount } = render(
      <LazyRenderItem isNearBottom={false}>
        <span>Hello</span>
      </LazyRenderItem>
    );
    expect(observers).toHaveLength(1);
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('renders children when isNearBottom changes from false to true without intersection', () => {
    const { rerender } = render(
      <LazyRenderItem isNearBottom={false}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.queryByTestId('child')).toBeNull();

    rerender(
      <LazyRenderItem isNearBottom={true}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('keeps children rendered when isNearBottom changes from true to false', () => {
    const { rerender } = render(
      <LazyRenderItem isNearBottom={true}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.getByTestId('child')).toBeDefined();

    rerender(
      <LazyRenderItem isNearBottom={false}>
        <span data-testid="child">Hello</span>
      </LazyRenderItem>
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });
});
