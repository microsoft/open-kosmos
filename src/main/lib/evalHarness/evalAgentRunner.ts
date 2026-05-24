// src/main/lib/evalHarness/evalAgentRunner.ts
import { generateEvalSessionId } from '../utilities/idFactory';
import type { RunTestRequest, RunTestResponse, RunTestMessageOutput } from './evalProtocol';
import type { Message, ToolCall } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import { agentChatManager } from "../chat/agentChatManager";
import { AgentChat } from "../chat/agentChat";
import { profileCacheManager } from "../userDataADO/profileCacheManager";
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SESSIONS = 10;

interface CachedSession {
  agentChat: import('../chat/agentChat').AgentChat;
  chatSessionId: string;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
  /** Number of messages in the conversation before the current turn. */
  messageCount: number;
  /** Per-session mutex: resolves when the current turn finishes. */
  turnLock: Promise<void>;
}

/**
 * Handles 'run_test' requests: full agent e2e loop.
 *
 * Single-turn (no session_id): creates a fresh AgentChat, runs the prompt,
 * destroys the agent — identical to pre-multi-turn behavior.
 *
 * Multi-turn (session_id): keeps AgentChat instances alive across requests.
 * First turn (no session_id) creates a session and returns its ID.
 * Subsequent turns (with session_id) reuse the same AgentChat.
 * Sessions are evicted after 15 minutes of inactivity.
 *
 * Concurrency: each session serializes turns via a per-session lock.
 * Overlapping requests on the same session_id queue behind the running turn.
 */
export class EvalAgentRunner {
  private userAlias: string;
  private sessions: Map<string, CachedSession> = new Map();

  constructor(userAlias: string) {
    this.userAlias = userAlias;
  }

  async run(request: RunTestRequest): Promise<RunTestResponse> {
    const sessionId = request.session_id;

    if (sessionId) {
      // Continue existing session
      return this.runWithSession(request, sessionId);
    } else {
      // No session_id — single-turn (backward compatible)
      return this.runOneShot(request);
    }
  }

  /**
   * Single-turn execution — creates and destroys agent per request.
   * Returns a session_id in metadata so the orchestrator can continue
   * the conversation if this turns out to be a multi-turn test case.
   *
   * The agent is cached only after the turn completes successfully.
   * If the caller has already timed out (via AbortSignal), the session
   * is NOT cached and the agent is destroyed.
   */
  async runOneShot(request: RunTestRequest, signal?: AbortSignal): Promise<RunTestResponse> {
    const chatId = await this.getDefaultChatId();
    const chatSessionId = agentChatManager.generateChatSessionId();
    const newSessionId = generateEvalSessionId();

    const agentChat = await this.createHeadlessAgent(chatId, chatSessionId);

    try {
      const userMessage = MessageHelper.createTextMessage(request.data.prompt, 'user', `eval_${request.id}`);
      const messages = await agentChat.streamMessage(userMessage);

      // If the caller already timed out, don't cache — destroy immediately
      if (signal?.aborted) {
        this.cleanupAgent(agentChat);
        throw new Error('Request was aborted before caching');
      }

      const outputMessages = this.convertMessages(messages);
      const subAgentMessages = this.extractSubAgentMessages(messages);

      // Cache the session for potential multi-turn continuation
      // Track message count so subsequent turns can return only new messages
      this.cacheSession(newSessionId, agentChat, chatSessionId, messages.length);

      return {
        messages: outputMessages,
        sub_agent_messages: subAgentMessages,
        metadata: { session_id: newSessionId },
        session_id: newSessionId,
      };
    } catch (error) {
      // On error, destroy immediately — don't cache a broken session
      this.cleanupAgent(agentChat);
      throw error;
    }
  }

  /**
   * Multi-turn execution — reuses an existing AgentChat session.
   * Serializes turns via per-session lock to prevent concurrent mutation.
   */
  private async runWithSession(
    request: RunTestRequest,
    sessionId: string
  ): Promise<RunTestResponse> {
    const cached = this.sessions.get(sessionId);
    if (!cached) {
      throw new Error(
        `Session not found: ${sessionId}. It may have expired (idle timeout: ${SESSION_IDLE_TIMEOUT_MS / 1000}s).`
      );
    }

    // Serialize turns: chain behind whatever is currently running.
    // We must capture and replace the lock synchronously before awaiting,
    // so concurrent callers see the new lock immediately.
    const previousTurn = cached.turnLock;
    let resolveTurn!: () => void;
    const turnPromise = new Promise<void>((resolve) => { resolveTurn = resolve; });
    cached.turnLock = turnPromise;

    await previousTurn;

    // Reset idle timer
    clearTimeout(cached.idleTimer);
    cached.lastUsed = Date.now();
    cached.idleTimer = setTimeout(
      () => this.evictSession(sessionId),
      SESSION_IDLE_TIMEOUT_MS
    );

    try {
      const userMessage = MessageHelper.createTextMessage(request.data.prompt, 'user', `eval_${request.id}`);
      // Track message count before this turn to extract only new messages
      const messageCountBefore = cached.messageCount;

      const allMessages = await cached.agentChat.streamMessage(userMessage);

      // Only return messages from THIS turn (streamMessage returns full history)
      const newMessages = allMessages.slice(messageCountBefore);
      cached.messageCount = allMessages.length;

      const outputMessages = this.convertMessages(newMessages);
      const subAgentMessages = this.extractSubAgentMessages(newMessages);

      return {
        messages: outputMessages,
        sub_agent_messages: subAgentMessages,
        metadata: { session_id: sessionId },
        session_id: sessionId,
      };
    } catch (error) {
      // On error during a turn, evict the session — it may be in a bad state
      this.evictSession(sessionId);
      throw error;
    } finally {
      resolveTurn();
    }
  }

