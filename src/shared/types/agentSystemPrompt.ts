export const AGENT_SYSTEM_PROMPT_BASE_FILE = 'Base.md' as const;
export const AGENT_SYSTEM_PROMPT_AGENTS_FILE = 'AGENTS.md' as const;
export const AGENT_SYSTEM_PROMPT_FILES = [
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
] as const;

export type AgentSystemPromptFile = typeof AGENT_SYSTEM_PROMPT_FILES[number];

export interface AgentSystemPrompt {
  [AGENT_SYSTEM_PROMPT_BASE_FILE]: string;
  [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: string;
}

export type AgentSystemPromptInput = AgentSystemPrompt | string | null | undefined;

export function createDefaultAgentSystemPrompt(): AgentSystemPrompt {
  return {
    [AGENT_SYSTEM_PROMPT_BASE_FILE]: '',
    [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
  };
}

export function normalizeAgentSystemPrompt(input: unknown): AgentSystemPrompt {
  if (typeof input === 'string') {
    return {
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: input,
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
    };
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const prompt = input as Record<string, unknown>;
    return {
      [AGENT_SYSTEM_PROMPT_BASE_FILE]:
        typeof prompt[AGENT_SYSTEM_PROMPT_BASE_FILE] === 'string'
          ? prompt[AGENT_SYSTEM_PROMPT_BASE_FILE]
          : '',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]:
        typeof prompt[AGENT_SYSTEM_PROMPT_AGENTS_FILE] === 'string'
          ? prompt[AGENT_SYSTEM_PROMPT_AGENTS_FILE]
          : '',
    };
  }

  return createDefaultAgentSystemPrompt();
}

export function getAgentSystemPromptBase(input: unknown): string {
  return getAgentSystemPromptFile(input, AGENT_SYSTEM_PROMPT_BASE_FILE);
}

export function getAgentSystemPromptFile(input: unknown, file: AgentSystemPromptFile): string {
  return normalizeAgentSystemPrompt(input)[file];
}

export function setAgentSystemPromptBase(input: unknown, basePrompt: string): AgentSystemPrompt {
  return setAgentSystemPromptFile(input, AGENT_SYSTEM_PROMPT_BASE_FILE, basePrompt);
}

export function setAgentSystemPromptFile(
  input: unknown,
  file: AgentSystemPromptFile,
  content: string,
): AgentSystemPrompt {
  return {
    ...normalizeAgentSystemPrompt(input),
    [file]: content,
  };
}

export function mergeAgentSystemPromptUpdate(existing: unknown, update: unknown): AgentSystemPrompt {
  const current = normalizeAgentSystemPrompt(existing);

  if (update === undefined || update === null) {
    return current;
  }

  if (typeof update === 'string') {
    return setAgentSystemPromptFile(current, AGENT_SYSTEM_PROMPT_BASE_FILE, update);
  }

  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return current;
  }

  const patch = update as Record<string, unknown>;
  return {
    [AGENT_SYSTEM_PROMPT_BASE_FILE]:
      typeof patch[AGENT_SYSTEM_PROMPT_BASE_FILE] === 'string'
        ? patch[AGENT_SYSTEM_PROMPT_BASE_FILE]
        : current[AGENT_SYSTEM_PROMPT_BASE_FILE],
    [AGENT_SYSTEM_PROMPT_AGENTS_FILE]:
      typeof patch[AGENT_SYSTEM_PROMPT_AGENTS_FILE] === 'string'
        ? patch[AGENT_SYSTEM_PROMPT_AGENTS_FILE]
        : current[AGENT_SYSTEM_PROMPT_AGENTS_FILE],
  };
}

export function renderAgentSystemPrompt(input: unknown): string {
  const prompt = normalizeAgentSystemPrompt(input);
  return [
    prompt[AGENT_SYSTEM_PROMPT_BASE_FILE],
    prompt[AGENT_SYSTEM_PROMPT_AGENTS_FILE],
  ].filter(part => part.length > 0).join('\n\n');
}

export function isNormalizedAgentSystemPrompt(input: unknown): input is AgentSystemPrompt {
  return Boolean(
    input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      typeof (input as Record<string, unknown>)[AGENT_SYSTEM_PROMPT_BASE_FILE] === 'string' &&
      typeof (input as Record<string, unknown>)[AGENT_SYSTEM_PROMPT_AGENTS_FILE] === 'string',
  );
}
