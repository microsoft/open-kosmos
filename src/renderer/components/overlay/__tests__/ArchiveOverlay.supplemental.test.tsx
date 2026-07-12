// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WithStore } from '@/atom';

const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: { refresh: mockRefresh, getCache: vi.fn() },
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => `${key}:${params?.name ?? params?.error ?? ''}`,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

import { ArchiveOverlay, ArchiveConfirmAtom } from '../ArchiveOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function FallbackConfirmHarness() {
  const [, actions] = ArchiveConfirmAtom.use();
  return (
    <>
      <button data-testid="open" onClick={() => actions.show('chat-1', undefined as any)} type="button">
        open
      </button>
      <button
        data-testid="confirm"
        onClick={() => actions.confirm({ showSuccess: mockShowSuccess, showError: mockShowError } as any)}
        type="button"
      >
        confirm
      </button>
    </>
  );
}

describe('ArchiveOverlay supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        profile: {
          archiveChatConfig: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    });
  });

  it('uses the fallback translator and an empty agent name when confirm is triggered directly', async () => {
    wrap(
      <>
        <FallbackConfirmHarness />
        <ArchiveOverlay />
      </>,
    );

    fireEvent.click(screen.getByTestId('open'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm'));
    });

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('\"\" archived successfully');
    });
    expect(mockRefresh).toHaveBeenCalled();
  });
});
