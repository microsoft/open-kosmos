import { CancellationTokenSource } from '../cancellation';
import { createLogger } from '../unifiedLogger';
import { AgentChat } from './agentChat';

const logger = createLogger();

export type AgentChatRuntimeMode = 'interactive' | 'scheduled-silent';

export class AgentChatManagerRegistry {
  private readonly agentInstances = new Map<string, AgentChat>();
  private readonly cancellationSources = new Map<string, CancellationTokenSource>();
  private readonly runtimeModes = new Map<string, AgentChatRuntimeMode>();

  getInstance(chatSessionId: string): AgentChat | null {
    return this.agentInstances.get(chatSessionId) || null;
  }

  hasInstance(chatSessionId: string): boolean {
    return this.agentInstances.has(chatSessionId);
  }

  setInstance(chatSessionId: string, instance: AgentChat, runtimeMode: AgentChatRuntimeMode): void {
    this.agentInstances.set(chatSessionId, instance);
    this.runtimeModes.set(chatSessionId, runtimeMode);
  }

  removeInstance(chatSessionId: string): AgentChat | null {
    const instance = this.agentInstances.get(chatSessionId) || null;
    this.agentInstances.delete(chatSessionId);
    this.runtimeModes.delete(chatSessionId);
    this.clearCancellationSource(chatSessionId);
    return instance;
  }

  getRuntimeMode(chatSessionId: string): AgentChatRuntimeMode | null {
    return this.runtimeModes.get(chatSessionId) || null;
  }

  setRuntimeMode(chatSessionId: string, runtimeMode: AgentChatRuntimeMode): void {
    if (this.agentInstances.has(chatSessionId)) {
      this.runtimeModes.set(chatSessionId, runtimeMode);
    }
  }

  listCachedSessionIds(): string[] {
    return Array.from(this.agentInstances.keys());
  }

  getInstanceCount(): number {
    return this.agentInstances.size;
  }

  forEachInstance(callback: (instance: AgentChat, chatSessionId: string) => void): void {
    this.agentInstances.forEach((instance, chatSessionId) => callback(instance, chatSessionId));
  }

  getCancellationSource(chatSessionId: string): CancellationTokenSource | null {
    return this.cancellationSources.get(chatSessionId) || null;
  }

  getOrCreateCancellationSource(chatSessionId: string): CancellationTokenSource {
    let source = this.cancellationSources.get(chatSessionId);

    if (!source || source.token.isCancellationRequested) {
      if (source) {
        source.dispose();
        logger.info('[AgentChatManagerRegistry] Disposing old cancelled source', 'getOrCreateCancellationSource', { chatSessionId });
      }

      source = new CancellationTokenSource();
      this.cancellationSources.set(chatSessionId, source);
      logger.info('[AgentChatManagerRegistry] Created new CancellationTokenSource', 'getOrCreateCancellationSource', { chatSessionId });
    } else {
      logger.info('[AgentChatManagerRegistry] Reusing existing CancellationTokenSource', 'getOrCreateCancellationSource', { chatSessionId });
    }

    return source;
  }

  clearCancellationSource(chatSessionId: string): void {
    const source = this.cancellationSources.get(chatSessionId);
    if (!source) {
      return;
    }

    source.dispose();
    this.cancellationSources.delete(chatSessionId);
  }

  disposeAllCancellationSources(): void {
    this.cancellationSources.forEach((source, chatSessionId) => {
      try {
        source.dispose();
        logger.debug('[AgentChatManagerRegistry] Disposed cancellation source', 'disposeAllCancellationSources', { chatSessionId });
      } catch (error) {
        logger.error('[AgentChatManagerRegistry] Error disposing cancellation source', 'disposeAllCancellationSources', {
          chatSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.cancellationSources.clear();
  }

  clearAll(): void {
    this.agentInstances.clear();
    this.runtimeModes.clear();
    this.cancellationSources.clear();
  }
}