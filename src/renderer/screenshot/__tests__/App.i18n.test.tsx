/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18nState = vi.hoisted(() => ({
  language: 'en' as 'en' | 'zh-CN',
}));
const initDataState = vi.hoisted(() => ({
  data: {
    id: 'shot-1',
    bounds: { width: 100, height: 80 },
    frames: [] as unknown[] | undefined,
  },
}));
const screenshotApiMock = vi.hoisted(() => ({
  selectionStart: vi.fn(),
  close: vi.fn(),
  sendToMain: vi.fn(),
  saveToFile: vi.fn(),
}));
const capturedProps = vi.hoisted(() => ({
  current: null as null | ComponentProps<typeof import('../core').Screenshot>,
}));

vi.mock('../../lib/i18n/useI18n', () => ({
  useI18n: () => ({ language: i18nState.language, setLanguage: vi.fn(), t: (key: string) => key }),
}));

vi.mock('../../ipc/screenshot-overlay', () => ({
  screenshotApi: screenshotApiMock,
}));

vi.mock('../constant', () => ({
  displayId: 1,
  initData: {
    then: (resolve: (value: typeof initDataState.data) => unknown) => Promise.resolve(resolve(initDataState.data)),
  },
}));

vi.mock('../core', async () => {
  const { getString } = await import('../core/common/localString');
  return {
    Screenshot: (props: ComponentProps<typeof import('../core').Screenshot>) => {
      capturedProps.current = props;
      return <div data-testid="screenshot-save-label">{getString('save')}</div>;
    },
  };
});

async function loadApp() {
  const { setScreenshotStringLanguage } = await import('../core/common/localString');
  setScreenshotStringLanguage(null);
  return import('../index');
}

describe('screenshot App i18n bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    i18nState.language = 'en';
    initDataState.data = {
      id: 'shot-1',
      bounds: { width: 100, height: 80 },
      frames: [],
    };
    capturedProps.current = null;
  });

  afterEach(async () => {
    const { setScreenshotStringLanguage } = await import('../core/common/localString');
    setScreenshotStringLanguage(null);
  });

  it('refreshes getString() callers when the active language changes', async () => {
    const { App } = await loadApp();

    const { rerender } = render(<App />);
    expect(screen.getByTestId('screenshot-save-label').textContent).toBe('Save');

    i18nState.language = 'zh-CN';
    rerender(<App />);

    expect(screen.getByTestId('screenshot-save-label').textContent).toBe('保存');
  });

  it('passes screenshot source and hooks to the core component', async () => {
    const frames = [{ url: 'https://example.test/frame' }];
    initDataState.data = {
      id: 'shot-2',
      bounds: { width: 200, height: 120 },
      frames,
    };
    const { App } = await loadApp();

    render(<App />);
    expect(capturedProps.current).not.toBeNull();

    await expect(capturedProps.current!.source).resolves.toEqual({
      url: 'screenshot://image/shot-2',
      displayWidth: 200,
      displayHeight: 120,
      frames,
    });

    capturedProps.current!.hooks.startSelect();
    capturedProps.current!.hooks.closeWindow();
    await capturedProps.current!.hooks.sendToMain([10, 20, 30, 40], Buffer.from('send'));
    await capturedProps.current!.hooks.saveToFile([1, 2, 3, 4], Buffer.from('save'));

    expect(screenshotApiMock.selectionStart).toHaveBeenCalledWith(1);
    expect(screenshotApiMock.close).toHaveBeenCalled();
    expect(screenshotApiMock.sendToMain).toHaveBeenCalledWith(
      1,
      { startX: 10, startY: 20, endX: 40, endY: 60, width: 30, height: 40 },
      Buffer.from('send'),
    );
    expect(screenshotApiMock.saveToFile).toHaveBeenCalledWith(
      1,
      { startX: 1, startY: 2, endX: 4, endY: 6, width: 3, height: 4 },
      Buffer.from('save'),
    );
  });

  it('falls back to an empty frame list when init data has no frames', async () => {
    initDataState.data = {
      id: 'shot-3',
      bounds: { width: 10, height: 20 },
      frames: undefined,
    };
    const { App } = await loadApp();

    render(<App />);

    await expect(capturedProps.current!.source).resolves.toEqual({
      url: 'screenshot://image/shot-3',
      displayWidth: 10,
      displayHeight: 20,
      frames: [],
    });
  });
});
