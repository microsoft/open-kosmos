/**
 * @vitest-environment happy-dom
 */

/**
 * VoiceInputButton — comprehensive coverage
 *
 * Covers all branches:
 * - initial render (model not downloaded vs downloaded)
 * - getTitle / getStatusClass for all status values
 * - loadSettings (success + failure)
 * - checkModelStatus (success downloaded=true, downloaded=false, failure)
 * - handleClick when model not downloaded → navigates to settings
 * - handleClick start streaming: success, failure, missing session
 * - handleClick stop streaming: success, failure
 * - onStreamingUpdate: interim, final, error, stopped
 * - cleanup on unmount
 * - ExperimentTag and setup-badge conditional rendering
 * - processing spinner overlay
 * - showTooltip + error tooltip rendering
 * - disabled prop
 */

import React from 'react';
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const mockNavigate  = vi.fn();
const mockLocation  = vi.hoisted(() => ({ pathname: '/agent/chat' }));

// Streaming update listener store
const streamingUpdateListeners = vi.hoisted(() => ({ current: null as ((u: any) => void) | null }));

// Mock electronAPI
const mockWhisper = vi.hoisted(() => ({
  getModelStatus:    vi.fn(),
  startStreaming:    vi.fn(),
  stopStreaming:     vi.fn(),
  cancelStreaming:   vi.fn(),
  processChunk:      vi.fn(),
  onStreamingUpdate: vi.fn((cb: (u: any) => void) => {
    streamingUpdateListeners.current = cb;
    return () => { streamingUpdateListeners.current = null; };
  }),
}));

const mockVoiceInput = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock calls
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../../../lib/audio', () => ({
  useStreamingAudioRecorder: vi.fn(({ onAudioChunk }: any) => ({
    isRecording:    false,
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording:  vi.fn(),
    audioLevel:     0.5,
    // expose onAudioChunk so tests can call it
    _onAudioChunk:  onAudioChunk,
  })),
}));

vi.mock('../../ui/ExperimentTag', () => ({
  ExperimentTag: ({ size, className }: any) => (
    <span data-testid="experiment-tag" data-size={size} className={className} />
  ),
}));

