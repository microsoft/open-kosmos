// src/main/lib/types/chatSessionTypes.ts
import { Message } from './chatTypes';

export interface CreateChatSessionParams {
  chatSession_id?: string;
  title?: string;
  initialMessage?: Message;
}

export interface ChatSessionOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}