  /**
   * Cache an AgentChat session for multi-turn reuse.
   */
  private cacheSession(
    sessionId: string,
    agentChat: import('../chat/agentChat').AgentChat,
    chatSessionId: string,
    messageCount: number
  ): void {
    // Evict oldest session if at capacity
    if (this.sessions.size >= MAX_SESSIONS) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of this.sessions) {
        if (s.lastUsed < oldestTime) {
          oldestTime = s.lastUsed;
          oldestId = id;
        }
      }
      if (oldestId) {
        this.evictSession(oldestId);
      }
    }

    const idleTimer = setTimeout(
      () => this.evictSession(sessionId),
      SESSION_IDLE_TIMEOUT_MS
    );

    this.sessions.set(sessionId, {
      agentChat,
      chatSessionId,
      lastUsed: Date.now(),
      idleTimer,
      messageCount,
      turnLock: Promise.resolve(),
    });
  }

  /**
   * Evict and destroy a cached session.
   */
  private evictSession(sessionId: string): void {
    const cached = this.sessions.get(sessionId);
    if (!cached) return;

    clearTimeout(cached.idleTimer);
    this.cleanupAgent(cached.agentChat);
    this.sessions.delete(sessionId);
    logger.info('[EvalAgentRunner] Session evicted', 'evictSession', { sessionId });
  }

  /**
   * Destroy all cached sessions. Called on server shutdown.
   */
  destroyAllSessions(): void {
    for (const [sessionId] of this.sessions) {
      this.evictSession(sessionId);
    }
  }

  /**
   * Creates a headless AgentChat instance (no renderer, no IPC).
   * Mirrors the pattern from AgentChatManager.runScheduledJob().
   */
  private async createHeadlessAgent(
    chatId: string,
    chatSessionId: string
  ): Promise<import('../chat/agentChat').AgentChat> {

    const chatConfig = profileCacheManager.getChatConfig(this.userAlias, chatId);
    if (!chatConfig || !chatConfig.agent) {
      throw new Error(
        `No chat config found for chatId: ${chatId}, userAlias: ${this.userAlias}`
      );
    }

    const agent = new AgentChat(this.userAlias, chatId, chatSessionId);
    await agent.initialize();
    agent.setEventSender(null); // headless — no UI streaming
    agent.setSkipPersistence(true); // eval sessions are not persisted

    return agent;
  }

  /**
   * Gets the default agent's chatId from the user's profile.
   */
  private async getDefaultChatId(): Promise<string> {
    const profile = profileCacheManager.getCachedProfile(this.userAlias);

    if (!profile) {
      throw new Error(`No profile found for user alias: ${this.userAlias}`);
    }

    const allChats = profileCacheManager.getAllChatConfigs(this.userAlias);
    const primaryAgentName = profile.primaryAgent || 'Kobi';
    const defaultChat = allChats.find(
      (c) => c.agent?.name === primaryAgentName
    );

    if (!defaultChat) {
      throw new Error(
        `No chat config found for primary agent "${primaryAgentName}"`
      );
    }

    return defaultChat.chat_id;
  }

  /**
   * Converts internal Message[] to the protocol's output format.
   */
  private convertMessages(messages: Message[]): RunTestMessageOutput[] {
    return messages
      .map((msg) => {
        const output: RunTestMessageOutput = {
          role: msg.role as RunTestMessageOutput['role'],
          content: MessageHelper.getText(msg),
        };

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          output.tool_calls = msg.tool_calls.map((tc: ToolCall) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));
        }

        if (msg.role === 'tool') {
          output.tool_call_id = msg.tool_call_id;
        }

        return output;
      });
  }

  /**
   * Extracts sub-agent message lists from spawn_subagent tool results.
   * Sub-agent results are embedded in tool result messages.
   */
  private extractSubAgentMessages(
    messages: Message[]
  ): RunTestMessageOutput[][] {
    const subAgentResults: RunTestMessageOutput[][] = [];

    for (const msg of messages) {
      if (msg.role !== 'tool') continue;

      const text = MessageHelper.getText(msg);

      try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.messages)) {
          subAgentResults.push(
            parsed.messages.map((m: any) => ({
              role: m.role || 'assistant',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            }))
          );
        }
      } catch {
        // Not JSON or no sub-agent data — skip
      }
    }

    return subAgentResults;
  }

  /**
   * Cleans up an AgentChat instance.
   */
  private cleanupAgent(agentChat: import('../chat/agentChat').AgentChat): void {
    try {
      agentChat.destroy();
    } catch {
      // Cleanup failure is non-fatal
    }
  }
}
