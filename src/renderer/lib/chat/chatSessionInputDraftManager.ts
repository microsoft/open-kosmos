export interface ChatSessionInputDraft {
  text: string;
  updatedAt: number;
}

export class ChatSessionInputDraftManager {
  private drafts = new Map<string, ChatSessionInputDraft>();

  get(chatSessionId: string | null | undefined): string {
    if (!chatSessionId) {
      return '';
    }
    return this.drafts.get(chatSessionId)?.text ?? '';
  }

  set(chatSessionId: string | null | undefined, text: string): void {
    if (!chatSessionId) {
      return;
    }
    if (!text) {
      this.clear(chatSessionId);
      return;
    }
    this.drafts.set(chatSessionId, {
      text,
      updatedAt: Date.now(),
    });
  }

  has(chatSessionId: string | null | undefined): boolean {
    return Boolean(chatSessionId && this.drafts.has(chatSessionId));
  }

  clear(chatSessionId: string | null | undefined): void {
    if (!chatSessionId) {
      return;
    }
    this.drafts.delete(chatSessionId);
  }

  clearAll(): void {
    this.drafts.clear();
  }
}

export const chatSessionInputDraftManager = new ChatSessionInputDraftManager();
