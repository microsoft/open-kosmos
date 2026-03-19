/**
 * Safe console output wrapper
 * 
 * In sandbox environments or during app exit, standard output streams may already be closed,
 * and using console.log directly would cause "write EIO" errors.
 * This module provides safe console output methods.
 */

import { WriteStream } from 'tty';

// Check if stream is writable
function isStreamWritable(stream: NodeJS.WriteStream): boolean {
  try {
    // Check if stream exists and is not destroyed
    if (!stream || stream.destroyed) {
      return false;
    }
    
    // Check if stream is writable
    if (!stream.writable) {
      return false;
    }
    
    // Check if in error state
    if (stream.errored) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

// Safely write to stream
function safeWrite(stream: NodeJS.WriteStream, data: string): boolean {
  try {
    if (!isStreamWritable(stream)) {
      return false;
    }
    
    // Use synchronous write to avoid errors in async callbacks, and catch all possible exceptions
    try {
      return stream.write(data);
    } catch (writeError: any) {
      // Specifically handle EIO and EPIPE errors
      // EIO: I/O error, typically occurs in sandbox environments
      // EPIPE: Pipe closed, typically occurs during app exit
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
            // stderr also failed, completely silent
          }
        }
      } catch (writeError) {
        // Write failed, completely silent
      }
    } catch (messageError) {
      // Message processing failed, completely silent
    }
  } catch (error) {
    // Completely silent failure - should not throw errors during exit process
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
            // stdout also failed, completely silent
          }
        }
      } catch (writeError) {
        // Write failed, completely silent
      }
    } catch (messageError) {
      // Message processing failed, completely silent
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
            // stdout also failed, completely silent
          }
        }
      } catch (writeError) {
        // Write failed, completely silent
      }
    } catch (messageError) {
      // Message processing failed, completely silent
    }
  } catch (error) {
    // Completely silent failure
  }
}

// Check if console is safely usable
export function isConsoleSafe(): boolean {
  return isStreamWritable(process.stdout) || isStreamWritable(process.stderr);
}

// Create safe console object
export const safeConsole = {
  log: safeConsoleLog,
  error: safeConsoleError,
  warn: safeConsoleWarn,
  info: safeConsoleLog, // info uses same implementation as log
  debug: safeConsoleLog, // debug uses same implementation as log
  isSafe: isConsoleSafe
};

// Dedicated safe log function for app exit
export function exitSafeLog(message: string, metadata?: any): void {
  // Multi-layer try-catch protection, ensures absolutely no exceptions are thrown
  try {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = metadata
        ? `[${timestamp}] [EXIT] ${message} - ${JSON.stringify(metadata)}`
        : `[${timestamp}] [EXIT] ${message}`;
      
      // During exit process, prefer stderr
      let written = false;
      
      try {
        written = safeWrite(process.stderr, logMessage + '\n');
      } catch (stderrError) {
        // stderr write failed, silently continue
        written = false;
      }
      
      if (!written) {
        try {
          // If stderr is unavailable, try stdout
          safeWrite(process.stdout, logMessage + '\n');
        } catch (stdoutError) {
          // stdout also failed, completely silent
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
        // Even simplified message failed, completely silent
      }
    }
  } catch (outerError) {
    // Outermost protection, ensures absolutely no exceptions escape
    // During exit process, all errors should be handled silently
  }
}

export default safeConsole;