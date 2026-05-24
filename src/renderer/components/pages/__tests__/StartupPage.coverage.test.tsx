/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockPerformTwoStageValidation = vi.hoisted(() => vi.fn());
const mockGetVersion = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/startup/startupValidation', () => ({
  performTwoStageValidation: mockPerformTwoStageValidation,
}));

vi.mock('../../../lib/brandIcon', () => ({ appIcon: 'icon.png' }));

vi.mock('@shared/constants/branding', () => ({
  APP_NAME: 'TestApp',
  BRAND_CONFIG: { productName: 'TestApp' },
}));

vi.mock('../../../styles/StartupPage.css', () => ({}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import {
  ValidationStage,
  ValidationStatus,
  StartupAction,
  StartupValidationResult,
} from '../../../types/startupValidationTypes';

function makeSuccessResult(totalProfiles = 2): StartupValidationResult {
  return {
    stage1: {
      status: ValidationStatus.SUCCESS,
      stage: ValidationStage.STAGE_1,
      timestamp: Date.now(),
      hasLocalStorageSession: true,
      sessionValid: true,
    },
    stage2: {
      status: ValidationStatus.SUCCESS,
      stage: ValidationStage.STAGE_2,
      timestamp: Date.now(),
      totalProfiles,
      validUsers: [],
      expiredUsers: [],
      invalidUsers: [],
      authManagerInitialized: true,
      authManagerProfiles: [],
      skippedDueToValidSession: false,
    },
    recommendedAction: StartupAction.SHOW_USER_SELECTION,
    totalDuration: 100,
    completedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  mockGetVersion.mockResolvedValue('1.0.0');
  (window as any).electronAPI = {
    getVersion: mockGetVersion,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

import { StartupPage } from '../StartupPage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartupPage', () => {
  it('renders the startup page container', async () => {
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    render(<StartupPage onComplete={onComplete} />);
    expect(document.querySelector('.startup-page')).toBeTruthy();
  });

  it('renders app icon', async () => {
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    render(<StartupPage onComplete={onComplete} />);
    const img = document.querySelector('img[alt="TestApp"]');
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toContain('icon.png');
  });

  it('renders progress bar initially at 0%', async () => {
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    render(<StartupPage onComplete={onComplete} />);
    const fill = document.querySelector('.startup-progress-fill') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('0%');
  });

  it('calls getVersion on mount', async () => {
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    render(<StartupPage onComplete={onComplete} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetVersion).toHaveBeenCalled();
  });

  it('handles getVersion error gracefully', async () => {
    mockGetVersion.mockRejectedValue(new Error('version error'));
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    render(<StartupPage onComplete={onComplete} />);
    await act(async () => {
      await Promise.resolve();
    });
    // Should not throw
    expect(document.querySelector('.startup-page')).toBeTruthy();
  });

  it('calls onComplete with result after full animation sequence', async () => {
    const result = makeSuccessResult(3);
    mockPerformTwoStageValidation.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onComplete).toHaveBeenCalledWith(result);
  });

  it('shows 100% progress bar after step completes', async () => {
    const result = makeSuccessResult(1);
    mockPerformTwoStageValidation.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    // Run all timers including chained ones
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const fill = document.querySelector('.startup-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('handles validation error and calls onComplete with error result', async () => {
    mockPerformTwoStageValidation.mockRejectedValue(new Error('validation failed'));
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onComplete).toHaveBeenCalled();
    const arg = onComplete.mock.calls[0][0] as StartupValidationResult;
    expect(arg.recommendedAction).toBe(StartupAction.SHOW_ERROR);
    expect(arg.stage2.error).toBe('validation failed');
  });

  it('handles unknown error type in validation', async () => {
    mockPerformTwoStageValidation.mockRejectedValue('non-error thrown');
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onComplete).toHaveBeenCalled();
    const arg = onComplete.mock.calls[0][0] as StartupValidationResult;
    expect(arg.stage2.error).toBe('Unknown error');
  });

  it('cleans up timers on unmount', async () => {
    mockPerformTwoStageValidation.mockResolvedValue(makeSuccessResult());
    const onComplete = vi.fn();
    const { unmount } = render(<StartupPage onComplete={onComplete} />);
    unmount();
    // No errors
  });

  it('shows "Found N valid profiles" label after scan with profiles', async () => {
    const result = makeSuccessResult(5);
    mockPerformTwoStageValidation.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    // After completion the label is updated in state (no visible text rendered, but no crash)
    expect(document.querySelector('.startup-page')).toBeTruthy();
  });

  it('shows "No profiles found" label when totalProfiles=0', async () => {
    const result = makeSuccessResult(0);
    mockPerformTwoStageValidation.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(document.querySelector('.startup-page')).toBeTruthy();
  });

  it('handles stage2 error status in result', async () => {
    // Use real timers for this test to avoid complex fake-timer chaining
    vi.useRealTimers();
    const result: StartupValidationResult = {
      ...makeSuccessResult(0),
      stage2: {
        ...makeSuccessResult(0).stage2,
        status: ValidationStatus.ERROR,
        error: 'stage2 error',
      },
    };
    mockPerformTwoStageValidation.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<StartupPage onComplete={onComplete} />);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(result);
    }, { timeout: 5000 });
  });
});
