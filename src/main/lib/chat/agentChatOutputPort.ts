import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';
import type { StreamingChunk } from '@shared/types/streamingTypes';

import type { ChatStatus } from './agentChatTypes';

export interface InteractionProcessedEvent {
  interactionId: string;
  status: string;
  summaryText: string;
  historyEntry: unknown;
}

export class AgentChatOutputPort {
  private sender: Electron.WebContents | null = null;

  constructor(
    private readonly getChatId: () => string,
    private readonly getChatSessionId: () => string,
    private readonly getAgentName: () => string,
  ) {}

  setSender(sender: Electron.WebContents | null): void {
    this.sender = sender;
  }

  getSender(): Electron.WebContents | null {
    return this.sender;
  }

  hasSender(): boolean {
    return !!this.sender && !this.sender.isDestroyed();
  }

  clear(): void {
    this.sender = null;
  }

  emitStatus(status: ChatStatus): void {
    if (!this.hasSender()) {
      this.sender = null;
      return;
    }

    this.sender!.send('agentChat:chatStatusChanged', {
      chatId: this.getChatId(),
      chatSessionId: this.getChatSessionId(),
      chatStatus: status,
      agentName: this.getAgentName(),
      timestamp: new Date().toISOString(),
    });
  }

  emitStreamingChunk(chunk: StreamingChunk): void {
    if (!this.hasSender()) {
      this.sender = null;
      return;
    }

    this.sender!.send('agentChat:streamingChunk', chunk);
  }

  emitEvent(eventName: string, data: any): void {
    if (!this.hasSender()) {
      this.sender = null;
      return;
    }

    this.sender!.send(eventName, {
      ...data,
      chatSessionId: data.chatSessionId || this.getChatSessionId(),
    });
  }

  emitInteractionRequest(request: InteractiveRequest): void {
    this.emitEvent('agentChat:interactionRequest', request);
  }

  emitInteractionProcessed(event: InteractionProcessedEvent): void {
    this.emitEvent('agentChat:interactionProcessed', event);
  }

  async flush(): Promise<void> {
    return;
  }
}