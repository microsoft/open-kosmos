/**
 * VSCode MCP Client - Main Client Implementation (VSCode Standard Compatible)
 * Based on VSCode's MCP implementation patterns
 */

import { EventEmitter } from 'events';
import { VscodeTransportFactory, VscodeTransport } from './transport/VscodeTransportFactory';
import { UnifiedLogger, createConsoleLogger } from '../../unifiedLogger';
import type { McpServerConfig } from '../../userDataADO/types/profile';
import {
  MCP_CONNECT_TIMEOUT_MS,
  MCP_CONTROL_REQUEST_TIMEOUT_MS,
  TOOL_IDLE_TIMEOUT_MS,
  IDLE_TIMEOUT_ESCALATION_THRESHOLD,
  IDLE_TIMEOUT_ESCALATION_WINDOW_MS,
  ConnectionTimeoutError,
  ToolIdleTimeoutError,
  McpProtocolConnectionError,
  InactivityTimer,
} from '../toolTimeoutPolicy';
import { classifyProtocolError } from '../mcpReconnectPolicy';

export interface VscodeMcpServerConfig {
  name: string;
  type?: 'stdio' | 'http' | 'sse' | 'streamablehttp';

  // Stdio-specific fields
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | null>;
  envFile?: string;

  // HTTP/SSE-specific fields
  url?: string;
  headers?: Record<string, string>;
  method?: string;

  // Common fields
  timeout?: number;
  initTimeout?: number;  // Separate timeout for initialization
  retryAttempts?: number;  // Number of retry attempts
  retryDelay?: number;     // Delay between retries

  /**
   * Original full MCP server configuration. Threaded through so the HTTP
   * transport can pass it to McpAuthService for OAuth provider construction.
   * Optional because tests / legacy callers may not supply it; the OAuth
   * branch falls back to MS-only behavior when this is missing.
   */
  mcpServerConfig?: McpServerConfig;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  message?: string;
  code?: string;
}

/**
 * VSCode-compatible MCP Client
 * Implements behavior similar to VSCode's MCP client implementation
 */
export class VscodeMcpClient extends EventEmitter {
  private transport: VscodeTransport | null = null;
  private currentState: ConnectionState = { state: 'stopped' };
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  /**
   * Activity hooks for in-flight idle-tracked requests. Request responses are
   * keyed by JSON-RPC id; progress notifications are keyed by MCP progressToken
   * so concurrent tool calls do not reset each other's no-response budget.
   */
  private requestActivityListeners = new Map<string | number, () => void>();
  private progressActivityListeners = new Map<string | number, () => void>();
  private isInitialized = false;
  private logger: UnifiedLogger;
  /**
   * Consecutive tool idle timeouts and the timestamp of the last one. A single timeout fails only
   * its own request; {@link IDLE_TIMEOUT_ESCALATION_THRESHOLD} back-to-back timeouts (within
   * {@link IDLE_TIMEOUT_ESCALATION_WINDOW_MS}) escalate to a connection reset. Any matched response
   * resets the count, so only a genuinely wedged transport escalates.
   */
  private consecutiveIdleTimeouts = 0;
  private lastIdleTimeoutAt = 0;

  constructor(private config: VscodeMcpServerConfig) {
    super();
    this.logger = createConsoleLogger();
    this.log('debug', `Creating MCP client for server: ${config.name}`);
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.currentState.state === 'running' || this.currentState.state === 'starting') {
      return;
    }

    this.setState({ state: 'starting' });

    // The connection steps (transport start -> initialize handshake ->
    // tools/list) share a single budget. The `initialize` wait is otherwise
    // unbounded, so without this a misbehaving server could hang `connecting`
    // forever. Exceeding the budget tears the connection down and surfaces an
    // error state.
    let timedOut = false;
    let connectTimer: NodeJS.Timeout | undefined;
    const connectBudget = new Promise<never>((_, reject) => {
      connectTimer = setTimeout(() => {
        timedOut = true;
        reject(new ConnectionTimeoutError(this.config.name, MCP_CONNECT_TIMEOUT_MS));
      }, MCP_CONNECT_TIMEOUT_MS);
    });

