/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import StickArea, { StickRef } from '../stick-area';

describe('StickArea', () => {
  it('renders children', () => {
    const { getByText } = render(
      <StickArea area={[0, 0, 100, 100]} gap={8}>
        <span>hello</span>
      </StickArea>
    );
    expect(getByText('hello')).toBeTruthy();
  });

  it('renders with position absolute style', () => {
    const { container } = render(
      <StickArea area={[0, 0, 100, 100]} gap={8}>
        <span>content</span>
      </StickArea>
    );
    const div = container.firstChild as HTMLElement;
    expect(div.style.position).toBe('absolute');
  });

  it('exposes layout via ref', () => {
    const ref = React.createRef<StickRef>();
    render(
      <StickArea ref={ref} area={[0, 0, 100, 100]} gap={8}>
        <span>content</span>
      </StickArea>
    );
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.layout).toBe('function');
    // Call layout - should not throw
    expect(() => act(() => { ref.current?.layout(); })).not.toThrow();
  });

  it('updates on area change', () => {
    const { rerender } = render(
      <StickArea area={[0, 0, 100, 100]} gap={8}>content</StickArea>
    );
    rerender(
      <StickArea area={[50, 50, 200, 200]} gap={8}>content</StickArea>
    );
  });

  it('passes extra HTML attributes', () => {
    const { container } = render(
      <StickArea area={[0, 0, 100, 100]} gap={8} data-testid="stick">
        content
      </StickArea>
    );
    expect(container.querySelector('[data-testid="stick"]')).toBeTruthy();
  });
});
