import type { InteractiveRequest, InteractiveResponse } from '@shared/types/interactiveRequestTypes';

interface PendingInteractiveRequestEntry {
  request: InteractiveRequest;
  resolve: (response: InteractiveResponse) => void;
  timeoutHandle?: NodeJS.Timeout;
}

export class InteractiveRequestManager {
  private static instance: InteractiveRequestManager;

  private readonly pendingBySessionId: Map<string, PendingInteractiveRequestEntry> = new Map();

  static getInstance(): InteractiveRequestManager {
    if (!InteractiveRequestManager.instance) {
      InteractiveRequestManager.instance = new InteractiveRequestManager();
    }
    return InteractiveRequestManager.instance;
  }

  async createPendingRequest(request: InteractiveRequest): Promise<InteractiveResponse> {
    const existing = this.pendingBySessionId.get(request.chatSessionId);
    if (existing) {
      throw new Error(`Pending interactive request already exists for session ${request.chatSessionId}`);
    }

    return new Promise<InteractiveResponse>((resolve) => {
      const entry: PendingInteractiveRequestEntry = {
        request,
        resolve,
      };

      if (typeof request.expiresAt === 'number' && Number.isFinite(request.expiresAt)) {
        const delayMs = request.expiresAt - Date.now();
        if (delayMs <= 0) {
          resolve({
            interactionId: request.interactionId,
            chatSessionId: request.chatSessionId,
            requestType: request.requestType,
            action: 'expire',
            resolutionSource: 'timeout',
          });
          return;
        }

        entry.timeoutHandle = setTimeout(() => {
          this.resolveRequest({
            interactionId: request.interactionId,
            chatSessionId: request.chatSessionId,
            requestType: request.requestType,
            action: 'expire',
            resolutionSource: 'timeout',
          });
        }, delayMs);
      }

      this.pendingBySessionId.set(request.chatSessionId, entry);
    });
  }

  resolveRequest(response: InteractiveResponse): boolean {
    const entry = this.pendingBySessionId.get(response.chatSessionId);
    if (!entry || entry.request.interactionId !== response.interactionId) {
      return false;
    }

    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
    }

    this.pendingBySessionId.delete(response.chatSessionId);
    entry.resolve(response);
    return true;
  }

  interruptSession(chatSessionId: string): boolean {
    const entry = this.pendingBySessionId.get(chatSessionId);
    if (!entry) {
      return false;
    }

    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
    }

    this.pendingBySessionId.delete(chatSessionId);
    entry.resolve({
      interactionId: entry.request.interactionId,
      chatSessionId,
      requestType: entry.request.requestType,
      action: 'skip',
      resolutionSource: 'chat-cancelled',
    });
    return true;
  }

  getPendingRequest(chatSessionId: string): InteractiveRequest | null {
    return this.pendingBySessionId.get(chatSessionId)?.request || null;
  }

  clearSession(chatSessionId: string): void {
    const entry = this.pendingBySessionId.get(chatSessionId);
    if (!entry) {
      return;
    }

    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
    }

    this.pendingBySessionId.delete(chatSessionId);
  }
}

export const interactiveRequestManager = InteractiveRequestManager.getInstance();