import { wrapInSystemReminder } from '../chat/systemReminderUtils';

const PARENT_MEMEX_GUIDANCE = [
  'Memex Memory is available through the `memex_memory` Manage-Memory tool.',
  'Before answering, use `recall`, `search`, or `read` when prior durable context may matter.',
  'When the conversation establishes durable memory backed by existing local evidence, call `memex_memory` with `operation: "capture"`.',
  'Use capture `mode` values `remember`, `update`, and `correct`; do not use raw memory write operations.',
  'Do not describe capture as a background job or separate tool. It is an explicit Manage-Memory action.',
  'If memories conflict and the answer depends on the conflict, report the candidate conflict with citations and ask the user instead of writing structured conflict metadata.',
].join('\n');

const SUB_AGENT_MEMEX_GUIDANCE = [
  'Memex Memory is available read-only in this sub-agent.',
  'Use only `recall`, `search`, and `read` for memory context.',
  'Do not call `capture` or any memory-write operation from a sub-agent.',
].join('\n');

export function buildMemexMemoryPrompt(options: { isSubAgent?: boolean } = {}): string {
  return wrapInSystemReminder(options.isSubAgent ? SUB_AGENT_MEMEX_GUIDANCE : PARENT_MEMEX_GUIDANCE);
}
