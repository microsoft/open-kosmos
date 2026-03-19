# Speech-to-Text Implementation Guide

This document describes how to implement Speech-to-Text (STT) functionality in Kosmos Studio using OpenAI Whisper running locally.

## Overview

OpenAI Whisper is a powerful open-source speech recognition model that can run completely offline, providing high accuracy across multiple languages.

### Pros
- Free to use (open source)
- Works completely offline
- High accuracy, especially for English
- Supports 99 languages
- No API keys or internet required
- Privacy-focused (audio never leaves the device)

### Cons
- Increases app size (models range from ~40MB to ~3GB)
- Requires more CPU/GPU resources
- Initial model download required
- Processing is not real-time (batch processing)

## Implementation Options

### Option A: whisper.cpp via Node.js bindings (RECOMMENDED)

whisper.cpp is a C++ port of OpenAI Whisper, optimized for CPU inference. It's lightweight, fast, and works well with Node.js via native bindings.

**Packages:**
- `whisper-node` - Node.js bindings for whisper.cpp
- `@nicholascooper/whisper-node` - Alternative maintained fork

**Pros:**
- Fast CPU inference
- Small binary size
- No Python dependency
- Works well in Electron

**Example usage:**
```typescript
import { whisper } from 'whisper-node';

const transcript = await whisper.transcribe(audioFilePath, {
  modelPath: './models/ggml-base.bin',
  language: 'auto',
});
```

### Option B: @xenova/transformers (WebGPU/WASM)

transformers.js provides a JavaScript implementation that can run Whisper models in the browser/Electron using WebGPU or WASM.

**Pros:**
- Pure JavaScript, no native compilation
- Can use WebGPU for GPU acceleration
- Cross-platform compatibility

**Cons:**
- Slower than native bindings
- Larger memory footprint

### Option C: Python subprocess

Run the original OpenAI Whisper Python package as a subprocess.

**Pros:**
- Full feature parity with original Whisper
- Access to all model sizes

**Cons:**
- Requires Python 3.10+ installed
- Slower startup time
- More complex deployment

## Recommended Architecture

For Kosmos Studio, we recommend **Option A (whisper.cpp)** with the following architecture:

### 1. Audio Recording (Renderer Process)
- Use MediaRecorder API or Web Audio API
- Record audio in WAV format (16kHz, mono)
- Buffer audio chunks in memory

### 2. Audio Processing (Main Process)
- Receive audio buffer via IPC
- Save temporary WAV file
- Process with whisper.cpp
- Return transcript to renderer

### 3. Model Management
- Store models in app's userData directory
- Implement lazy model loading
- Support multiple model sizes (tiny, base, small, medium)

## Model Sizes

| Model  | Size    | Memory  | Speed   | Accuracy  |
|--------|---------|---------|---------|-----------|
| tiny   | 75 MB   | ~390MB  | Fast    | Good      |
| base   | 142 MB  | ~500MB  | Medium  | Better    |
| small  | 466 MB  | ~1GB    | Slow    | Great     |
| medium | 1.5 GB  | ~2.5GB  | Slower  | Excellent |
| large  | 2.9 GB  | ~5GB    | Slowest | Best      |

**Recommendation:** Start with "base" model for a good balance of accuracy and speed.

## Implementation Steps

### Step 1: Install dependencies

```bash
npm install whisper-node --save
```

### Step 2: Download model

Models can be downloaded from: https://huggingface.co/ggerganov/whisper.cpp/tree/main

Example: `ggml-base.bin`

### Step 3: Create audio recorder in renderer

Use the `useAudioRecorder` hook from `src/renderer/lib/audio/useAudioRecorder.ts`:

```typescript
import { useAudioRecorder, convertToWav } from '../lib/audio';

function MyComponent() {
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioLevel,
  } = useAudioRecorder({
    sampleRate: 16000,  // Whisper's expected sample rate
    channels: 1,        // Mono audio
  });

  const handleRecord = async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob) {
        const wavBuffer = await convertToWav(blob);
        // Send to main process for transcription
        const result = await window.electronAPI.whisper.transcribe(wavBuffer);
        console.log(result.text);
      }
    } else {
      await startRecording();
    }
  };

  return (
    <button onClick={handleRecord}>
      {isRecording ? 'Stop' : 'Record'}
    </button>
  );
}
```

### Step 4: Create Whisper service in main process

```typescript
// src/main/lib/whisper/whisperService.ts
import { whisper } from 'whisper-node';
import path from 'path';
import { app } from 'electron';

class WhisperService {
  private modelPath: string | null = null;
  private isInitialized = false;

  async initialize(modelName: string = 'base') {
    const modelsDir = path.join(app.getPath('userData'), 'assets', 'whisper-models');
    this.modelPath = path.join(modelsDir, `ggml-${modelName}.bin`);
    this.isInitialized = true;
  }

  async transcribe(audioBuffer: ArrayBuffer): Promise<{ text: string }> {
    if (!this.isInitialized || !this.modelPath) {
      throw new Error('Whisper service not initialized');
    }

    // Save buffer to temp file
    const tempPath = path.join(app.getPath('temp'), `whisper-${Date.now()}.wav`);
    await fs.writeFile(tempPath, Buffer.from(audioBuffer));

    try {
      const result = await whisper.transcribe(tempPath, {
        modelPath: this.modelPath,
        language: 'auto',
      });
      return { text: result.map(s => s.text).join(' ') };
    } finally {
      await fs.unlink(tempPath);
    }
  }
}

export const whisperService = new WhisperService();
```

### Step 5: Add IPC handlers

```typescript
// In src/main/main.ts
import { whisperService } from './lib/whisper/whisperService';

ipcMain.handle('whisper:initialize', async (_, modelName) => {
  await whisperService.initialize(modelName);
});

ipcMain.handle('whisper:transcribe', async (_, audioBuffer) => {
  return whisperService.transcribe(audioBuffer);
});
```

### Step 6: Update preload script

```typescript
// In src/main/preload.ts
whisper: {
  initialize: (modelName: string) => ipcRenderer.invoke('whisper:initialize', modelName),
  transcribe: (audioBuffer: ArrayBuffer) => ipcRenderer.invoke('whisper:transcribe', audioBuffer),
}
```

## Future Considerations

### 1. GPU Acceleration
- whisper.cpp supports CUDA and Metal acceleration
- Could significantly improve transcription speed

### 2. Real-time Streaming
- Implement voice activity detection (VAD)
- Process audio in smaller chunks
- Provide interim results

### 3. Speaker Diarization
- Identify different speakers
- Useful for meeting transcription

### 4. Custom Fine-tuning
- Fine-tune models for domain-specific vocabulary

## Type Definitions

See `src/renderer/lib/audio/whisperTypes.ts` for TypeScript interfaces used in the Whisper integration.

## Related Files

- `src/renderer/lib/audio/useSpeechRecognition.ts` - Web Speech API hook (Method 1)
- `src/renderer/lib/audio/useAudioRecorder.ts` - Audio recording hook
- `src/renderer/lib/audio/whisperTypes.ts` - Type definitions
- `src/renderer/components/chat/VoiceInputButton.tsx` - Voice input UI component
