import { ExternalAgentService } from './externalAgentService';
import { createLogger } from '../unifiedLogger';

export { ExternalAgentService };

const DEFAULT_EXTERNAL_AGENT_PORT = 51927;

/**
 * Initialize the External Agent module: create singleton and auto-start.
 *
 * Discord-like model: WS server always starts on default port (9527).
 * Each bot has its own token, created by the user through the agent creation flow.
 * Token validation checks all External agents in the profile.
 */
export async function initExternalAgentModule(alias: string): Promise<ExternalAgentService> {
  const service = ExternalAgentService.getInstance();

  try {
    await service.start(alias, DEFAULT_EXTERNAL_AGENT_PORT);
  } catch (err) {
    createLogger().warn('[ExternalAgent] Auto-start failed:', String(err));
  }

  return service;
}