    try {
      // Create transport
      this.transport = VscodeTransportFactory.createFromVscodeConfig(this.config.name, this.config);

      // Setup transport event handlers
      this.setupTransportHandlers();

      // Run the connection steps as one unit and race them against the budget.
      const steps = (async () => {
        await this.transport!.start();
        await this.initializeMcp();
        await this.discoverTools();
      })();
      // If the budget wins, `steps` may still reject later (we reject the in-flight
      // `initialize` during teardown). Swallow that here so it does not surface as an
      // unhandled rejection; the real failure is propagated through the race.
      steps.catch(() => { /* handled by the connect-budget branch below */ });

      await Promise.race([steps, connectBudget]);

      this.setState({ state: 'running' });
      this.log('info', `Connected to MCP server: ${this.config.name}`);
      this.discoverResources().catch((error) => {
        this.log('warning', `Failed to discover resources after connect: ${error}`);
      });

    } catch (error) {
      const connectError = timedOut
        ? new ConnectionTimeoutError(this.config.name, MCP_CONNECT_TIMEOUT_MS)
        : error instanceof Error
          ? error
          : new Error(String(error));

      // Any failed connect attempt must tear down the transport. Otherwise a
      // server that starts and initializes, then fails tools/list, can leave its
      // process running while the adapter already reports isConnected=false.
      this.rejectPendingRequests(connectError);
      if (this.transport) {
        try {
          await this.transport.stop();
        } catch (stopError) {
          this.log('warning', `Failed to stop MCP transport after connect failure: ${stopError}`);
        }
      }

      // Try to get stderr output from the transport to provide more detailed error information
      let errorMessage = connectError.message;

      // Check whether the error message already includes stderr output to avoid duplicate appending
      // (methods such as initializeMcp may have already included stderr in the error message)
      const alreadyHasStderr = /stderr output:/i.test(errorMessage);

      if (!alreadyHasStderr && this.transport && 'getStderrPreview' in this.transport) {
        const stderrOutput = (this.transport as any).getStderrPreview();
        if (stderrOutput && stderrOutput.trim().length > 0) {
          errorMessage = `${errorMessage}\n\nStderr output:\n${stderrOutput.trim()}`;
        }
      }
      this.transport = null;
      this.isInitialized = false;
      this.tools = [];
      this.resources = [];
      this.setState({
        state: 'error',
        message: errorMessage
      });
      throw new Error(errorMessage);
    } finally {
      if (connectTimer) {
        clearTimeout(connectTimer);
      }
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.currentState.state === 'stopped') {
      return;
    }

