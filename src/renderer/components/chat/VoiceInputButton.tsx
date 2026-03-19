/**
 * Voice Input Button Component
 *
 * A button that enables speech-to-text input using Whisper (offline, high accuracy).
 *
 * Features:
 * - Real-time streaming transcription with VAD
 * - Visual feedback for listening/processing states
 * - Animated microphone icon
 * - Navigates to settings when model not downloaded
 * - Reads voice input settings from user profile
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStreamingAudioRecorder } from '../../lib/audio';
import type { VoiceInputSettings } from '../../types/profileTypes';
import { ExperimentTag } from '../ui/ExperimentTag';
import './VoiceInputButton.css';

export interface VoiceInputButtonProps {
  /** Callback when transcript is received */
  onTranscript: (transcript: string, isFinal: boolean) => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Language for speech recognition (e.g., 'en-US', 'zh-CN') */
  lang?: string;
  /** Callback when listening starts */
  onListeningStart?: () => void;
  /** Callback when listening ends */
  onListeningEnd?: () => void;
  /** Custom class name */
  className?: string;
}

type VoiceInputStatus = 'idle' | 'listening' | 'processing' | 'error' | 'model-not-downloaded';

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscript,
  disabled = false,
  lang,
  onListeningStart,
  onListeningEnd,
  className = '',
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Voice input settings from profile
  const [settings, setSettings] = useState<VoiceInputSettings>({
    whisperModel: 'base',
    language: 'auto',
    useGPU: false,
    translate: false,
  });
  const [isModelDownloaded, setIsModelDownloaded] = useState(false);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Streaming session state
  const streamingSessionRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string>('');

  // Streaming audio recorder hook
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioLevel,
  } = useStreamingAudioRecorder({
    sampleRate: 16000,
    chunkDuration: 100, // Send chunks every 100ms for responsive transcription
    onAudioChunk: useCallback(async (pcmData: Float32Array) => {
      // Send chunk to streaming session
      if (streamingSessionRef.current) {
        try {
          await window.electronAPI.whisper?.processChunk(
            streamingSessionRef.current,
            pcmData
          );
        } catch (err) {
          console.error('[VoiceInput] Failed to process chunk:', err);
        }
      }
    }, []),
  });

  // Load voice input settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Check model status when settings change
  useEffect(() => {
    checkModelStatus();
  }, [settings.whisperModel]);

  // Set up streaming update listener
  useEffect(() => {
    const unsubscribe = window.electronAPI.whisper?.onStreamingUpdate((update) => {
      // Only process updates for our session
      if (update.sessionId !== streamingSessionRef.current) {
        return;
      }

      console.log('[VoiceInput] Streaming update:', update.type, update.text?.substring(0, 50));

      switch (update.type) {
        case 'interim':
          // Send interim transcript (for real-time feedback)
          if (update.text && update.text !== lastTranscriptRef.current) {
            lastTranscriptRef.current = update.text;
            onTranscript(update.text, false);
          }
          break;

        case 'final':
          // Send final transcript
          if (update.text) {
            lastTranscriptRef.current = update.text;
            onTranscript(update.text, true);
          }
          break;

        case 'error':
          console.error('[VoiceInput] Streaming error:', update.error);
          setErrorMessage(update.error || 'Transcription error');
          setStatus('error');
          setTimeout(() => {
            setStatus('idle');
            setErrorMessage(null);
          }, 3000);
          break;

        case 'stopped':
          // Session stopped - handled in handleClick
          break;
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [onTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any active streaming session
      if (streamingSessionRef.current) {
        window.electronAPI.whisper?.cancelStreaming(streamingSessionRef.current);
        streamingSessionRef.current = null;
      }
    };
  }, []);

  const loadSettings = async () => {
    try {
      const response = await window.electronAPI.voiceInput?.getSettings();
      if (response?.success && response.data) {
        setSettings(response.data);
      }
    } catch (err) {
      console.error('[VoiceInput] Failed to load settings:', err);
    }
  };

  const checkModelStatus = async () => {
    try {
      const response = await window.electronAPI.whisper?.getModelStatus(settings.whisperModel);
      if (response?.success && response.data) {
        setIsModelDownloaded(response.data.downloaded);
      }
    } catch (err) {
      console.error('[VoiceInput] Failed to check model status:', err);
      setIsModelDownloaded(false);
    }
  };

  // Navigate to settings page with model section highlighted
  const navigateToSettings = useCallback(() => {
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings/voice-input?highlight=model');
  }, [navigate, location.pathname]);

  // Handle click - start/stop streaming transcription
  const handleClick = useCallback(async () => {
    // If model not downloaded, navigate to settings
    if (!isModelDownloaded) {
      navigateToSettings();
      return;
    }

    if (isRecording) {
      // Stop streaming transcription
      try {
        setStatus('processing');
        onListeningEnd?.();

        // Stop the audio recording
        stopRecording();

        // Stop the streaming session (this will trigger final transcription)
        if (streamingSessionRef.current) {
          await window.electronAPI.whisper?.stopStreaming(streamingSessionRef.current);
          // Don't null streamingSessionRef here - the 'final' event from
          // stopStreaming is sent via webContents.send() which may arrive
          // after the IPC invoke resolves. If we null the ref now, the
          // onStreamingUpdate listener will filter out the final transcript
          // because update.sessionId !== null fails.
        }

        // Brief delay to show processing state and allow final event to arrive
        setTimeout(() => {
          streamingSessionRef.current = null;
          setStatus('idle');
          lastTranscriptRef.current = '';
        }, 300);

      } catch (err) {
        console.error('[VoiceInput] Failed to stop streaming:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to stop');
        setStatus('error');
        setTimeout(() => {
          setStatus('idle');
          setErrorMessage(null);
        }, 3000);
      }
    } else {
      // Start streaming transcription
      try {
        setErrorMessage(null);
        lastTranscriptRef.current = '';

        // Start streaming session on main process
        const response = await window.electronAPI.whisper?.startStreaming(
          settings.whisperModel,
          {
            language: settings.language === 'auto' ? undefined : settings.language,
            useGPU: settings.useGPU ?? false,
            translate: settings.translate ?? false,
            vadThreshold: 0.6, // Default VAD threshold
            silenceDuration: 500, // 500ms silence triggers transcription
            minSpeechDuration: 300, // Minimum 300ms of speech
          }
        );

        if (!response?.success || !response.data?.sessionId) {
          throw new Error(response?.error || 'Failed to start streaming session');
        }

        streamingSessionRef.current = response.data.sessionId;
        console.log('[VoiceInput] Streaming session started:', response.data.sessionId);

        // Start audio recording
        await startRecording();
        setStatus('listening');
        onListeningStart?.();

      } catch (err) {
        console.error('[VoiceInput] Failed to start streaming:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to start recording');
        setStatus('error');

        // Cleanup
        if (streamingSessionRef.current) {
          window.electronAPI.whisper?.cancelStreaming(streamingSessionRef.current);
          streamingSessionRef.current = null;
        }
      }
    }
  }, [
    isModelDownloaded,
    navigateToSettings,
    isRecording,
    startRecording,
    stopRecording,
    onListeningStart,
    onListeningEnd,
    settings.whisperModel,
    settings.language,
    settings.useGPU,
    settings.translate,
  ]);

  // Get button title based on status
  const getTitle = (): string => {
    if (!isModelDownloaded) {
      return 'Click to download Whisper model for voice input';
    }
    switch (status) {
      case 'listening':
        return 'Click to stop listening (streaming)';
      case 'processing':
        return 'Processing speech...';
      case 'error':
        return errorMessage || 'Speech recognition error';
      default:
        return 'Click to start voice input (streaming)';
    }
  };

  // Get button class based on status
  const getStatusClass = (): string => {
    if (!isModelDownloaded) {
      return 'voice-input-needs-setup';
    }
    switch (status) {
      case 'listening':
        return 'voice-input-listening';
      case 'processing':
        return 'voice-input-processing';
      case 'error':
        return 'voice-input-error';
      default:
        return '';
    }
  };

  return (
    <div className={`voice-input-container ${className}`}>
      <button
        type="button"
        className={`voice-input-button attachment-button ${getStatusClass()}`}
        onClick={handleClick}
        disabled={disabled}
        title={getTitle()}
        aria-label={getTitle()}
      >
        {/* Microphone Icon */}
        <svg
          className="voice-input-icon"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {status === 'listening' ? (
            // Listening state - animated waves
            <>
              <path
                className="mic-body"
                d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"
                fill="currentColor"
              />
              <path
                className="mic-stand"
                d="M19 10v2a7 7 0 0 1-14 0v-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                className="mic-base"
                d="M12 19v4M8 23h8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Audio waves animation - size based on audio level */}
              <circle
                className="voice-wave voice-wave-1"
                cx="12"
                cy="8"
                r={6 + audioLevel * 2}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                opacity={0.3 + audioLevel * 0.5}
              />
              <circle
                className="voice-wave voice-wave-2"
                cx="12"
                cy="8"
                r={8 + audioLevel * 3}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                opacity={0.2 + audioLevel * 0.3}
              />
            </>
          ) : (
            // Default microphone icon
            <>
              <path
                d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"
                fill="currentColor"
              />
              <path
                d="M19 10v2a7 7 0 0 1-14 0v-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M12 19v4M8 23h8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
        </svg>

        {/* Processing spinner overlay */}
        {status === 'processing' && (
          <div className="voice-input-spinner">
            <svg
              className="spinner-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="32"
                strokeDashoffset="12"
              />
            </svg>
          </div>
        )}

        {/* Setup indicator when model not downloaded */}
        {!isModelDownloaded && (
          <div className="voice-input-setup-badge" title="Setup required">
            !
          </div>
        )}

        {/* Experiment tag - only show when model is downloaded (not competing with setup badge) */}
        {isModelDownloaded && (
          <ExperimentTag size="small" className="voice-input-exp-tag" />
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="voice-input-tooltip">
          {showTooltip}
        </div>
      )}

      {/* Error tooltip */}
      {status === 'error' && errorMessage && (
        <div className="voice-input-tooltip voice-input-tooltip-error">
          {errorMessage}
        </div>
      )}
    </div>
  );
};

export default VoiceInputButton;
