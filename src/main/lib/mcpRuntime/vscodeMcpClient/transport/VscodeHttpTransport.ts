/**
 * VSCode MCP Client - HTTP/SSE Transport Implementation (VSCode Standard Compatible)
 * Fully based on VSCode's McpHTTPHandle implementation in extHostMcp.ts
 */

import { EventEmitter } from 'events';

export interface HttpTransportConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  method?: string;
}

export interface ConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  code?: string;
  message?: string;
}

const enum HttpMode {
  Unknown,
  Http,
  SSE,
}

type HttpModeT =
  | { value: HttpMode.Unknown }
  | { value: HttpMode.Http; sessionId: string | undefined }
  | { value: HttpMode.SSE; endpoint: string };

const MAX_FOLLOW_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

/**
 * Server-Sent Events parser (based on VSCode standard implementation)
 */
class SSEParser {
  private dataBuffer = '';
  private eventTypeBuffer = '';
  private currentEventId?: string;
  private lastEventIdBuffer?: string;
  private buffer: Uint8Array[] = [];
  private endedOnCR = false;
  private readonly decoder: TextDecoder;
  
  constructor(private onEvent: (event: SSEEvent) => void) {
    this.decoder = new TextDecoder('utf-8');
  }
  
  feed(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return;
    }

    let offset = 0;
    const Chr = {
      CR: 13, // '\r'
      LF: 10, // '\n'
      COLON: 58, // ':'
      SPACE: 32, // ' '
    };

    // Handle CR+LF boundary
    if (this.endedOnCR && chunk[0] === Chr.LF) {
      offset++;
    }
    this.endedOnCR = false;

    // Process complete lines
    while (offset < chunk.length) {
      const indexCR = chunk.indexOf(Chr.CR, offset);
      const indexLF = chunk.indexOf(Chr.LF, offset);
      const index = indexCR === -1 ? indexLF : (indexLF === -1 ? indexCR : Math.min(indexCR, indexLF));
      
      if (index === -1) {
        break;
      }

      let str = '';
      for (const buf of this.buffer) {
        str += this.decoder.decode(buf, { stream: true });
      }
      str += this.decoder.decode(chunk.subarray(offset, index));
      this.processLine(str);

      this.buffer.length = 0;
      offset = index + (chunk[index] === Chr.CR && chunk[index + 1] === Chr.LF ? 2 : 1);
    }

    if (offset < chunk.length) {
      this.buffer.push(chunk.subarray(offset));
    } else {
      this.endedOnCR = chunk[chunk.length - 1] === Chr.CR;
    }
  }

  private processLine(line: string): void {
    if (!line.length) {
      this.dispatchEvent();
      return;
    }

    if (line.startsWith(':')) {
      return; // Comment line
    }

    let field: string;
    let value: string;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      field = line;
      value = '';
    } else {
      field = line.substring(0, colonIndex);
      value = line.substring(colonIndex + 1);
      if (value.startsWith(' ')) {
        value = value.substring(1);
      }
    }

    this.processField(field, value);
  }

  private processField(field: string, value: string): void {
    switch (field) {
      case 'event':
        this.eventTypeBuffer = value;
        break;
      case 'data':
        this.dataBuffer += value;
        this.dataBuffer += '\n';
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.currentEventId = this.lastEventIdBuffer = value;
        } else {
          this.currentEventId = undefined;
        }
        break;
      case 'retry':
        // Ignore retry field in our implementation
        break;
    }
  }

  private dispatchEvent(): void {
    if (this.dataBuffer === '') {
      this.dataBuffer = '';
      this.eventTypeBuffer = '';
      return;
    }

    if (this.dataBuffer.endsWith('\n')) {
      this.dataBuffer = this.dataBuffer.substring(0, this.dataBuffer.length - 1);
    }

    const event: SSEEvent = {
      type: this.eventTypeBuffer || 'message',
      data: this.dataBuffer,
    };

    if (this.currentEventId !== undefined) {
      event.id = this.currentEventId;
    }

    this.onEvent(event);
    this.reset();
  }

  private reset(): void {
    this.dataBuffer = '';
    this.eventTypeBuffer = '';
    this.currentEventId = undefined;
  }
}

interface SSEEvent {
  type: string;
  data: string;
  id?: string;
}

interface MinimalRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string | null;
}

/**
 * VSCode-compatible HTTP/SSE Transport 
 * Fully based on VSCode McpHTTPHandle implementation, removed all custom AbortSignal monitoring
 */
