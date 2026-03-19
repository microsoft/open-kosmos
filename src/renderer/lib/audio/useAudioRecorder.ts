/**
 * Audio Recorder for Whisper STT
 *
 * Records audio from the microphone and exports it in a format
 * suitable for Whisper transcription (16kHz WAV mono).
 *
 * This is a prototype implementation for future Whisper integration.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface AudioRecorderOptions {
  /** Target sample rate (Whisper requires 16000 Hz) */
  sampleRate?: number;
  /** Number of audio channels (Whisper works best with mono) */
  channels?: number;
  /** Maximum recording duration in milliseconds */
  maxDuration?: number;
  /** Callback for audio level updates (for visualization) */
  onAudioLevel?: (level: number) => void;
}

export interface AudioRecorderState {
  /** Whether currently recording */
  isRecording: boolean;
  /** Whether audio permission is granted */
  hasPermission: boolean;
  /** Recording duration in milliseconds */
  duration: number;
  /** Any error that occurred */
  error: string | null;
  /** Current audio level (0-1) for visualization */
  audioLevel: number;
}

export interface UseAudioRecorderReturn extends AudioRecorderState {
  /** Start recording audio */
  startRecording: () => Promise<void>;
  /** Stop recording and get the audio blob */
  stopRecording: () => Promise<Blob | null>;
  /** Request microphone permission */
  requestPermission: () => Promise<boolean>;
  /** Cancel recording without getting the blob */
  cancelRecording: () => void;
}

/**
 * Hook for recording audio suitable for Whisper transcription
 */
export function useAudioRecorder(
  options: AudioRecorderOptions = {}
): UseAudioRecorderReturn {
  const {
    sampleRate = 16000, // Whisper's expected sample rate
    channels = 1, // Mono audio
    maxDuration = 60000, // 60 seconds max
    onAudioLevel,
  } = options;

  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    hasPermission: false,
    duration: 0,
    error: null,
    audioLevel: 0,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Request microphone permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Release immediately
      setState(prev => ({ ...prev, hasPermission: true, error: null }));
      return true;
    } catch (err) {
      console.error('[AudioRecorder] Permission denied:', err);
      setState(prev => ({
        ...prev,
        hasPermission: false,
        error: 'Microphone permission denied',
      }));
      return false;
    }
  }, []);

  // Update audio level for visualization
  const updateAudioLevel = useCallback(() => {
    if (!analyzerRef.current) return;

    const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
    analyzerRef.current.getByteFrequencyData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const normalizedLevel = Math.min(rms / 128, 1); // Normalize to 0-1

    setState(prev => ({ ...prev, audioLevel: normalizedLevel }));
    onAudioLevel?.(normalizedLevel);

    if (state.isRecording) {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [state.isRecording, onAudioLevel]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: sampleRate },
          channelCount: { ideal: channels },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // Set up audio analysis for level monitoring
      audioContextRef.current = new AudioContext({ sampleRate });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      source.connect(analyzerRef.current);

      // Create MediaRecorder
      // Try to use WAV format if supported, otherwise fall back to webm
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event: Event) => {
        console.error('[AudioRecorder] Error:', event);
        setState(prev => ({ ...prev, error: 'Recording error occurred' }));
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();

      setState(prev => ({
        ...prev,
        isRecording: true,
        hasPermission: true,
        duration: 0,
        error: null,
      }));

      // Start duration counter
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setState(prev => ({ ...prev, duration: elapsed }));

        // Auto-stop if max duration reached
        if (elapsed >= maxDuration) {
          console.log('[AudioRecorder] Max duration reached, stopping...');
          // Will be stopped externally
        }
      }, 100);

      // Start audio level monitoring
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);

    } catch (err) {
      console.error('[AudioRecorder] Failed to start:', err);
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to start recording',
      }));
    }
  }, [sampleRate, channels, maxDuration, updateAudioLevel]);

  // Stop recording and return the audio blob
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !state.isRecording) {
        resolve(null);
        return;
      }

      // Stop duration counter
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      // Stop audio level monitoring
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = async () => {
        // Create blob from chunks
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }

        setState(prev => ({
          ...prev,
          isRecording: false,
          audioLevel: 0,
        }));

        resolve(audioBlob);
      };

      mediaRecorder.stop();
    });
  }, [state.isRecording]);

  // Cancel recording without getting the blob
  const cancelRecording = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    audioChunksRef.current = [];
    setState(prev => ({
      ...prev,
      isRecording: false,
      duration: 0,
      audioLevel: 0,
    }));
  }, [state.isRecording]);

  return {
    ...state,
    startRecording,
    stopRecording,
    requestPermission,
    cancelRecording,
  };
}

/**
 * Convert audio blob to WAV format suitable for Whisper
 * (16kHz, mono, 16-bit PCM)
 *
 * This is needed because MediaRecorder typically outputs webm/opus
 * but Whisper expects WAV format.
 */
export async function convertToWav(
  audioBlob: Blob,
  targetSampleRate: number = 16000
): Promise<ArrayBuffer> {
  const audioContext = new AudioContext({ sampleRate: targetSampleRate });

  try {
    // Decode the audio
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Resample if needed and convert to mono
    const offlineContext = new OfflineAudioContext(
      1, // mono
      audioBuffer.duration * targetSampleRate,
      targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();
    const samples = renderedBuffer.getChannelData(0);

    // Convert to 16-bit PCM WAV
    return encodeWav(samples, targetSampleRate);
  } finally {
    await audioContext.close();
  }
}

/**
 * Encode audio samples to WAV format
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, 1, true); // NumChannels (mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true); // Subchunk2Size

  // Write samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export default useAudioRecorder;
