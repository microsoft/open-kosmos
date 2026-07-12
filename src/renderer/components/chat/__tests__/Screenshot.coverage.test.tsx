// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for Screenshot.tsx (ScreenshotEntry)
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCapture = vi.hoisted(() => vi.fn());

vi.mock('../../../ipc/screenshot-main', () => ({
  screenshotApi: { capture: mockCapture },
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('lucide-react', () => ({
  RotateCw: (props: any) => <svg data-testid="rotate-icon" className={props.className} />,
  Camera: (props: any) => <svg data-testid="camera-icon" className={props.className} />,
}));

import { ScreenshotEntry } from '../Screenshot';

describe('ScreenshotEntry', () => {
  const onFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders camera icon by default', () => {
    render(<ScreenshotEntry onFile={onFile} />);
    expect(screen.getByTestId('camera-icon')).toBeTruthy();
  });

  it('calls capture and calls onFile with a File on success', async () => {
    const fakeData = [1, 2, 3, 4];
    mockCapture.mockResolvedValueOnce({ type: 'success', data: fakeData });

    render(<ScreenshotEntry onFile={onFile} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(mockCapture).toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/screenshot-\d+\.png/);
  });

  it('does not call onFile when capture returns non-success', async () => {
    mockCapture.mockResolvedValueOnce({ type: 'cancelled' });

    render(<ScreenshotEntry onFile={onFile} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(onFile).not.toHaveBeenCalled();
  });

  it('does not call onFile when capture returns null', async () => {
    mockCapture.mockResolvedValueOnce(null);

    render(<ScreenshotEntry onFile={onFile} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(onFile).not.toHaveBeenCalled();
  });

  it('shows rotate icon while processing and re-enables button after', async () => {
    let resolveCapture: (val: any) => void;
    mockCapture.mockReturnValueOnce(
      new Promise((res) => { resolveCapture = res; }),
    );

    render(<ScreenshotEntry onFile={onFile} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    // During processing
    expect(screen.getByTestId('rotate-icon')).toBeTruthy();
    expect(btn).toBeDisabled();

    await act(async () => {
      resolveCapture!({ type: 'success', data: [0, 1, 2] });
    });

    // After processing
    expect(screen.getByTestId('camera-icon')).toBeTruthy();
    expect(btn).not.toBeDisabled();
  });

  it('ignores calls to startScreenshot when already processing (isProcessing guard)', async () => {
    let resolveCapture: (val: any) => void;
    mockCapture.mockReturnValueOnce(
      new Promise((res) => { resolveCapture = res; }),
    );

    render(<ScreenshotEntry onFile={onFile} />);
    const btn = screen.getByRole('button');

    // Start processing - click once (not captured yet, isProcessing=false -> true)
    fireEvent.click(btn);
    // Now button is disabled & isProcessing=true
    expect(btn).toBeDisabled();

    // Click again with fireEvent (bypasses disabled attribute, calls onClick)
    // The startScreenthot function should return early because isProcessing=true
    fireEvent.click(btn);
    // capture should only have been called once (second click returned early)
    expect(mockCapture).toHaveBeenCalledTimes(1);

    await act(async () => { resolveCapture!({ type: 'cancelled' }); });
  });
});