    try {
      // Clear pending requests
      this.pendingRequests.forEach((pending) => {
        pending.reject(new Error('Connection closed'));
      });
      this.pendingRequests.clear();

      // Stop transport
      if (this.transport) {
        await this.transport.stop();
      }

    } finally {
      this.transport = null;
      this.isInitialized = false;
      this.tools = [];
      this.resources = [];
      this.setState({ state: 'stopped' });
      this.log('info', `Disconnected from MCP server: ${this.config.name}`);
    }
  }

  /**
   * Execute a tool
   */
  async callTool(name: string, arguments_: Record<string, any>, options?: { signal?: AbortSignal }): Promise<any> {
    if (this.currentState.state !== 'running') {
      throw new Error('Client is not connected');
    }

    const requestId = this.getNextRequestId();
    const progressToken = `tool-call-${requestId}`;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name,
        arguments: arguments_,
        _meta: { progressToken },
      }
    };

    this.log('debug', `Calling tool: ${name}`);
    // Tool execution has no fixed time cap. It is only force-terminated after
    // TOOL_IDLE_TIMEOUT_MS elapse with no response/progress for this request.
    return this.sendRequestTracked(
      request,
      { kind: 'idle', idleMs: TOOL_IDLE_TIMEOUT_MS, label: `tools/call:${name}`, progressToken },
      options
    );
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<any> {
    if (this.currentState.state !== 'running') {
      throw new Error('Client is not connected');
    }

    const request = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'resources/read',
      params: { uri }
    };

    this.log('debug', `Reading resource: ${uri}`);
    return this.sendRequest(request);
  }

  /**
   * Get available tools
   */
  getTools(): McpTool[] {
    return [...this.tools];
  }

  /**
   * Get available resources
   */
  getResources(): McpResource[] {
    return [...this.resources];
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return { ...this.currentState };
  }

  /**
   * Get server configuration
   */
  getConfig(): VscodeMcpServerConfig {
    return { ...this.config };
  }

  // Private methods

  private setupTransportHandlers(): void {
    if (!this.transport) return;

    this.transport.on('message', (message: string) => {
      this.handleMessage(message);
    });

    this.transport.on('stateChange', (state: any) => {
      const shouldRejectPendingRequests = state.state === 'error'
        || (state.state === 'stopped' && this.pendingRequests.size > 0);

      if (shouldRejectPendingRequests) {
        const errorMessage = state.message
          || (state.state === 'stopped'
            ? 'Transport stopped before the MCP request completed'
            : 'Transport error');

        this.rejectPendingRequests(new Error(errorMessage));
      }

      if (state.state === 'error') {
        this.setState({
          state: 'error',
          message: state.message || 'Transport error'
        });
      } else if (state.state === 'stopped' && this.currentState.state === 'starting') {
        this.setState({
          state: 'error',
          message: state.message || 'Transport stopped before the MCP connection was established'
        });
      }
    });

    this.transport.on('log', (level: string, message: string) => {
      this.log(level as any, message);
    });
  }

  private async initializeMcp(): Promise<void> {
    // Aligned with VS Code: no initialization timeout or retry mechanism
    // When an MCP server starts, it may need to download dependencies; timing is unpredictable
    this.log('debug', 'Initializing MCP server...');

    try {
      const initRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {}
          },
          clientInfo: {
            name: 'VSCode-MCP-Client',
            version: '1.0.0'
          }
        }
      };

      // Do not set a timeout; wait for the MCP server to respond
      const response = await this.sendRequestNoTimeout(initRequest);
      this.log('debug', `MCP server capabilities: ${JSON.stringify(response.capabilities)}`);

      // Send initialized notification
      await this.sendNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });

      this.isInitialized = true;
      this.log('info', 'Successfully initialized MCP server');

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Get stderr output to provide more detailed error information
      let stderrInfo = '';
      let errorMsg = errorObj.message;

      // Clean up any existing "Stderr output" section in errorMsg to avoid duplication
      errorMsg = errorMsg.replace(/\n+stderr output:[\s\S]*$/i, '').trimEnd();

      // Retrieve the latest stderr uniformly from the transport
      if (this.transport && 'getStderrPreview' in this.transport) {
        const stderrOutput = (this.transport as any).getStderrPreview();

        if (stderrOutput && stderrOutput.length > 0) {
          const cleanOutput = stderrOutput.trim();

          // If the truncated message already contains substantial stderr content, do not add more
          if (!errorMsg.includes(cleanOutput.substring(0, Math.min(50, cleanOutput.length)))) {
            stderrInfo = `\n\nStderr output:\n${cleanOutput}`;
          }
        }
      }

      const finalErrorMessage = `Failed to initialize MCP server: ${errorMsg}${stderrInfo}`;
      this.log('error', finalErrorMessage);
      throw new Error(finalErrorMessage);
    }
  }

  private async discoverTools(): Promise<void> {
    // Required connect step. It is governed by the outer connection budget,
    // not by the short fixed timeout used for non-connect control requests.
    const toolsResponse = await this.sendRequestNoTimeout({
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/list'
    });

    this.tools = toolsResponse.tools || [];
    this.log('debug', `Discovered ${this.tools.length} tools`);
  }

  private async discoverResources(): Promise<void> {
    try {
      // List resources
      const resourcesResponse = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'resources/list'
      });

      this.resources = resourcesResponse.resources || [];
      this.log('debug', `Discovered ${this.resources.length} resources`);

    } catch (error) {
      this.log('warning', `Failed to list resources: ${error}`);
    }
  }

  private async sendRequest(request: any, options?: { signal?: AbortSignal }): Promise<any> {
    return this.sendRequestTracked(
      request,
      { kind: 'fixed', timeoutMs: MCP_CONTROL_REQUEST_TIMEOUT_MS },
      options
    );
  }

  /**
   * Send a request with no per-request timeout. The caller must be inside a
   * higher-level budget such as the connect race.
   */
  private async sendRequestNoTimeout(request: any): Promise<any> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });

      const messageStr = JSON.stringify(request);
      this.log('trace', `Sending request (no timeout): ${messageStr}`);

      try {
        // Call send and check if it is async (returns a Promise)
        const sendResult = this.transport!.send(messageStr);
        if (sendResult instanceof Promise) {
          sendResult.catch(error => {
            if (this.pendingRequests.has(request.id)) {
              this.pendingRequests.delete(request.id);
              reject(error);
            }
          });
        }
      } catch (error) {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      }
    });
  }

  /**
   * Send a request and track it until a response arrives, the caller aborts, or a
   * deadline is reached. Two deadline strategies are supported:
   *  - `fixed`: reject after `timeoutMs` of total elapsed time. Used for short
   *    control requests (resources/list, resources/read). The connect-time
   *    tools/list request is required and is governed by the outer connect budget.
   *  - `idle`: never cap total duration; reject only after `idleMs` elapse with no
   *    response or progress notification for this request. Used for tools/call so a
   *    long-running tool is bounded by no-response time, not total time.
   */
  private async sendRequestTracked(
    request: any,
    deadline:
      | { kind: 'fixed'; timeoutMs: number }
      | { kind: 'idle'; idleMs: number; label: string; progressToken: string | number },
    options?: { signal?: AbortSignal }
  ): Promise<any> {
    if (options?.signal?.aborted) {
      throw new Error(`Request aborted: ${request.method}`);
    }

    return new Promise((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      let activityListener: (() => void) | undefined;
      let activityProgressToken: string | number = request.id;
      // Assigned synchronously below before any code path can invoke cleanup().
      let watchdog!: { dispose: () => void };

      const cleanup = () => {
        watchdog.dispose();
        if (activityListener) {
          this.requestActivityListeners.delete(request.id);
          this.progressActivityListeners.delete(activityProgressToken);
        }
        if (options?.signal && abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      };

      // clearTimeout / InactivityTimer.dispose inside cleanup() guarantee the deadline
      // callback never runs once the request has settled, so neither branch below
      // needs an inner settled-guard.
      if (deadline.kind === 'idle') {
        const idle = new InactivityTimer(deadline.idleMs, () => {
          this.pendingRequests.delete(request.id);
          cleanup();
          const idleError = new ToolIdleTimeoutError(deadline.label, deadline.idleMs);
          this.log('error', idleError.message);
          // Request-level timeout: fail ONLY this request and keep the transport so other tools
          // on the same server stay usable. Repeated back-to-back timeouts escalate to a reset.
          this.handleRequestIdleTimeout(request.id, idleError);
          reject(idleError);
        });
        watchdog = idle;
        // Only this request's response or matching progress notification resets
        // the idle countdown. Other concurrent server traffic must not keep a
        // silent tool alive indefinitely.
        activityListener = () => idle.touch();
        activityProgressToken = deadline.progressToken;
        this.requestActivityListeners.set(request.id, activityListener);
        this.progressActivityListeners.set(deadline.progressToken, activityListener);
      } else {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(request.id);
          cleanup();
          const errorMsg = `Request timeout: ${request.method} (${deadline.timeoutMs}ms)`;
          this.log('error', errorMsg);
          reject(new Error(errorMsg));
        }, deadline.timeoutMs);
        watchdog = { dispose: () => clearTimeout(timer) };
      }

      this.pendingRequests.set(request.id, {
        resolve: (value: any) => {
          cleanup();
          resolve(value);
        },
        reject: (error: any) => {
          cleanup();
          reject(error);
        }
      });

      if (options?.signal) {
        abortHandler = () => {
          this.pendingRequests.delete(request.id);
          cleanup();
          reject(new Error(`Request aborted: ${request.method}`));
        };
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const messageStr = JSON.stringify(request);
      this.log('trace', `Sending request: ${messageStr}`);

      // Only reject if the request is still pending, to avoid a double settle.
      const failIfPending = (error: any) => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          cleanup();
          reject(error);
        }
      };

      try {
        // Call send and check if it is async (returns a Promise)
        const sendResult = this.transport!.send(messageStr);
        if (sendResult instanceof Promise) {
          sendResult.catch(failIfPending);
        }
      } catch (error) {
        failIfPending(error);
      }
    });
  }

  private async sendNotification(notification: any): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }

    const messageStr = JSON.stringify(notification);
    this.log('trace', `Sending notification: ${messageStr}`);

    // Call send and check if it is async (returns a Promise)
    const sendResult = this.transport.send(messageStr);
    if (sendResult instanceof Promise) {
      await sendResult;
    }
  }

  private handleMessage(messageStr: string): void {
    try {
      const message = JSON.parse(messageStr);
      this.log('trace', `Received message: ${messageStr}`);

      this.touchActivityForMessage(message);

      const id = message.id;
      const isMatched =
        id !== undefined && id !== null && id !== '' && this.pendingRequests.has(id);

      if (isMatched) {
        // Response to a request
        const pending = this.pendingRequests.get(id)!;

        // A real reply (success or business error) proves the transport is healthy, so any
        // accumulated idle-timeout escalation count is cleared.
        this.consecutiveIdleTimeouts = 0;

        if (message.error) {
          const err = message.error;
          // A matched error that signals a lost session (e.g. -32001 "Session not found") is fatal
          // to the whole connection even though the proxy echoed this request's id. Fail the
          // connection so the manager auto-reconnects, instead of only rejecting this one request
          // and leaving a dead session "running". failConnection rejects every pending request
          // (including this one, still in the map) with the protocol error.
          if (classifyProtocolError(err) === 'connection-lost') {
            const description = `MCP Error: ${err.message ?? 'unknown error'} (${err.code ?? 'n/a'})`;
            this.failConnection(new McpProtocolConnectionError(description, err.code));
            return;
          }
          this.pendingRequests.delete(id);
          pending.reject(new Error(`MCP Error: ${err.message} (${err.code})`));
        } else {
          this.pendingRequests.delete(id);
          pending.resolve(message.result);
        }
      } else if (message.error) {
        // An error response whose id does not map to any pending request (empty / missing /
        // mismatched). Previously this fell into the notification branch and was silently
        // dropped, hanging the real request until the idle watchdog fired 10 minutes later.
        this.handleUnmatchedErrorResponse(message);
      } else if (id === undefined || id === null || id === '') {
        // Notification from server
        this.handleNotification(message);
      }
      // else: a response id we no longer track and no error → ignore (late / duplicate).

    } catch (error) {
      this.log('error', `Failed to parse message: ${error}`);
    }
  }

  /**
   * Handle a JSON-RPC error response that could not be matched to a pending request.
   *
   * `connection-lost` errors (e.g. proxy "Session not found", code -32001) mean every pending
   * request on this connection is doomed, so the connection is failed immediately to let the
   * manager auto-reconnect. Otherwise, when exactly one request is in flight the error almost
   * certainly belongs to it, so that single request is failed while the connection is kept.
   */
  private handleUnmatchedErrorResponse(message: any): void {
    // The only caller reaches this branch under `else if (message.error)`, so `error` is present.
    const err = message.error;
    const description = `MCP Error: ${err.message ?? 'unknown error'} (${err.code ?? 'n/a'})`;
    this.log(
      'warning',
      `mcp.protocol.unmatched-error (id=${JSON.stringify(message?.id)}): ${description}`,
    );

    if (classifyProtocolError(err) === 'connection-lost') {
      this.failConnection(new McpProtocolConnectionError(description, err.code));
      return;
    }

    // Only an *id-less* error may be attributed to a lone in-flight request (the proxy case this
    // exists for). An error that carries a concrete id which no longer maps to a pending request is
    // a late/stale reply for an already-removed request (e.g. one that idle-timed-out and was
    // replaced by a new call); rejecting the current request would fail the WRONG tool call, so a
    // concrete-id miss is logged only.
    const id = message.id;
    const isIdless = id === undefined || id === null || id === '';
    if (isIdless && this.pendingRequests.size === 1) {
      const onlyId = this.pendingRequests.keys().next().value as number;
      const pending = this.pendingRequests.get(onlyId)!;
      this.pendingRequests.delete(onlyId);
      pending.reject(new Error(description));
    }
    // concrete-id miss, or zero / multiple pending → cannot attribute; logged only, connection kept.
  }

  private handleNotification(notification: any): void {
    this.log('debug', `Received notification: ${notification.method}`);
    this.emit('notification', notification);
  }

  private touchActivityForMessage(message: any): void {
    if (message.id !== undefined) {
      this.requestActivityListeners.get(message.id)?.();
    }

    if (message.method === 'notifications/progress') {
      const progressToken = message.params?.progressToken;
      if (progressToken !== undefined) {
        this.progressActivityListeners.get(progressToken)?.();
      }
    }
  }

  private rejectPendingRequests(error: Error): void {
    if (this.pendingRequests.size === 0) {
      return;
    }

    this.pendingRequests.forEach((pending) => {
      pending.reject(error);
    });

    this.pendingRequests.clear();
  }

  /**
   * React to a single tool no-response (idle) timeout at the REQUEST level.
   *
   * The offending request has already been removed and rejected by the caller. Here we best-effort
   * ask the server to cancel it and keep a sliding count of consecutive timeouts. Only when
   * {@link IDLE_TIMEOUT_ESCALATION_THRESHOLD} timeouts occur back-to-back (a sign the transport
   * itself is wedged, not just one slow tool) do we escalate to a connection reset, which the
   * manager then auto-reconnects.
   */
  private handleRequestIdleTimeout(requestId: number, idleError: ToolIdleTimeoutError): void {
    this.log('warning', `mcp.tool.timeout.request (id=${requestId}): ${idleError.message}`);
    this.sendCancellationNotification(requestId, idleError.message);

    const now = Date.now();
    this.consecutiveIdleTimeouts =
      now - this.lastIdleTimeoutAt <= IDLE_TIMEOUT_ESCALATION_WINDOW_MS
        ? this.consecutiveIdleTimeouts + 1
        : 1;
    this.lastIdleTimeoutAt = now;

    if (this.consecutiveIdleTimeouts >= IDLE_TIMEOUT_ESCALATION_THRESHOLD) {
      this.log(
        'warning',
        `mcp.tool.timeout.escalated after ${this.consecutiveIdleTimeouts} consecutive idle timeouts`,
      );
      this.consecutiveIdleTimeouts = 0;
      this.failConnection(idleError);
    }
  }

  /**
   * Best-effort `notifications/cancelled` so a still-running server can abandon a timed-out call.
   * Failures are ignored: the request is already rejected locally and late replies are dropped by
   * id matching.
   */
  private sendCancellationNotification(requestId: number, reason: string): void {
    if (!this.transport) {
      return;
    }
    void this.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId, reason },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.log('debug', `Failed to send cancellation for request ${requestId}: ${message}`);
    });
  }

  /**
   * Fail the whole connection: move to `error`, reject all pending requests, and tear down the
   * transport. Used for fatal protocol errors (lost upstream session) and for escalated repeated
   * idle timeouts. The emitted `error` state lets {@link module:mcpClientManager} auto-reconnect.
   */
  private failConnection(error: Error): void {
    this.setState({
      state: 'error',
      message: error.message
    });

    this.rejectPendingRequests(error);

    const transport = this.transport;
    if (!transport) {
      return;
    }

    void transport.stop()
      .catch((stopError) => {
        const message = stopError instanceof Error ? stopError.message : String(stopError);
        this.log('warning', `Failed to stop MCP transport after connection failure: ${message}`);
      })
      .finally(() => {
        if (this.transport === transport) {
          this.transport = null;
          this.isInitialized = false;
          this.tools = [];
          this.resources = [];
        }
      });
  }

  private getNextRequestId(): number {
    return ++this.requestId;
  }

  private setState(newState: ConnectionState): void {
    this.currentState = newState;
    this.emit('stateChange', newState);
  }

  private log(level: 'trace' | 'debug' | 'info' | 'warning' | 'error', message: string): void {
    const logMessage = `[${this.config.name}] ${message}`;
    this.emit('log', level, logMessage);

    if (this.logger) {
      let upperLevel = level.toUpperCase();
      // Map levels to match UnifiedLogger expectations
      if (upperLevel === 'TRACE') upperLevel = 'DEBUG';
      if (upperLevel === 'WARNING') upperLevel = 'WARN';

      this.logger.log(upperLevel as any, message, 'VscodeMcpClient', {
        serverName: this.config.name
      });
    }
  }
}