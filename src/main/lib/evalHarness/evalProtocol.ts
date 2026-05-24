// src/main/lib/evalHarness/evalProtocol.ts
import { z } from 'zod';

// ── HTTP request body schemas ──

export const RunTestBodySchema = z.object({
  prompt: z.string(),
  metadata: z.record(z.unknown()).optional().default({}),
  session_id: z.string().optional(),
});

export const JudgeChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export const JudgeBodySchema = z.object({
  messages: z.array(JudgeChatMessageSchema).min(1),
});

// ── Request types (inferred from schemas) ──

export type RunTestBody = z.infer<typeof RunTestBodySchema>;
export type JudgeChatMessage = z.infer<typeof JudgeChatMessageSchema>;
export type JudgeBody = z.infer<typeof JudgeBodySchema>;

// ── Internal request types (used by runners) ──

export interface RunTestRequest {
  type: 'run_test';
  id: string;
  data: {
    prompt: string;
    metadata: Record<string, unknown>;
  };
  session_id?: string;
}

export interface JudgeRequest {
  type: 'judge';
  messages: JudgeChatMessage[];
}

// ── Response types ──

export interface RunTestMessageOutput {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
}

export interface RunTestResponse {
  messages: RunTestMessageOutput[];
  sub_agent_messages: RunTestMessageOutput[][];
  metadata: Record<string, unknown>;
  session_id?: string;
}

export interface JudgeResultResponse {
  type: 'judge_result';
  content: string;
}

export interface ErrorResponse {
  type: 'error';
  message: string;
}
