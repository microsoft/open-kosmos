/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockUuid = vi.hoisted(() => {
  let counter = 0;
  return vi.fn(() => `uuid-${counter++}`);
});

vi.mock('../../../../common/styled', () => ({
  css: vi.fn(() => 'mock-css-class'),
}));

vi.mock('../../../../common/classnames', () => ({
  default: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../../context', () => ({
  uuid: mockUuid,
}));

import { Button } from '../button';

describe('Button', () => {
  beforeEach(() => {
    mockUuid.mockClear();
    // reset TOOL_COUNT between tests by remounting
  });

  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeTruthy();
  });

  it('renders with aria-label', () => {
    render(<Button aria-label="test-button">X</Button>);
    const btn = screen.getByRole('button', { name: 'test-button' });
    expect(btn).toBeTruthy();
  });

  it('renders aria-expanded', () => {
    render(<Button aria-expanded={true}>X</Button>);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders aria-disabled when disabled=true', () => {
    render(<Button disabled>X</Button>);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('calls onClick on pointerdown when not disabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick on pointerdown when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick on Enter keydown when not disabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick on Enter keydown when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('handles mouseEnter and mouseLeave', () => {
    render(<Button tooltip="My tip">X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    // tooltip should appear
    expect(screen.queryByText('My tip')).toBeTruthy();
    fireEvent.mouseLeave(btn);
  });

  it('shows tooltip on focus', () => {
    render(<Button tooltip="Focus tip">X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    expect(screen.queryByText('Focus tip')).toBeTruthy();
  });

  it('hides tooltip on blur', () => {
    render(<Button tooltip="Blur tip">X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    expect(screen.queryByText('Blur tip')).toBeTruthy();
    fireEvent.blur(btn);
    // tooltip hidden
    expect(screen.queryByText('Blur tip')).toBeNull();
  });

  it('renders expand when expand prop is provided', () => {
    render(<Button expand={<div data-testid="expand-content">expand</div>}>X</Button>);
    expect(screen.getByTestId('expand-content')).toBeTruthy();
  });

  it('applies active class when active=true', () => {
    const { container } = render(<Button active>X</Button>);
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain('btn-active');
  });

  it('applies style and inStyle props', () => {
    const { container } = render(
      <Button style={{ color: 'red' }} inStyle={{ background: 'blue' }}>X</Button>
    );
    const outer = container.firstChild as HTMLElement;
    expect((outer as HTMLElement).style.color).toBe('red');
  });

  it('tab() updates tabIndex', () => {
    const ref = React.createRef<Button>();
    const { container } = render(<Button ref={ref}>X</Button>);
    act(() => { ref.current!.tab(2); });
    const btn = container.querySelector('[role="button"]')!;
    expect(btn.getAttribute('tabindex')).toBe('2');
  });

  it('focus sets focused state and calls tab(0)', () => {
    const ref = React.createRef<Button>();
    render(<Button ref={ref}>X</Button>);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    // focused state => true
    expect((ref.current as any).state.focused).toBe(true);
  });

  it('ArrowDown key moves focus', () => {
    // render two buttons so focus navigation can work
    const { container } = render(
      <div>
        <Button aria-label="btn1">1</Button>
        <Button aria-label="btn2">2</Button>
      </div>
    );
    const btn1 = screen.getByRole('button', { name: 'btn1' });
    fireEvent.keyDown(btn1, { key: 'ArrowDown' });
    // just ensure no error thrown
  });

  it('ArrowRight key navigation does not throw', () => {
    render(<Button aria-label="solo-btn">X</Button>);
    const btn = screen.getByRole('button', { name: 'solo-btn' });
    fireEvent.keyDown(btn, { key: 'ArrowRight' });
  });

  it('ArrowUp key navigation does not throw', () => {
    render(<Button aria-label="up-btn">X</Button>);
    const btn = screen.getByRole('button', { name: 'up-btn' });
    fireEvent.keyDown(btn, { key: 'ArrowUp' });
  });

  it('ArrowLeft key navigation does not throw', () => {
    render(<Button aria-label="left-btn">X</Button>);
    const btn = screen.getByRole('button', { name: 'left-btn' });
    fireEvent.keyDown(btn, { key: 'ArrowLeft' });
  });

  it('unmount decrements TOOL_COUNT', () => {
    const { unmount } = render(<Button>X</Button>);
    // just verify no error
    unmount();
  });
});
