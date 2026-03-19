/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kosmos Team. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cancellation Token Module
 * 
 * Provides a standard cancellation mechanism for gracefully terminating long-running operations.
 * 
 * @module cancellation
 * 
 * @example
 * ```typescript
 * import { CancellationTokenSource, CancellationError } from './cancellation';
 * 
 * const source = new CancellationTokenSource();
 * 
 * async function longOperation(token: CancellationToken) {
 *   for (let i = 0; i < 100; i++) {
 *     if (token.isCancellationRequested) {
 *       throw new CancellationError('Operation cancelled by user');
 *     }
 *     await doWork(i);
 *   }
 * }
 * 
 * // Start operation
 * const operation = longOperation(source.token);
 * 
 * // Cancel after 5 seconds
 * setTimeout(() => source.cancel(), 5000);
 * 
 * try {
 *   await operation;
 * } catch (error) {
 *   if (error instanceof CancellationError) {
 *     console.log('Operation was cancelled');
 *   }
 * } finally {
 *   source.dispose();
 * }
 * ```
 */

// Export core types and classes
export {
  CancellationTokenSource,
  CancellationError,
  isCancellationError
} from './CancellationToken';
export type { CancellationToken, Event } from './CancellationToken';

// Import types for predefined constants
import type { CancellationToken as ICancellationToken } from './CancellationToken';

/**
 * Predefined cancellation token constants
 *
 * Provides commonly used CancellationToken instances to avoid repeated creation.
 */
export const CancellationTokenStatic = {
  /**
   * A token that will never be cancelled
   *
   * Used for operations that don't support cancellation, or scenarios where cancellation is not applicable.
   *
   * @example
   * ```typescript
   * import { CancellationTokenStatic } from './cancellation';
   *
   * function operation(token: CancellationToken = CancellationTokenStatic.None) {
   *   // token will never be cancelled
   * }
   * ```
   */
  None: {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as ICancellationToken,
  
  /**
   * A token that has already been cancelled
   *
   * Used for testing or scenarios where immediate cancellation is needed.
   *
   * @example
   * ```typescript
   * import { CancellationTokenStatic } from './cancellation';
   *
   * // Test cancellation logic
   * await operation(CancellationTokenStatic.Cancelled);
   * ```
   */
  Cancelled: {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as ICancellationToken
};