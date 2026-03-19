/**
 * VSCode MCP Client - VSCode Transport to JsonRpc Transport Adapter
 * Bridges VscodeTransport interface to JsonRpcTransport interface
 */

import { JsonRpcTransport } from '../core/JsonRpc';
import { VscodeTransport } from '../transport/VscodeTransportFactory';

/**
 * Adapts VscodeTransport to JsonRpcTransport interface for use with JsonRpcClient
 */
export class VscodeToJsonRpcTransportAdapter implements JsonRpcTransport {
  private vscodeTransport: VscodeTransport;
  private messageListeners: ((message: string) => void)[] = [];
  private errorListeners: ((error: Error) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  
  // Unsubscribe functions from VscodeTransport
  private messageUnsubscribe?: () => void;
  private errorUnsubscribe?: () => void;
  private closeUnsubscribe?: () => void;
  private stateUnsubscribe?: () => void;

  constructor(vscodeTransport: VscodeTransport) {
    this.vscodeTransport = vscodeTransport;
    this.setupVscodeTransportListeners();
  }

  private setupVscodeTransportListeners(): void {
    // Listen to VscodeTransport messages and forward to JsonRpcClient
    this.vscodeTransport.on('message', this.handleMessage);
    
    // Listen to VscodeTransport state changes and convert to appropriate events
    this.vscodeTransport.on('stateChange', this.handleStateChange);
    
    // Listen to VscodeTransport logs for error detection
    this.vscodeTransport.on('log', this.handleLog);
  }

  private handleMessage = (message: string): void => {
    this.messageListeners.forEach(listener => {
      try {
        listener(message);
      } catch (error) {
        // Ignore listener errors to prevent cascading failures
      }
    });
  };

  private handleStateChange = (state: any): void => {
    // Convert VscodeTransport state changes to appropriate events
    if (state.state === 'error') {
      const error = new Error(state.message || 'Transport error');
      this.errorListeners.forEach(listener => {
        try {
          listener(error);
        } catch (err) {
          // Ignore listener errors
        }
      });
    } else if (state.state === 'stopped') {
      this.closeListeners.forEach(listener => {
        try {
          listener();
        } catch (error) {
          // Ignore listener errors
        }
      });
    }
  };

  private handleLog = (level: string, message: string): void => {
    // Convert error-level logs to error events
    if (level === 'error') {
      const error = new Error(`Transport log error: ${message}`);
      this.errorListeners.forEach(listener => {
        try {
          listener(error);
        } catch (err) {
          // Ignore listener errors
        }
      });
    }
  };

  // JsonRpcTransport interface implementation
  send(message: string): void {
    if (this.vscodeTransport.state.state !== 'running') {
      throw new Error(`Cannot send message: transport state is ${this.vscodeTransport.state.state}`);
    }
    
    // VscodeTransport.send() can return Promise<void> or void
    const result = this.vscodeTransport.send(message);
    
    // If it returns a promise, we should handle potential errors
    if (result && typeof result.catch === 'function') {
      result.catch((error: Error) => {
        // Forward send errors to error listeners
        this.errorListeners.forEach(listener => {
          try {
            listener(error);
          } catch (err) {
            // Ignore listener errors
          }
        });
      });
    }
  }

  onMessage(callback: (message: string) => void): () => void {
    this.messageListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.messageListeners.indexOf(callback);
      if (index >= 0) {
        this.messageListeners.splice(index, 1);
      }
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.errorListeners.indexOf(callback);
      if (index >= 0) {
        this.errorListeners.splice(index, 1);
      }
    };
  }

  onClose(callback: () => void): () => void {
    this.closeListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.closeListeners.indexOf(callback);
      if (index >= 0) {
        this.closeListeners.splice(index, 1);
      }
    };
  }

  async close(): Promise<void> {
    // Clean up our listeners first
    this.cleanup();
    
    // Stop the underlying VscodeTransport
    await this.vscodeTransport.stop();
  }

  private cleanup(): void {
    // Remove all event listeners from VscodeTransport
    this.vscodeTransport.off('message', this.handleMessage);
    this.vscodeTransport.off('stateChange', this.handleStateChange);
    this.vscodeTransport.off('log', this.handleLog);

    // Clear all listener arrays
    this.messageListeners.length = 0;
    this.errorListeners.length = 0;
    this.closeListeners.length = 0;
  }

  // Additional helper methods
  get state() {
    return this.vscodeTransport.state;
  }

  isReady(): boolean {
    return this.vscodeTransport.state.state === 'running';
  }

  /**
   * Get the underlying VscodeTransport for direct access if needed
   */
  getVscodeTransport(): VscodeTransport {
    return this.vscodeTransport;
  }
}