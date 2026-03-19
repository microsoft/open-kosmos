/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kosmos Team. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cancellation Token - Read-only interface
 * Used to check if an operation cancellation has been requested
 * 
 * @example
 * ```typescript
 * function longOperation(token: CancellationToken) {
 *   // Check if cancellation was requested
 *   if (token.isCancellationRequested) {
 *     throw new CancellationError('Operation cancelled');
 *   }
 *   
 *   // Or listen for cancellation event
 *   token.onCancellationRequested(() => {
 *     cleanup();
 *   });
 * }
 * ```
 */
export interface CancellationToken {
  /**
   * Whether cancellation has been requested
   * @readonly
   */
  readonly isCancellationRequested: boolean;
  
  /**
   * Event triggered when cancellation is requested
   * 
   * @param listener - Callback function invoked on cancellation
   * @returns A dispose function to remove the listener
   * 
   * @example
   * ```typescript
   * const disposable = token.onCancellationRequested(() => {
   *   console.log('Operation cancelled');
   * });
   * 
   * // Remove listener later
   * disposable.dispose();
   * ```
   */
  readonly onCancellationRequested: Event<void>;
}

/**
 * Event listener type
 * @template T - Event data type
 */
export type Event<T> = (listener: (e: T) => void) => { dispose(): void };

/**
 * Cancellation token source - Manages the lifecycle of a cancellation token
 * 
 * Each CancellationTokenSource instance owns an associated CancellationToken;
 * the cancel() method can be called to request cancellation.
 * 
 * @example
 * ```typescript
 * const source = new CancellationTokenSource();
 * 
 * // Pass token to async operation
 * doAsyncWork(source.token);
 * 
 * // Request cancellation
 * source.cancel();
 * 
 * // Clean up resources
 * source.dispose();
 * ```
 */
export class CancellationTokenSource {
  private _token: MutableCancellationToken;
  private _disposed: boolean = false;
  
  /**
   * Create a new CancellationTokenSource instance
   */
  constructor() {
    this._token = new MutableCancellationToken();
  }
  
  /**
   * Get the associated cancellation token
   * 
   * This token should be passed to operations that support cancellation.
   * 
   * @returns The associated CancellationToken
   */
  get token(): CancellationToken {
    return this._token;
  }
  
  /**
   * Request cancellation
   * 
   * After calling this method:
   * 1. token.isCancellationRequested will become true
   * 2. All listeners registered via onCancellationRequested will be triggered
   * 
   * Multiple calls are safe, but only the first call will trigger events.
   * 
   * @example
   * ```typescript
   * source.cancel();
   * console.log(source.token.isCancellationRequested); // true
   * ```
   */
  cancel(): void {
    if (!this._disposed) {
      this._token.cancel();
    }
  }
  
  /**
   * Dispose resources
   * 
   * Releases all event listeners and internal resources.
   * This source cannot be used after calling dispose.
   * 
   * @example
   * ```typescript
   * const source = new CancellationTokenSource();
   * // ... use source
   * source.dispose(); // Cleanup
   * ```
   */
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._token.dispose();
    }
  }
}

/**
 * Mutable cancellation token implementation (internal class)
 * 
 * @internal
 */
class MutableCancellationToken implements CancellationToken {
  private _isCancellationRequested: boolean = false;
  private _emitter: EventEmitter<void>;
  
  constructor() {
    this._emitter = new EventEmitter<void>();
  }
  
  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }
  
  get onCancellationRequested(): Event<void> {
    return this._emitter.event;
  }
  
  /**
   * Request cancellation (internal method)
   * @internal
   */
  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this._emitter.fire();
    }
  }
  
  /**
   * Dispose resources (internal method)
   * @internal
   */
  dispose(): void {
    this._emitter.dispose();
  }
}

/**
 * Simple event emitter
 * 
 * Used to implement event subscription and notification.
 * 
 * @template T - Event data type
 * @internal
 */
class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  
  /**
   * Get event subscription function
   * 
   * @returns Event subscription function that returns a disposable
   */
  get event(): Event<T> {
    return (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        }
      };
    };
  }
  
  /**
   * Fire event, notify all listeners
   * 
   * @param event - Event data (optional)
   */
  fire(event?: T): void {
    // Use a copy to avoid modifying the array during iteration
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      try {
        listener(event!);
      } catch (error) {
        // Listener errors should not affect other listeners
        console.error('Error in event listener:', error);
      }
    }
  }
  
  /**
   * Release all listeners
   */
  dispose(): void {
    this.listeners = [];
  }
}

/**
 * Cancellation error class
 * 
 * Thrown when an operation fails due to cancellation.
 * 
 * @example
 * ```typescript
 * if (token.isCancellationRequested) {
 *   throw new CancellationError('User cancelled the operation');
 * }
 * 
 * // Catch and handle
 * try {
 *   await operation(token);
 * } catch (error) {
 *   if (error instanceof CancellationError) {
 *     console.log('Operation was cancelled');
 *   }
 * }
 * ```
 */
export class CancellationError extends Error {
  /**
   * Create a new CancellationError instance
   * 
   * @param message - Error message, defaults to 'Operation was cancelled'
   */
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
    
    // Maintain correct stack trace (only available in V8 engine)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CancellationError);
    }
  }
}

/**
 * Check if an error is a CancellationError
 * 
 * @param error - The error to check
 * @returns true if the error is a CancellationError
 * 
 * @example
 * ```typescript
 * try {
 *   await operation(token);
 * } catch (error) {
 *   if (isCancellationError(error)) {
 *     // Handle cancellation
 *   } else {
 *     // Handle other errors
 *   }
 * }
 * ```
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError || 
         (error instanceof Error && error.name === 'CancellationError');
}