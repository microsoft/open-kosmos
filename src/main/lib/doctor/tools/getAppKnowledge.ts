/**
 * getAppKnowledgeTool — return the detailed feature & architecture overview of the app (L2).
 *
 * No arguments; returns a preset markdown blob. The LLM calls this on demand whenever it needs a
 * deeper understanding of a subsystem beyond the L1 overview already inlined into the system prompt.
 */

import { APP_DETAIL_L2 } from '../appKnowledge';

export const getAppKnowledgeToolDef = {
  type: 'function' as const,
  function: {
    name: 'get_app_knowledge',
    description:
      "Get a detailed overview of OpenKosmos AI Studio: its core concepts (Agent, Chat Session, Tool Use, Memory), main subsystems (Chat Engine, MCP Runtime, Profile Store, etc.), renderer structure, IPC conventions, and a 'symptom → likely subsystem' lookup table. Call this when the bug description involves a subsystem you need to understand more deeply before analyzing logs or chat sessions. Takes no arguments.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export async function executeGetAppKnowledge(): Promise<string> {
  return APP_DETAIL_L2;
}
