// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCapture = vi.hoisted(() => vi.fn());

vi.mock('../../../ipc/screenshot-main', () => ({
  screenshotApi: { capture: mockCapture },
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

vi.mock('lucide-react', () => ({
  RotateCw: () => <svg data-testid="rotate-icon" />,
  Camera: () => <svg data-testid="camera-icon" />,
}));

import { ScreenshotEntry } from '../Screenshot';

describe('ScreenshotEntry supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early from the handler when processing is already in progress', async () => {
    let resolveCapture: (value: unknown) => void;
    mockCapture.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );

    render(<ScreenshotEntry onFile={vi.fn()} />);

    const button = screen.getByRole('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByTestId('rotate-icon')).toBeInTheDocument();

    button.disabled = false;
    fireEvent.click(button);

    expect(mockCapture).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCapture?.({ type: 'cancelled' });
    });
  });
});
