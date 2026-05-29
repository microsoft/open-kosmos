/**
 * DoctorAgentRunner — minimal ReAct loop
 *
 * Input: a user-submitted DoctorInquiryPayload plus a stepInfo push callback
 * Output: { success, issueUrl?, error? }
 *
 * Does not reuse AgentChat. LLM calls go through llmClient; tool dispatch goes through toolExecutor.
 * The runner proactively pushes a stepInfo line to the renderer before each tool call / each LLM turn.
 */

import { createLogger } from '../unifiedLogger';
import { MAX_TURNS, TOOL_DEFINITIONS, SYSTEM_PROMPT } from './agentConfig';
import { executeTool } from './toolExecutor';
import { clearDebugLog, appendDebugLog } from './log';
import { callDoctorLlm, type ChatMessage, type MessageContent } from './llmClient';
import {
  compressImageFirstPass,
  MAX_IMAGE_BYTES_FOR_INLINE,
  MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE,
} from '../utilities/imageStorageCompression';

const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

type ImagePart = { type: 'image_url'; image_url: { url: string; detail: 'high' } };
type TextPart = { type: 'text'; text: string };
import type { DoctorInquiryPayload } from '@shared/ipc/doctor';

const logger = createLogger();

export type RunResult =
  | { success: true; issueUrl: string }
  | { success: false; error: string };

export type StepInfoPusher = (text: string) => void;

/** Tool name → one-line step description (auto-pushed to UI by the runner). */
const TOOL_STEP_INFO: Record<string, string> = {
  get_app_info: 'Collecting runtime environment info...',
  get_app_knowledge: 'Loading app knowledge base...',
  read_app_logs: 'Querying application logs...',
  read_chat_session: 'Fetching session skeleton...',
  get_chat_messages: 'Reading conversation messages...',
  get_crash_status: 'Checking for crash reports...',
  read_crash_bundle: 'Reading crash bundle details...',
  read_schedules: 'Inspecting scheduled jobs...',
  ask_user_question: 'Waiting for your answer...',
  create_github_issue: 'Generating diagnostic report...',
};

export class DoctorAgentRunner {
  constructor(private readonly pushStepInfo: StepInfoPusher) {}

  async run(payload: DoctorInquiryPayload, taskId: string): Promise<RunResult> {
    clearDebugLog();
    appendDebugLog('Agent Started', `**TaskId:** ${taskId}\n**MaxTurns:** ${MAX_TURNS}`);
    this.pushStepInfo('Preparing analysis...');

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      await this.buildUserMessage(payload),
    ];

    appendDebugLog(
      'User Bug Report',
      `**Description:** ${payload.description}\n` +
      `**Steps:** ${payload.stepsToReproduce}\n` +
      `**OccurredAt:** ${payload.occurredAt}\n` +
      `**AgentId:** ${payload.agentId || 'N/A'}\n` +
      `**SessionId:** ${payload.chatSessionId || 'N/A'}\n` +
      `**Screenshots:** ${payload.screenshots?.length || 0}`,
    );

    let issueUrl: string | undefined;

    this.pushStepInfo('Thinking...');
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      logger.info(`[DoctorAgent] Turn ${turn + 1}/${MAX_TURNS}`, 'run');
      appendDebugLog(`Turn ${turn + 1}/${MAX_TURNS}`, 'Calling LLM...');

      const response = await callDoctorLlm(messages, TOOL_DEFINITIONS);

      appendDebugLog(
        `LLM Response (Turn ${turn + 1})`,
        `**FinishReason:** ${response.finishReason}\n` +
        `**Content:** ${response.content ? response.content.slice(0, 500) + (response.content.length > 500 ? '...' : '') : '(none)'}\n` +
        `**ToolCalls:** ${response.toolCalls.length}`,
      );

