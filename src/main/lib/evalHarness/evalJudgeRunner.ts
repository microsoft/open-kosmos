// src/main/lib/evalHarness/evalJudgeRunner.ts
import type { JudgeRequest, JudgeResultResponse, JudgeChatMessage } from './evalProtocol';
import { ghcModelApi } from "../llm/ghcModelApi";
import { profileCacheManager } from "../userDataADO";

/**
 * Handles 'judge' requests: raw LLM call with caller-provided messages.
 * No agent loop, no tools, no agent system prompt.
 */
export class EvalJudgeRunner {
  private userAlias: string;

  constructor(userAlias: string) {
    this.userAlias = userAlias;
  }

  async run(request: JudgeRequest): Promise<JudgeResultResponse> {
    const modelId = await this.getAgentModelId();


    const formattedMessages = request.messages.map((msg: JudgeChatMessage) => ({
      role: msg.role,
      content: msg.content,
    }));

    const responseText = await ghcModelApi.callWithMessages(
      modelId,
      formattedMessages,
      4000,
      0.7
    );

    return {
      type: 'judge_result',
      content: responseText,
    };
  }

  /**
   * Gets the model ID from the default agent's configuration.
   * Looks up the primary agent in the user's profile.
   */
  private async getAgentModelId(): Promise<string> {
    const profile = profileCacheManager.getCachedProfile(this.userAlias);

    if (!profile) {
      throw new Error(`No profile found for user alias: ${this.userAlias}`);
    }

    const allChats = profileCacheManager.getAllChatConfigs(this.userAlias);
    const primaryAgentName = (profile as any).primaryAgent || 'Kobi';
    const defaultChat = allChats.find(
      (c: any) => c.agent?.name === primaryAgentName
    );

    if (!defaultChat?.agent?.model) {
      throw new Error(`No model configured for primary agent "${primaryAgentName}"`);
    }

    return defaultChat.agent.model;
  }
}
