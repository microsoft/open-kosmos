/** @vitest-environment happy-dom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateRoot = vi.hoisted(() => vi.fn());
const mockRender = vi.hoisted(() => vi.fn());
const mockDebug = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
}));

vi.mock('../screenshot/index', () => ({
  App: () => <div data-testid="screenshot-app" />,
}));

vi.mock('../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: mockDebug, error: mockError }),
}));

describe('screenshot renderer entry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCreateRoot.mockReturnValue({ render: mockRender });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts the screenshot app under WithStore when the root exists', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await import('../screenshot');

    expect(mockCreateRoot).toHaveBeenCalledWith(root);
    expect(mockRender).toHaveBeenCalledWith(expect.any(Object));
    expect(mockDebug).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('logs an error when the root element is missing', async () => {
    await import('../screenshot');

    expect(mockCreateRoot).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalled();
  });
});