export class VscodeHttpTransport extends EventEmitter {
  private currentState: ConnectionState = { state: 'stopped' };
  private mode: HttpModeT = { value: HttpMode.Unknown };
  private readonly _abortCtrl = new AbortController();
  private _disposed = false;
  
  constructor(private config: HttpTransportConfig) {
    super();
    this.emit('log', 'debug', `VscodeHttpTransport initialized for ${config.url}`);
  }
  
  public get state(): ConnectionState {
    return this.currentState;
  }
  
  /**
   * Start the HTTP/SSE connection
   */
  async start(): Promise<void> {
    this.setState({ state: 'starting' });
    
    try {
      // Start with unknown mode, let the first request determine the transport type
      this.setState({ state: 'running' });
      this.emit('log', 'debug', 'HTTP transport started successfully');
    } catch (error) {
      this.setState({
        state: 'error',
        message: `Failed to start HTTP transport: ${error}`
      });
      throw error;
    }
  }
  
  /**
   * Send message to the server
   */
  async send(message: string): Promise<void> {
    if (this.currentState.state !== 'running') {
      throw new Error('Transport is not running');
    }
    
    try {
      if (this.mode.value === HttpMode.Unknown) {
        // First message, use sequencing to determine mode
        await this._send(message);
      } else {
        await this._send(message);
      }
    } catch (err) {
      const msg = `Error sending message to ${this.config.url}: ${String(err)}`;
      this.setState({ state: 'error', message: msg });
      throw new Error(msg);
    }
  }
  
  private async _send(message: string): Promise<void> {
    if (this.mode.value === HttpMode.SSE) {
      return this._sendLegacySSE(this.mode.endpoint, message);
    } else {
      return this._sendStreamableHttp(message, this.mode.value === HttpMode.Http ? this.mode.sessionId : undefined);
    }
  }
  
  /**
   * Send a StreamableHTTP request (based on VSCode implementation)
   */
  private async _sendStreamableHttp(message: string, sessionId?: string): Promise<void> {
    const asBytes = new TextEncoder().encode(message);
    const headers: Record<string, string> = {
      ...this.config.headers,
      'Content-Type': 'application/json',
      'Content-Length': String(asBytes.length),
      'Accept': 'text/event-stream, application/json',
    };
    
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }
    
    const response = await this._fetch(this.config.url, {
      method: 'POST',
      headers,
      body: asBytes,
    });
    
    const wasUnknown = this.mode.value === HttpMode.Unknown;
    
    // Check for session ID in response
    const nextSessionId = response.headers.get('Mcp-Session-Id');
    if (nextSessionId) {
      this.mode = { value: HttpMode.Http, sessionId: nextSessionId };
    }
    
    // Handle 4xx errors (except auth errors) as SSE fallback signal
    if (this.mode.value === HttpMode.Unknown &&
        response.status >= 400 && response.status < 500 &&
        response.status !== 401 && response.status !== 403) {
      this.emit('log', 'info', `${response.status} status, falling back to SSE`);
      await this._sseFallbackWithMessage(message);
      return;
    }
    
    // Handle 5xx errors as potential server issues, try SSE fallback
    if (this.mode.value === HttpMode.Unknown && response.status >= 500) {
      this.emit('log', 'info', `${response.status} server error, trying SSE fallback`);
      await this._sseFallbackWithMessage(message);
      return;
    }
    
    if (response.status >= 300) {
      // Handle session retry for 400/404 errors
      const retryWithNewSession = this.mode.value === HttpMode.Http &&
                                 !!this.mode.sessionId &&
                                 (response.status === 400 || response.status === 404);
      
      throw new Error(`${response.status} status sending message: ${await this._getErrorText(response)}` +
                     (retryWithNewSession ? '; will retry with new session ID' : ''));
    }
    
    if (this.mode.value === HttpMode.Unknown) {
      this.mode = { value: HttpMode.Http, sessionId: undefined };
    }
    
    if (wasUnknown) {
      this._attachStreamableBackchannel();
    }
    
