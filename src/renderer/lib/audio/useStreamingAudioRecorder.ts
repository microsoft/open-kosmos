/**
 * Streaming Audio Recorder for Real-time Voice Input
 *
 * Records audio from the microphone and streams PCM chunks to the main process
 * for real-time transcription using Whisper with VAD.
 *
 * Features:
 * - Real-time audio level visualization
 * - Streaming PCM data to main process
 * - Automatic AudioContext management
 * - 16kHz mono output optimized for Whisper
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface StreamingAudioRecorderOptions {
  /** Target sample rate (Whisper requires 16000 Hz) */
  sampleRate?: number;
  /** Chunk duration in milliseconds (how often to send audio chunks) */
  chunkDuration?: number;
  /** Callback for audio level updates (for visualization) */
  onAudioLevel?: (level: number) => void;
  /** Callback when audio chunk is ready */
  onAudioChunk?: (pcmData: Float32Array) => void;
}

export interface StreamingAudioRecorderState {
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

export interface UseStreamingAudioRecorderReturn extends StreamingAudioRecorderState {
  /** Start streaming recording */
  startRecording: () => Promise<void>;
  /** Stop streaming recording */
  stopRecording: () => void;
  /** Request microphone permission */
  requestPermission: () => Promise<boolean>;
}

/**
 * Hook for streaming audio recording suitable for real-time Whisper transcription
 */
export function useStreamingAudioRecorder(
  options: StreamingAudioRecorderOptions = {}
): UseStreamingAudioRecorderReturn {
  const {
    sampleRate = 16000, // Whisper's expected sample rate
    chunkDuration = 100, // Send chunks every 100ms
    onAudioLevel,
    onAudioChunk,
  } = options;

  const [state, setState] = useState<StreamingAudioRecorderState>({
    isRecording: false,
    hasPermission: false,
    duration: 0,
    error: null,
    audioLevel: 0,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const onAudioChunkRef = useRef(onAudioChunk);

  // Keep callback ref updated
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, []);

  const cleanupResources = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    isRecordingRef.current = false;
  }, []);

  // Request microphone permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Release immediately
      setState(prev => ({ ...prev, hasPermission: true, error: null }));
      return true;
    } catch (err) {
      console.error('[StreamingAudioRecorder] Permission denied:', err);
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
    if (!analyzerRef.current || !isRecordingRef.current) return;

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

    if (isRecordingRef.current) {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [onAudioLevel]);

  // Start streaming recording
  const startRecording = useCallback(async () => {
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: sampleRate },
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // Create AudioContext for processing
      audioContextRef.current = new AudioContext({ sampleRate });
      const source = audioContextRef.current.createMediaStreamSource(stream);

      // Set up analyzer for level monitoring
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      source.connect(analyzerRef.current);

      // Set up ScriptProcessorNode for getting raw PCM data
      // Buffer size of 4096 at 16kHz = ~256ms chunks, but we collect more frequently
      const bufferSize = Math.ceil(sampleRate * (chunkDuration / 1000));
      // ScriptProcessorNode buffer size must be power of 2, so use 2048 or 4096
      const processorBufferSize = bufferSize <= 2048 ? 2048 : 4096;

      scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(
        processorBufferSize,
        1, // mono input
        1  // mono output
      );

      // Accumulate samples for the desired chunk duration
      let sampleBuffer: Float32Array[] = [];
      let samplesCollected = 0;
      const samplesPerChunk = Math.ceil(sampleRate * (chunkDuration / 1000));

      scriptProcessorRef.current.onaudioprocess = (event) => {
        if (!isRecordingRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Copy the input data (it's reused by the browser)
        const chunkCopy = new Float32Array(inputData.length);
        chunkCopy.set(inputData);

        sampleBuffer.push(chunkCopy);
        samplesCollected += chunkCopy.length;

        // When we have enough samples, send a chunk
        if (samplesCollected >= samplesPerChunk) {
          // Combine all buffered samples
          const totalLength = sampleBuffer.reduce((sum, buf) => sum + buf.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;
          for (const buf of sampleBuffer) {
            combined.set(buf, offset);
            offset += buf.length;
          }

          // Send the chunk
          if (onAudioChunkRef.current) {
            onAudioChunkRef.current(combined);
          }

          // Reset buffer
          sampleBuffer = [];
          samplesCollected = 0;
        }
      };

      source.connect(scriptProcessorRef.current);
      // Connect to destination (required for ScriptProcessorNode to work)
      // But we'll mute it to avoid feedback
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 0; // Mute
      scriptProcessorRef.current.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      isRecordingRef.current = true;
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
      }, 100);

      // Start audio level monitoring
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);

    } catch (err) {
      console.error('[StreamingAudioRecorder] Failed to start:', err);
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to start recording',
      }));
    }
  }, [sampleRate, chunkDuration, updateAudioLevel]);

  // Stop streaming recording
  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    cleanupResources();

    setState(prev => ({
      ...prev,
      isRecording: false,
      duration: 0,
      audioLevel: 0,
    }));
  }, [cleanupResources]);

  return {
    ...state,
    startRecording,
    stopRecording,
    requestPermission,
  };
}

export default useStreamingAudioRecorder;
