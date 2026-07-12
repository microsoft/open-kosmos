// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Supplementary coverage tests for ModifyMsgConfimOverlay.tsx —
 * targets branches not covered by the existing coverage test.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let capturedOnOpenChange: ((open: boolean) => void) | undefined;
const mockUpdateConfirmationSettings = vi.fn(() => Promise.resolve({ success: true }));
const i18nState = vi.hoisted(() => {
  const makeTranslator = (language: 'en' | 'zh') => (key: string) =>
    language === 'zh' ? `zh:${key}` : key;
  const listeners = new Set<() => void>();
  const state = {
    language: 'en' as 'en' | 'zh',
    listeners,
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
    setLanguage(language: 'en' | 'zh') {
      state.language = language;
      listeners.forEach((listener) => listener());
    },
  };
  return state;
});

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => {
    capturedOnOpenChange = onOpenChange;
    return open ? <div data-testid="dialog">{children}</div> : null;
  },
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

let mockProfileData: any = {
  data: {
    profile: {
      alias: 'testuser',
      confirmationSettings: { inlineEditRegenerate: { skipConfirmation: false } },
    },
  },
};

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => mockProfileData,
}));

vi.mock('@/lib/i18n/useI18n', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    useI18n: () => {
      const [, forceRender] = ReactActual.useReducer((value: number) => value + 1, 0);
      ReactActual.useEffect(() => {
        const listener = () => forceRender();
        i18nState.listeners.add(listener);
        return () => {
          i18nState.listeners.delete(listener);
        };
      }, []);
      return { t: i18nState.translators[i18nState.language] };
    },
  };
});

import ModifyMsgConfirmOverlay from '../ModifyMsgConfimOverlay';

describe('ModifyMsgConfirmOverlay — supplementary branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnOpenChange = undefined;
    i18nState.language = 'en';
    (window as any).electronAPI = {
      profile: { updateConfirmationSettings: mockUpdateConfirmationSettings },
    };
    mockProfileData = {
      data: {
        profile: {
          alias: 'testuser',
          confirmationSettings: { inlineEditRegenerate: { skipConfirmation: false } },
        },
      },
    };
  });

  it('auto-dispatches result and does NOT open dialog when skipConfirmation=true', async () => {
    mockProfileData.data.profile.confirmationSettings.inlineEditRegenerate.skipConfirmation = true;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-skip', title: 'Skip me' },
      }));
    });

    // Dialog should NOT open
    expect(screen.queryByTestId('dialog')).toBeNull();
    // Should auto-dispatch confirmed=true
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chatInput:confirmInlineEditResult' }),
    );
  });

  it('does not re-subscribe the request listener when only language changes', async () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    render(<ModifyMsgConfirmOverlay />);

    expect(addListenerSpy.mock.calls.filter(([event]) => event === 'chatInput:confirmInlineEditRequest')).toHaveLength(1);

    addListenerSpy.mockClear();
    removeListenerSpy.mockClear();

    act(() => {
      i18nState.setLanguage('zh');
    });

    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(removeListenerSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-language-switch' },
      }));
    });

    expect(screen.getByText('zh:overlay.inlineEdit.confirmAction')).toBeTruthy();
    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('calls updateConfirmationSettings when confirmed + dontAskAgain + alias', async () => {
    const user = userEvent.setup();
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-dontask', title: 'Confirm', description: 'Desc' },
      }));
    });

    // Verify mock is in place
    expect((window as any).electronAPI?.profile?.updateConfirmationSettings).toBe(mockUpdateConfirmationSettings);

    // Click the checkbox to check it (dontAskAgain = true)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Click Confirm — updateConfirmationSettings is called inside the state updater
    await user.click(screen.getByText('common.confirm'));

    expect(mockUpdateConfirmationSettings).toHaveBeenCalledWith('testuser', {
      inlineEditRegenerate: { skipConfirmation: true },
    });
  });

  it('does NOT call updateConfirmationSettings when confirmed but dontAskAgain=false', async () => {
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-nodontask', title: 'Confirm' },
      }));
    });

    // Do NOT check dontAskAgain
    fireEvent.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
    expect(mockUpdateConfirmationSettings).not.toHaveBeenCalled();
  });

  it('closes dialog when backdrop triggered (onOpenChange(false))', async () => {
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-backdrop', title: 'Test' },
      }));
    });

    expect(screen.getByTestId('dialog')).toBeTruthy();
    // Trigger onOpenChange(false) directly (simulates backdrop or Escape)
    await act(async () => {
      capturedOnOpenChange?.(false);
    });
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
  });

  it('handles null profileData gracefully', async () => {
    mockProfileData = null;
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-null', title: 'Test' },
      }));
    });

    // Should open dialog
    expect(screen.getByTestId('dialog')).toBeTruthy();
    // Confirm without alias - updateConfirmationSettings should NOT be called
    const checkbox = screen.getByRole('checkbox');
    fireEvent.change(checkbox, { target: { checked: true } });
    fireEvent.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
    expect(mockUpdateConfirmationSettings).not.toHaveBeenCalled();
  });

  it('handles profileData with no alias', async () => {
    mockProfileData = {
      data: { profile: { alias: undefined, confirmationSettings: { inlineEditRegenerate: { skipConfirmation: false } } } },
    };
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-noalias', title: 'Test' },
      }));
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.change(checkbox, { target: { checked: true } });
    fireEvent.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
    // No alias → updateConfirmationSettings NOT called
    expect(mockUpdateConfirmationSettings).not.toHaveBeenCalled();
  });

  it('opens dialog with default title when no title provided', async () => {
    render(<ModifyMsgConfirmOverlay />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-notitle' },
      }));
    });

    // Should open with default title key
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(screen.getByText('overlay.inlineEdit.confirmAction')).toBeTruthy();
  });
});
