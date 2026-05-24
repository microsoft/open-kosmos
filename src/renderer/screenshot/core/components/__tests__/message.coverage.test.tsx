/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

vi.mock('../common/styled', () => ({
  css: () => 'mock-class',
  keyframes: () => 'mock-keyframe',
}));
vi.mock('../common/svg', () => ({
  OKIcon: ({ size, color }: any) => <svg data-testid="ok-icon" />,
}));
vi.mock('../common/utils/time', () => ({
  sleep: (ms: number) => Promise.resolve(),
}));
vi.mock('./hooks', () => ({
  useStopMove: () => React.createRef(),
}));

describe('message module', () => {
  it('Message component renders via portal', async () => {
    const mod = await import('../message');
    const { Message } = mod;
    act(() => {
      render(<Message text="Saved" type="success" />);
    });
    expect(document.body.textContent).toContain('Saved');
  });

  it('Message renders loading type', async () => {
    const mod = await import('../message');
    const { Message } = mod;
    act(() => {
      render(<Message text="Loading..." type="loading" />);
    });
    expect(document.body.textContent).toContain('Loading...');
  });

  it('Message renders error type', async () => {
    const mod = await import('../message');
    const { Message } = mod;
    act(() => {
      render(<Message text="Error" type="error" />);
    });
    expect(document.body.textContent).toContain('Error');
  });

  it('Message renders with modal=true', async () => {
    const mod = await import('../message');
    const { Message } = mod;
    act(() => {
      render(<Message text="Modal msg" type="success" modal={true} />);
    });
    expect(document.body.textContent).toContain('Modal msg');
  });

  it('message() function resolves', async () => {
    const mod = await import('../message');
    await expect(mod.message({ text: 'Done', type: 'success', duration: 0 })).resolves.toBeUndefined();
  });
});