vi.mock('../VoiceInputButton.css', () => ({}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    info:  vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import component + hook after mocks
// ---------------------------------------------------------------------------

import { useStreamingAudioRecorder } from '../../../lib/audio';
import { VoiceInputButton } from '../VoiceInputButton';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAPI(opts: {
  downloaded?: boolean;
  settingsSuccess?: boolean;
  startStreamingSuccess?: boolean;
  sessionId?: string;
} = {}) {
  const {
    downloaded             = true,
    settingsSuccess        = true,
    startStreamingSuccess  = true,
    sessionId              = 'sess-123',
  } = opts;

  mockWhisper.getModelStatus.mockResolvedValue({
    success: true,
    data: { downloaded },
  });

  mockVoiceInput.getSettings.mockResolvedValue({
    success: settingsSuccess,
    data: settingsSuccess
      ? { whisperModel: 'base', language: 'auto', useGPU: false, translate: false }
      : undefined,
  });

  mockWhisper.startStreaming.mockResolvedValue({
    success: startStreamingSuccess,
    data: startStreamingSuccess ? { sessionId } : undefined,
    error: startStreamingSuccess ? undefined : 'Start failed',
  });

  mockWhisper.stopStreaming.mockResolvedValue(undefined);

  (window as any).electronAPI = {
    whisper:    mockWhisper,
    voiceInput: mockVoiceInput,
  };
}

function renderButton(props: Partial<React.ComponentProps<typeof VoiceInputButton>> = {}) {
  const onTranscript   = vi.fn();
  const onListeningStart = vi.fn();
  const onListeningEnd   = vi.fn();

  const result = render(
    <VoiceInputButton
      onTranscript={onTranscript}
      onListeningStart={onListeningStart}
      onListeningEnd={onListeningEnd}
      {...props}
    />,
  );

  return { ...result, onTranscript, onListeningStart, onListeningEnd };
}

// Make the hook mock mutable so tests can override isRecording
function setIsRecording(value: boolean) {
  (useStreamingAudioRecorder as ReturnType<typeof vi.fn>).mockImplementation(
    ({ onAudioChunk }: any) => ({
      isRecording:    value,
      startRecording: vi.fn().mockResolvedValue(undefined),
      stopRecording:  vi.fn(),
      audioLevel:     0.5,
      _onAudioChunk:  onAudioChunk,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceInputButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingUpdateListeners.current = null;
    setIsRecording(false);
    setupAPI();
    mockLocation.pathname = '/agent/chat';
    sessionStorage.clear();
  });

  // ──────────────────────── Render ──────────────────────────────────────────

  describe('rendering', () => {
    it('renders a button', async () => {
      renderButton();
      await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    });

    it('renders setup badge when model is not downloaded', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      await waitFor(() => expect(screen.getByText('!')).toBeTruthy());
    });

    it('does not render setup badge when model is downloaded', async () => {
      setupAPI({ downloaded: true });
      renderButton();
      await waitFor(() => expect(screen.queryByText('!')).toBeNull());
    });

    it('renders ExperimentTag when model is downloaded', async () => {
      setupAPI({ downloaded: true });
      renderButton();
      await waitFor(() => expect(screen.getByTestId('experiment-tag')).toBeTruthy());
    });

    it('does not render ExperimentTag when model is not downloaded', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      await waitFor(() => expect(screen.queryByTestId('experiment-tag')).toBeNull());
    });

    it('applies disabled attribute', async () => {
      renderButton({ disabled: true });
      const btn = await waitFor(() => screen.getByRole('button') as HTMLButtonElement);
      expect(btn.disabled).toBe(true);
    });

    it('applies custom className', async () => {
      renderButton({ className: 'my-custom-class' });
      const container = document.querySelector('.voice-input-container');
      expect(container?.classList.contains('my-custom-class')).toBe(true);
    });
  });

  // ──────────────────────── getTitle ────────────────────────────────────────

  describe('getTitle', () => {
    it('shows "download" title when model not downloaded', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      expect(btn.title).toContain('download');
    });

    it('shows default idle title when model downloaded and idle', async () => {
      setupAPI({ downloaded: true });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await waitFor(() => expect(btn.title).toContain('start voice input'));
    });
  });

  // ──────────────────────── getStatusClass ──────────────────────────────────

  describe('getStatusClass', () => {
    it('returns voice-input-needs-setup when model not downloaded', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await waitFor(() => expect(btn.className).toContain('voice-input-needs-setup'));
    });
  });

  // ──────────────────────── loadSettings ────────────────────────────────────

  describe('loadSettings', () => {
    it('loads settings successfully on mount', async () => {
      renderButton();
      await waitFor(() =>
        expect(mockVoiceInput.getSettings).toHaveBeenCalled(),
      );
    });

    it('handles loadSettings failure gracefully', async () => {
      mockVoiceInput.getSettings.mockRejectedValue(new Error('Settings error'));
      (window as any).electronAPI.voiceInput = mockVoiceInput;
      renderButton();
      // Should not crash
      await waitFor(() => expect(mockVoiceInput.getSettings).toHaveBeenCalled());
    });

    it('handles missing voiceInput API', async () => {
      (window as any).electronAPI.voiceInput = undefined;
      renderButton();
      await waitFor(() => screen.getByRole('button'));
      // Should render without crashing
      expect(screen.getByRole('button')).toBeTruthy();
    });
  });

  // ──────────────────────── checkModelStatus ────────────────────────────────

  describe('checkModelStatus', () => {
    it('sets isModelDownloaded=true when API says downloaded', async () => {
      setupAPI({ downloaded: true });
      renderButton();
      await waitFor(() =>
        expect(screen.queryByText('!')).toBeNull(),
      );
    });

    it('sets isModelDownloaded=false when API says not downloaded', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      await waitFor(() => expect(screen.getByText('!')).toBeTruthy());
    });

    it('handles getModelStatus failure (sets downloaded=false)', async () => {
      mockWhisper.getModelStatus.mockRejectedValue(new Error('Model check error'));
      renderButton();
      await waitFor(() => expect(screen.getByText('!')).toBeTruthy());
    });

    it('handles missing whisper API gracefully', async () => {
      (window as any).electronAPI.whisper = undefined;
      renderButton();
      await waitFor(() => screen.getByRole('button'));
      expect(screen.getByRole('button')).toBeTruthy();
    });
  });

  // ──────────────────────── navigateToSettings ──────────────────────────────

  describe('navigateToSettings', () => {
    it('navigates to voice-input settings when model not downloaded and button clicked', async () => {
      setupAPI({ downloaded: false });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      fireEvent.click(btn);
      expect(mockNavigate).toHaveBeenCalledWith('/settings/voice-input?highlight=model');
    });

    it('stores currentPath in sessionStorage before navigating', async () => {
      setupAPI({ downloaded: false });
      mockLocation.pathname = '/agent/chat/my-agent';
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      fireEvent.click(btn);
      expect(sessionStorage.getItem('previousPath')).toBe('/agent/chat/my-agent');
    });
  });

  // ──────────────────────── handleClick — start streaming ──────────────────

  describe('handleClick — start streaming', () => {
    it('calls startStreaming API and starts recording', async () => {
      setupAPI({ downloaded: true, startStreamingSuccess: true });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() =>
        expect(mockWhisper.startStreaming).toHaveBeenCalled(),
      );
    });

    it('calls onListeningStart after recording starts', async () => {
      setupAPI({ downloaded: true });
      const { onListeningStart } = renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(onListeningStart).toHaveBeenCalled());
    });

    it('sets status=listening after start', async () => {
      setupAPI({ downloaded: true });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(btn.title).toContain('stop listening'));
    });

    it('shows error when startStreaming returns failure', async () => {
      setupAPI({ downloaded: true, startStreamingSuccess: false });
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(btn.className).toContain('voice-input-error'));
    });

    it('shows error when startStreaming throws', async () => {
      setupAPI({ downloaded: true });
      mockWhisper.startStreaming.mockRejectedValue(new Error('Start crash'));
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(btn.className).toContain('voice-input-error'));
    });

    it('cancels session on start failure if sessionId was partially set', async () => {
      // Set up: streaming session ID is returned, but startRecording throws
      mockWhisper.startStreaming.mockResolvedValue({ success: true, data: { sessionId: 'sess-fail' } });
      (useStreamingAudioRecorder as ReturnType<typeof vi.fn>).mockImplementation(({ onAudioChunk }: any) => ({
        isRecording:    false,
        startRecording: vi.fn().mockRejectedValue(new Error('mic denied')),
        stopRecording:  vi.fn(),
        audioLevel:     0,
        _onAudioChunk:  onAudioChunk,
      }));

      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() =>
        expect(mockWhisper.cancelStreaming).toHaveBeenCalledWith('sess-fail'),
      );
    });
  });

  // ──────────────────────── handleClick — stop streaming ───────────────────

  describe('handleClick — stop streaming', () => {
    it('calls onListeningEnd and stopRecording when recording is active', async () => {
      setupAPI({ downloaded: true });
      setIsRecording(true);

      const { onListeningEnd } = renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(onListeningEnd).toHaveBeenCalled());
    });

    it('shows processing status briefly', async () => {
      setupAPI({ downloaded: true });
      setIsRecording(true);
      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      // immediately after click, processing state appears
      expect(btn.title).toContain('Processing');
    });

    it('shows error when stopStreaming throws', async () => {
      setupAPI({ downloaded: true });
      // We need to: 1) start a session, 2) switch to recording=true, 3) click stop
      // Use a two-phase approach with re-renders
      let recordingPhase = false;
      (useStreamingAudioRecorder as ReturnType<typeof vi.fn>).mockImplementation(
        ({ onAudioChunk }: any) => ({
          isRecording:    recordingPhase,
          startRecording: vi.fn().mockImplementation(() => {
            recordingPhase = true;
            return Promise.resolve();
          }),
          stopRecording: vi.fn(),
          audioLevel:    0,
          _onAudioChunk: onAudioChunk,
        }),
      );

      mockWhisper.stopStreaming.mockRejectedValue(new Error('Stop crash'));

      const { rerender } = renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));

      // Click to start (sets session ref)
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      // Now re-render with isRecording=true so the component sees it
      setIsRecording(true);
      rerender(
        <VoiceInputButton
          onTranscript={vi.fn()}
          onListeningStart={vi.fn()}
          onListeningEnd={vi.fn()}
        />,
      );

      // Click to stop — stopStreaming throws
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(btn.className).toContain('voice-input-error'));
    });
  });

  // ──────────────────────── onStreamingUpdate listener ─────────────────────

  describe('onStreamingUpdate listener', () => {
    it('forwards interim transcript to onTranscript', async () => {
      setupAPI({ downloaded: true });
      const { onTranscript } = renderButton();

      // Start a session first
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      // Fire interim update
      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'sess-123',
          type: 'interim',
          text: 'hello world',
        });
      });

      expect(onTranscript).toHaveBeenCalledWith('hello world', false);
    });

    it('ignores interim update if text same as last', async () => {
      setupAPI({ downloaded: true });
      const { onTranscript } = renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({ sessionId: 'sess-123', type: 'interim', text: 'hello' });
        streamingUpdateListeners.current?.({ sessionId: 'sess-123', type: 'interim', text: 'hello' });
      });

      // Only called once
      expect(onTranscript).toHaveBeenCalledTimes(1);
    });

    it('forwards final transcript to onTranscript', async () => {
      setupAPI({ downloaded: true });
      const { onTranscript } = renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'sess-123',
          type: 'final',
          text: 'final text',
        });
      });

      expect(onTranscript).toHaveBeenCalledWith('final text', true);
    });

    it('handles error update — sets error status then resets', async () => {
      setupAPI({ downloaded: true });
      renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'sess-123',
          type: 'error',
          error: 'Transcription crashed',
        });
      });

      await waitFor(() => expect(btn.className).toContain('voice-input-error'));
    });

    it('shows error tooltip on error status', async () => {
      setupAPI({ downloaded: true });
      renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'sess-123',
          type: 'error',
          error: 'My error message',
        });
      });

      await waitFor(() =>
        expect(screen.getByText('My error message')).toBeTruthy(),
      );
    });

    it('handles "stopped" update type without crash', async () => {
      setupAPI({ downloaded: true });
      renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'sess-123',
          type: 'stopped',
        });
      });

      // No crash, still idle or processing
      expect(screen.getByRole('button')).toBeTruthy();
    });

    it('ignores updates from a different sessionId', async () => {
      setupAPI({ downloaded: true });
      const { onTranscript } = renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      await act(async () => {
        streamingUpdateListeners.current?.({
          sessionId: 'DIFFERENT-SESSION',
          type: 'final',
          text: 'should be ignored',
        });
      });

      expect(onTranscript).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────── status-specific rendering ──────────────────────

  describe('status-specific rendering', () => {
    it('shows processing spinner when status=processing', async () => {
      setupAPI({ downloaded: true });
      setIsRecording(true);

      renderButton();
      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });

      // After stopping, status becomes 'processing' briefly
      await waitFor(() => expect(btn.title).toContain('Processing'));
      const spinner = document.querySelector('.voice-input-spinner');
      expect(spinner).toBeTruthy();
    });

    it('shows listening wave SVG when status=listening', async () => {
      setupAPI({ downloaded: true });
      renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => expect(btn.title).toContain('stop listening'));

      // The listening state renders two circles with class "voice-wave"
      const waves = document.querySelectorAll('.voice-wave');
      expect(waves.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────── unmount cleanup ────────────────────────────────

  describe('unmount cleanup', () => {
    it('cancels active streaming session on unmount', async () => {
      setupAPI({ downloaded: true });
      const { unmount } = renderButton();

      const btn = await waitFor(() => screen.getByRole('button'));
      await act(async () => { fireEvent.click(btn); });
      await waitFor(() => mockWhisper.startStreaming.mock.calls.length > 0);

      unmount();

      expect(mockWhisper.cancelStreaming).toHaveBeenCalledWith('sess-123');
    });

    it('does not crash on unmount when no session is active', async () => {
      setupAPI({ downloaded: true });
      const { unmount } = renderButton();
      await waitFor(() => screen.getByRole('button'));
      unmount();
      expect(mockWhisper.cancelStreaming).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────── tooltip ────────────────────────────────────────

  describe('tooltip rendering', () => {
    it('does not show tooltip by default', () => {
      renderButton();
      const tooltip = document.querySelector('.voice-input-tooltip:not(.voice-input-tooltip-error)');
      expect(tooltip).toBeNull();
    });
  });
});