    await this._handleSuccessfulStreamableHttp(response, message);
  }
  
  /**
   * Handle successful StreamableHTTP response
   */
  private async _handleSuccessfulStreamableHttp(response: Response, originalMessage: string): Promise<void> {
    if (response.status === 202) {
      return; // No body
    }
    
    const contentType = response.headers.get('Content-Type')?.toLowerCase();
    
    switch (contentType) {
      case 'text/event-stream': {
        const parser = new SSEParser(event => {
          if (event.type === 'message') {
            this.emit('message', event.data);
          } else if (event.type === 'endpoint') {
            // Server incorrectly returned SSE endpoint, fallback
            this.emit('log', 'warning', 'Received SSE endpoint from POST, falling back to SSE');
            this._sseFallbackWithMessage(originalMessage);
          }
        });
        
        await this._doSSE(parser, response);
        break;
      }
      case 'application/json':
        this.emit('message', await response.text());
        break;
      default: {
        const responseBody = await response.text();
        if (this._isJSON(responseBody)) {
          this.emit('message', responseBody);
        } else {
          this.emit('log', 'warning', `Unexpected response: ${responseBody}`);
        }
      }
    }
  }
  
  /**
   * Attach SSE backchannel for async notifications (StreamableHTTP)
   * Improved version: creates an independent AbortController for each retry to avoid listener accumulation
   */
  private async _attachStreamableBackchannel(): Promise<void> {
    let lastEventId: string | undefined;
    
    for (let retry = 0; !this._isDisposed(); retry++) {
      // Don't delay on first attempt
      if (retry > 0) {
        await this._timeout(Math.min(retry * 1000, 30000));
      }
      
      // Create an independent AbortController for each retry
      const retryAbortController = new AbortController();
      
      // When the main AbortController is aborted, also abort this retry controller
      const mainAbortListener = () => {
        retryAbortController.abort();
      };
      this._abortCtrl.signal.addEventListener('abort', mainAbortListener);
      
      try {
        const headers: Record<string, string> = {
          ...this.config.headers,
          'Accept': 'text/event-stream',
        };
        
        if (this.mode.value === HttpMode.Http && this.mode.sessionId) {
          headers['Mcp-Session-Id'] = this.mode.sessionId;
        }
        
        if (lastEventId) {
          headers['Last-Event-ID'] = lastEventId;
        }
        
        const response = await this._fetchWithIndependentSignal(this.config.url, {
          method: 'GET',
          headers,
        }, retryAbortController.signal);
        
        if (response.status >= 400) {
          this.emit('log', 'debug', `${response.status} status on backchannel, disabling async notifications`);
          return;
        }
        
        if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
          retry = 0; // Reset on successful connection
        }
        
        const parser = new SSEParser(event => {
          if (event.type === 'message') {
            this.emit('message', event.data);
          }
          if (event.id) {
            lastEventId = event.id;
          }
        });
        
        await this._doSSEWithIndependentSignal(parser, response, retryAbortController.signal);
        
      } catch (error) {
        if (this._isDisposed() || retryAbortController.signal.aborted) {
          this.emit('log', 'debug', 'Backchannel aborted, stopping retry loop');
          break;
        }
        this.emit('log', 'info', `Backchannel error, will retry: ${error}`);
      } finally {
        // Clean up listeners to avoid memory leaks
        this._abortCtrl.signal.removeEventListener('abort', mainAbortListener);
        
        // Ensure this retry's AbortController is cleaned up
        if (!retryAbortController.signal.aborted) {
          retryAbortController.abort();
        }
      }
    }
  }
  
  /**
   * Fallback to legacy SSE mode
   */
  private async _sseFallbackWithMessage(message: string): Promise<void> {
    const endpoint = await this._attachSSE();
    if (endpoint) {
      this.mode = { value: HttpMode.SSE, endpoint };
      await this._sendLegacySSE(endpoint, message);
    }
  }
  
  /**
   * Establish SSE connection and get POST endpoint
   */
  private async _attachSSE(): Promise<string | undefined> {
    const headers: Record<string, string> = {
      ...this.config.headers,
      'Accept': 'text/event-stream',
    };
    
    try {
      const response = await this._fetch(this.config.url, {
        method: 'GET',
        headers,
      });
      
      if (response.status >= 300) {
        this.setState({
          state: 'error',
          message: `${response.status} status connecting as SSE: ${await this._getErrorText(response)}`
        });
        return;
      }
      
      return new Promise<string | undefined>((resolve, reject) => {
        let endpointFound = false;
        
        const parser = new SSEParser(event => {
          if (event.type === 'message') {
            this.emit('message', event.data);
          } else if (event.type === 'endpoint') {
            endpointFound = true;
            resolve(new URL(event.data, this.config.url).toString());
          }
        });
        
        this._doSSE(parser, response).catch(error => {
          if (!endpointFound) {
            reject(error);
          }
        });
      });
      
    } catch (error) {
      this.setState({
        state: 'error',
        message: `Error connecting as SSE: ${error}`
      });
      return;
    }
  }
  
  /**
   * Send legacy SSE message
   */
  private async _sendLegacySSE(url: string, message: string): Promise<void> {
    const asBytes = new TextEncoder().encode(message);
    const headers: Record<string, string> = {
      ...this.config.headers,
      'Content-Type': 'application/json',
      'Content-Length': String(asBytes.length),
    };
    
    const response = await this._fetch(url, {
      method: 'POST',
      headers,
      body: asBytes,
    });
    
    if (response.status >= 300) {
      this.emit('log', 'warning', `${response.status} status sending SSE message: ${await this._getErrorText(response)}`);
    }
  }
  
  /**
   * Generic handle to pipe a response into an SSE parser
   * Simplified implementation based on VSCode, directly using AbortController
   */
  private async _doSSE(parser: SSEParser, response: Response): Promise<void> {
    return this._doSSEWithIndependentSignal(parser, response, this._abortCtrl.signal);
  }

  /**
   * Generic handle to pipe a response into an SSE parser with independent signal
   * Uses an independent AbortSignal to avoid listener accumulation
   */
  private async _doSSEWithIndependentSignal(parser: SSEParser, response: Response, signal: AbortSignal): Promise<void> {
    if (!response.body) {
      return;
    }
    
    const reader = response.body.getReader();
    let chunk: ReadableStreamReadResult<Uint8Array>;
    
    do {
      try {
        chunk = await reader.read();
        
        // Check if we've been disposed or signal aborted during the read
        if (this._disposed || signal.aborted) {
          reader.cancel();
          return;
        }
      } catch (err) {
        reader.cancel();
        if (this._disposed || signal.aborted) {
          return;
        } else {
          throw err;
        }
      }
      
      if (chunk.value) {
        parser.feed(chunk.value);
      }
    } while (!chunk.done && !signal.aborted);
  }
  
  /**
   * Stop the transport
   */
  async stop(): Promise<void> {
    if (this.currentState.state === 'stopped') {
      return;
    }
    
    // Mark as disposed and abort
    this._disposed = true;
    this._abortCtrl.abort();
    
    this.setState({ state: 'stopped' });
    this.emit('log', 'debug', 'HTTP transport stopped');
  }
  
  /**
   * Enhanced fetch with redirect handling (based on VSCode implementation)
   */
  private async _fetch(url: string, init: MinimalRequestInit): Promise<Response> {
    return this._fetchWithIndependentSignal(url, init, this._abortCtrl.signal);
  }

  /**
   * Enhanced fetch with independent signal - avoids listener accumulation
   */
  private async _fetchWithIndependentSignal(url: string, init: MinimalRequestInit, signal: AbortSignal): Promise<Response> {
    this.emit('log', 'trace', `Fetching ${url} with method ${init.method}`);
    
    let currentUrl = url;
    let response!: Response;
    
    for (let redirectCount = 0; redirectCount < MAX_FOLLOW_REDIRECTS; redirectCount++) {
      response = await fetch(currentUrl, {
        method: init.method,
        headers: init.headers,
        body: init.body as BodyInit | null,
        signal: signal, // Use the passed-in independent signal
        redirect: 'manual'
      });
      
      if (!REDIRECT_STATUS_CODES.includes(response.status)) {
        break;
      }
      
      const location = response.headers.get('location');
      if (!location) {
        break;
      }
      
      const nextUrl = new URL(location, currentUrl).toString();
      this.emit('log', 'trace', `Redirect (${response.status}) from ${currentUrl} to ${nextUrl}`);
      currentUrl = nextUrl;
      
      // Adjust method for certain redirects
      if (response.status === 303 ||
          ((response.status === 301 || response.status === 302) && init.method === 'POST')) {
        init.method = 'GET';
        delete init.body;
      }
    }
    
    this.emit('log', 'trace', `Response: ${response.status} ${response.statusText}`);
    return response;
  }
  
  // Utility methods
  private setState(newState: ConnectionState): void {
    this.currentState = newState;
    this.emit('stateChange', newState);
  }
  
  private async _getErrorText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return response.statusText;
    }
  }
  
  private _isJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }
  
  private _isDisposed(): boolean {
    return this._disposed;
  }
  
  private _timeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}