      // Accumulate assistant message
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        ...(response.content ? { content: response.content } : {}),
        ...(response.toolCalls.length > 0 ? { tool_calls: response.toolCalls } : {}),
      };
      messages.push(assistantMsg);

      // Termination condition: no tool_calls
      if (response.toolCalls.length === 0) {
        logger.info('[DoctorAgent] Agent finished (no more tool calls)', 'run');
        appendDebugLog('Agent Finished', 'No more tool calls.');
        break;
      }

      // Execute tools sequentially
      for (const toolCall of response.toolCalls) {
        const { name, arguments: argsStr } = toolCall.function;

        const stepText = TOOL_STEP_INFO[name] ?? `Running ${name}...`;
        this.pushStepInfo(stepText);

        let parsedArgs: any = {};
        try {
          parsedArgs = argsStr ? JSON.parse(argsStr) : {};
        } catch {
          logger.warn(`[DoctorAgent] Failed to parse tool args for ${name}`, 'run');
        }

        appendDebugLog(`Tool Call: ${name}`, `**Args:**\n\`\`\`json\n${JSON.stringify(parsedArgs, null, 2)}\n\`\`\``);

        const result = await executeTool(name, parsedArgs, { taskId });

        appendDebugLog(
          `Tool Result: ${name}`,
          `\`\`\`\n${result.slice(0, 2000)}${result.length > 2000 ? '\n...(truncated)' : ''}\n\`\`\``,
        );

        if (name === 'create_github_issue') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.issueUrl) {
              issueUrl = parsed.issueUrl;
              appendDebugLog('Issue Created', `**URL:** ${issueUrl}`);
            }
          } catch { /* ignore */ }
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    if (issueUrl) {
      appendDebugLog('Run Complete', `**Success:** true\n**IssueUrl:** ${issueUrl}`);
      return { success: true, issueUrl };
    }

    appendDebugLog('Run Complete', '**Success:** false — Agent did not create a GitHub issue.');
    return { success: false, error: 'Agent completed but did not create a GitHub issue.' };
  }

  private async buildUserMessage(payload: DoctorInquiryPayload): Promise<ChatMessage> {
    let text = `## Bug Report\n\n`;
    text += `**Description:**\n${payload.description}\n\n`;
    text += `**Steps to Reproduce:**\n${payload.stepsToReproduce}\n\n`;
    text += `**When It Last Occurred (user's words):**\n${payload.occurredAt}\n\n`;

    if (payload.agentId) {
      text += `**Affected Agent ID:** ${payload.agentId}\n\n`;
    }
    if (payload.chatSessionId) {
      text += `**Affected Chat Session ID:** ${payload.chatSessionId}\n\n`;
    }

    if (payload.screenshots && payload.screenshots.length > 0) {
      const extraParts: Array<ImagePart | TextPart> = [];
      const skippedNotes: string[] = [];

      for (const shot of payload.screenshots) {
        const rawMime = (shot.mimeType || 'image/png').toLowerCase();
        const inputMime = SUPPORTED_IMAGE_MIME.has(rawMime) ? rawMime : 'image/png';
        const originalBytes = shot.bytes.byteLength;

        if (originalBytes > MAX_IMAGE_BYTES_FOR_INLINE) {
          const note = `[Screenshot "${shot.name}" is too large (${Math.round(originalBytes / 1024 / 1024)}MB); inline embedding was skipped.]`;
          skippedNotes.push(note);
          appendDebugLog('Screenshot Skipped (too large)', `**Name:** ${shot.name}\n**Size:** ${originalBytes} bytes`);
          continue;
        }

        const rawBase64 = Buffer.from(shot.bytes).toString('base64');
        try {
          const compressed = await compressImageFirstPass(rawBase64, inputMime, {
            maxDimension: 2048,
            targetShortSide: 768,
            quality: 80,
          });
          if (compressed.compressedSize > MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE) {
            const note = `[Screenshot "${shot.name}" is still too large after compression (${Math.round(compressed.compressedSize / 1024 / 1024)}MB); inline embedding was skipped.]`;
            skippedNotes.push(note);
            appendDebugLog('Screenshot Skipped (post-compress)', `**Name:** ${shot.name}\n**Compressed:** ${compressed.compressedSize} bytes`);
            continue;
          }
          appendDebugLog(
            'Screenshot Compressed',
            `**Name:** ${shot.name}\n` +
              `**Original:** ${compressed.originalSize} bytes (${inputMime})\n` +
              `**Compressed:** ${compressed.compressedSize} bytes (${compressed.mimeType}, ${compressed.width}x${compressed.height})`,
          );
          extraParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${compressed.mimeType};base64,${compressed.base64Data}`,
              detail: 'high',
            },
          });
        } catch (err) {
          const note = `[Screenshot "${shot.name}" compression failed; inline embedding was skipped.]`;
          skippedNotes.push(note);
          appendDebugLog(
            'Screenshot Compression Failed',
            `**Name:** ${shot.name}\n**Error:** ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const embeddedCount = extraParts.length;
      text += `\n**Screenshots:** ${embeddedCount} of ${payload.screenshots.length} screenshot(s) embedded above.\n`;
      if (skippedNotes.length > 0) {
        text += skippedNotes.map((n) => `- ${n}`).join('\n') + '\n';
      }

      const content: MessageContent = [{ type: 'text', text }, ...extraParts];
      return { role: 'user', content };
    }

    return { role: 'user', content: text };
  }
}
