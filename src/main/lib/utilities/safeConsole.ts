/**
 * Safe console output wrapper.
 *
 * In sandboxed environments or during app shutdown, standard output streams
 * may already be closed. Calling console.log directly in those situations
 * causes "write EIO" errors. This module provides safe console output methods.
 */

import { WriteStream } from 'tty';

// Check whether a stream is writable
function isStreamWritable(stream: NodeJS.WriteStream): boolean {
  try {
    // Check whether the stream exists and has not been destroyed
    if (!stream || stream.destroyed) {
      return false;
    }

    // Check whether the stream is writable
    if (!stream.writable) {
      return false;
    }

    // Check whether the stream is in an error state
    if (stream.errored) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Write to a stream safely
function safeWrite(stream: NodeJS.WriteStream, data: string): boolean {
  try {
    if (!isStreamWritable(stream)) {
      return false;
    }

    // Use synchronous write to avoid errors in async callbacks, catching all possible exceptions
    try {
      return stream.write(data);
    } catch (writeError: any) {
      // Handle EIO and EPIPE errors specifically:
      // EIO:   I/O error, typically occurs in sandboxed environments
      // EPIPE: pipe closed, typically occurs during app shutdown
      if (writeError.code === 'EIO' || writeError.code === 'EPIPE' ||
          writeError.message?.includes('EIO') || writeError.message?.includes('EPIPE')) {
        return false;
      }
      // Handle other write errors
      return false;
    }
  } catch (error) {
    // Silently ignore all errors
    return false;
  }
}

// Safe console log function
export function safeConsoleLog(...args: any[]): void {
  try {
    try {
      const message = args.map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        } catch (stringifyError) {
          return '[Object]';
        }
      }).join(' ') + '\n';

      // Try writing to stdout
      try {
        if (!safeWrite(process.stdout, message)) {
          // If stdout is unavailable, try stderr
          try {
            safeWrite(process.stderr, `[SAFE-LOG] ${message}`);
          } catch (stderrError) {
            // stderr also failed — completely silent
          }
        }
      } catch (writeError) {
        // Write failed — completely silent
      }
    } catch (messageError) {
      // Message processing failed — completely silent
    }
  } catch (error) {
    // Completely silent failure — must not throw during shutdown
  }
}

// Safe console error function
export function safeConsoleError(...args: any[]): void {
  try {
    try {
      const message = args.map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        } catch (stringifyError) {
          return '[Object]';
        }
      }).join(' ') + '\n';

      // Try writing to stderr
      try {
        if (!safeWrite(process.stderr, `[ERROR] ${message}`)) {
          // If stderr is also unavailable, try stdout
          try {
            safeWrite(process.stdout, `[ERROR] ${message}`);
          } catch (stdoutError) {
            // stdout also failed — completely silent
          }
        }
      } catch (writeError) {
        // Write failed — completely silent
      }
    } catch (messageError) {
      // Message processing failed — completely silent
    }
  } catch (error) {
    // Completely silent failure
  }
}

// Safe console warn function
export function safeConsoleWarn(...args: any[]): void {
  try {
    try {
      const message = args.map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
        } catch (stringifyError) {
          return '[Object]';
        }
      }).join(' ') + '\n';

      // Try writing to stderr
      try {
        if (!safeWrite(process.stderr, `[WARN] ${message}`)) {
          // If stderr is unavailable, try stdout
          try {
            safeWrite(process.stdout, `[WARN] ${message}`);
          } catch (stdoutError) {
            // stdout also failed — completely silent
          }
        }
      } catch (writeError) {
        // Write failed — completely silent
      }
    } catch (messageError) {
      // Message processing failed — completely silent
    }
  } catch (error) {
    // Completely silent failure
  }
}

// Check whether the console is safely available
export function isConsoleSafe(): boolean {
  return isStreamWritable(process.stdout) || isStreamWritable(process.stderr);
}

// Create a safe console object
export const safeConsole = {
  log: safeConsoleLog,
  error: safeConsoleError,
  warn: safeConsoleWarn,
  info: safeConsoleLog, // info uses the same implementation as log
  debug: safeConsoleLog, // debug uses the same implementation as log
  time: (label: string) => { try { console.time(label); } catch {} },
  timeEnd: (label: string) => { try { console.timeEnd(label); } catch {} },
  isSafe: isConsoleSafe
};

// Dedicated safe log function for use during app shutdown
export function exitSafeLog(message: string, metadata?: any): void {
  // Multi-layer try-catch protection — must never throw
  try {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = metadata
        ? `[${timestamp}] [EXIT] ${message} - ${JSON.stringify(metadata)}`
        : `[${timestamp}] [EXIT] ${message}`;

      // During shutdown, prefer stderr
      let written = false;

      try {
        written = safeWrite(process.stderr, logMessage + '\n');
      } catch (stderrError) {
        // stderr write failed — silently continue
        written = false;
      }

      if (!written) {
        try {
          // If stderr is unavailable, try stdout
          safeWrite(process.stdout, logMessage + '\n');
        } catch (stdoutError) {
          // stdout also failed — completely silent
        }
      }
    } catch (jsonError) {
      // JSON.stringify or other operation failed
      try {
        // Try writing a simplified message
        const simpleMessage = `[EXIT] ${String(message)}\n`;
        if (!safeWrite(process.stderr, simpleMessage)) {
          safeWrite(process.stdout, simpleMessage);
        }
      } catch (fallbackError) {
        // Even the simplified message failed — completely silent
      }
    }
  } catch (outerError) {
    // Outermost guard — ensure no exception ever escapes.
    // All errors during shutdown should be silently swallowed.
  }
}

export default safeConsole;
