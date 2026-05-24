export interface ContextStats {
  totalMessages: number;
  contextMessages: number;
  tokenCount: number;
  compressionRatio: number;
}

export interface ContextTokenUsage {
  tokenCount: number;
  totalMessages: number;
  contextMessages: number;
  compressionRatio: number;
}

export enum ChatStatus {
  IDLE = 'idle',
  SENDING_RESPONSE = 'sending_response',
  COMPRESSING_CONTEXT = 'compressing_context',
  COMPRESSED_CONTEXT = 'compressed_context',
  RECEIVED_RESPONSE = 'received_response',
}