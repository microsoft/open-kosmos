/**
 * Web Speech API Hook for Speech-to-Text
 *
 * Method 1: Native Web Speech API
 * - Free, no external libraries
 * - Limited reliability in Electron (depends on OS speech engine)
 * - Best for quick prototypes and personal tools
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Web Speech API types (not available in standard TS libs)
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onnomatch: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type SpeechRecognitionStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'error'
  | 'not-supported';

export interface SpeechRecognitionError {
  code: string;
  message: string;
}

export interface UseSpeechRecognitionOptions {
  /** Language code (e.g., 'en-US', 'zh-CN'). Defaults to browser language */
  lang?: string;
  /** Whether to return interim (partial) results. Defaults to true */
  interimResults?: boolean;
  /** Whether to continue listening after speech ends. Defaults to false */
  continuous?: boolean;
  /** Callback when transcript is received */
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  /** Callback when an error occurs */
  onError?: (error: SpeechRecognitionError) => void;
  /** Callback when listening starts */
  onStart?: () => void;
  /** Callback when listening ends */
  onEnd?: () => void;
}

export interface UseSpeechRecognitionReturn {
  /** Whether the Web Speech API is supported */
  isSupported: boolean;
  /** Current status of recognition */
  status: SpeechRecognitionStatus;
  /** Whether currently listening */
  isListening: boolean;
  /** Current transcript (interim or final) */
  transcript: string;
  /** The final confirmed transcript */
  finalTranscript: string;
  /** Any error that occurred */
  error: SpeechRecognitionError | null;
  /** Start listening */
  startListening: () => void;
  /** Stop listening */
  stopListening: () => void;
  /** Toggle listening state */
  toggleListening: () => void;
  /** Clear the current transcript */
  clearTranscript: () => void;
}

/**
 * Hook for using Web Speech API for speech-to-text
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const {
    lang = navigator.language || 'en-US',
    interimResults = true,
    continuous = false,
    onTranscript,
    onError,
    onStart,
    onEnd,
  } = options;

  // Check for Web Speech API support
  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const [status, setStatus] = useState<SpeechRecognitionStatus>(
    isSupported ? 'idle' : 'not-supported'
  );
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<SpeechRecognitionError | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isListeningRef = useRef(false);

  // Initialize speech recognition
  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.lang = lang;
    recognition.interimResults = interimResults;
    recognition.continuous = continuous;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[SpeechRecognition] Started listening');
      isListeningRef.current = true;
      setStatus('listening');
      setError(null);
      onStart?.();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcriptText = result[0].transcript;

        if (result.isFinal) {
          finalText += transcriptText;
        } else {
          interimTranscript += transcriptText;
        }
      }

      if (finalText) {
        setFinalTranscript(prev => prev + finalText);
        onTranscript?.(finalText, true);
      }

      if (interimTranscript) {
        setTranscript(interimTranscript);
        onTranscript?.(interimTranscript, false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[SpeechRecognition] Error:', event.error);
      const speechError: SpeechRecognitionError = {
        code: event.error,
        message: getSpeechErrorMessage(event.error),
      };
      setError(speechError);
      setStatus('error');
      onError?.(speechError);
    };

    recognition.onend = () => {
      console.log('[SpeechRecognition] Ended');
      isListeningRef.current = false;
      if (status !== 'error') {
        setStatus('idle');
      }
      onEnd?.();
    };

    recognition.onspeechend = () => {
      console.log('[SpeechRecognition] Speech ended');
      setStatus('processing');
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [lang, interimResults, continuous, isSupported]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListeningRef.current) return;

    try {
      setTranscript('');
      setError(null);
      recognitionRef.current.start();
    } catch (err) {
      console.error('[SpeechRecognition] Failed to start:', err);
      setError({
        code: 'start-error',
        message: 'Failed to start speech recognition',
      });
      setStatus('error');
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListeningRef.current) return;

    try {
      recognitionRef.current.stop();
    } catch (err) {
      console.error('[SpeechRecognition] Failed to stop:', err);
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setFinalTranscript('');
  }, []);

  return {
    isSupported,
    status,
    isListening: status === 'listening',
    transcript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    toggleListening,
    clearTranscript,
  };
}

/**
 * Get user-friendly error message for speech recognition errors
 */
function getSpeechErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    'no-speech': 'No speech was detected. Please try again.',
    'audio-capture': 'No microphone was found or microphone access was denied.',
    'not-allowed': 'Microphone permission was denied. Please allow access in your browser settings.',
    'network': 'Network error occurred. Please check your internet connection.',
    'aborted': 'Speech recognition was aborted.',
    'language-not-supported': 'The selected language is not supported.',
    'service-not-allowed': 'Speech recognition service is not allowed.',
    'bad-grammar': 'Grammar error in speech recognition.',
  };

  return errorMessages[errorCode] || `Speech recognition error: ${errorCode}`;
}

export default useSpeechRecognition;
