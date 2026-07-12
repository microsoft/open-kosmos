import { describe, expect, it } from 'vitest';

import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  createDefaultAgentSystemPrompt,
  getAgentSystemPromptBase,
  getAgentSystemPromptFile,
  isNormalizedAgentSystemPrompt,
  mergeAgentSystemPromptUpdate,
  normalizeAgentSystemPrompt,
  renderAgentSystemPrompt,
  setAgentSystemPromptBase,
  setAgentSystemPromptFile,
} from '../agentSystemPrompt';

describe('agentSystemPrompt', () => {
  it('creates the empty file-map default', () => {
    expect(createDefaultAgentSystemPrompt()).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: '',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
    });
  });

  it('migrates a legacy string into Base.md', () => {
    expect(normalizeAgentSystemPrompt('legacy prompt')).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'legacy prompt',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
    });
  });

  it('normalizes empty and array inputs to the default prompt files', () => {
    expect(normalizeAgentSystemPrompt(undefined)).toEqual(createDefaultAgentSystemPrompt());
    expect(normalizeAgentSystemPrompt(null)).toEqual(createDefaultAgentSystemPrompt());
    expect(normalizeAgentSystemPrompt(['base', 'agents'])).toEqual(createDefaultAgentSystemPrompt());
  });

  it('normalizes malformed objects without preserving unknown files', () => {
    expect(normalizeAgentSystemPrompt({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 123,
      extra: 'ignored',
    })).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
    });
  });

  it('normalizes object files independently', () => {
    expect(normalizeAgentSystemPrompt({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 123,
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    })).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: '',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    });
  });

  it('reads and updates Base.md without dropping AGENTS.md', () => {
    const next = setAgentSystemPromptBase({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'old',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    }, 'new');

    expect(getAgentSystemPromptBase(next)).toBe('new');
    expect(next[AGENT_SYSTEM_PROMPT_AGENTS_FILE]).toBe('agents');
  });

  it('reads and updates AGENTS.md without dropping Base.md', () => {
    const next = setAgentSystemPromptFile({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'old agents',
    }, AGENT_SYSTEM_PROMPT_AGENTS_FILE, 'new agents');

    expect(getAgentSystemPromptFile(next, AGENT_SYSTEM_PROMPT_AGENTS_FILE)).toBe('new agents');
    expect(next[AGENT_SYSTEM_PROMPT_BASE_FILE]).toBe('base');
  });

  it('merges legacy string updates into Base.md without dropping AGENTS.md', () => {
    expect(mergeAgentSystemPromptUpdate({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'old base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'project context',
    }, 'new base')).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'new base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'project context',
    });
  });

  it('ignores empty and malformed prompt updates', () => {
    const current = {
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    };

    expect(mergeAgentSystemPromptUpdate(current, undefined)).toEqual(current);
    expect(mergeAgentSystemPromptUpdate(current, null)).toEqual(current);
    expect(mergeAgentSystemPromptUpdate(current, true)).toEqual(current);
    expect(mergeAgentSystemPromptUpdate(current, ['new base'])).toEqual(current);
  });

  it('merges partial file-map updates without dropping omitted files', () => {
    expect(mergeAgentSystemPromptUpdate({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'old context',
    }, {
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'new context',
    })).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'new context',
    });
  });

  it('merges Base.md-only updates without dropping AGENTS.md', () => {
    expect(mergeAgentSystemPromptUpdate({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'old base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'context',
    }, {
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'new base',
    })).toEqual({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'new base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'context',
    });
  });

  it('renders non-empty files in stable order', () => {
    expect(renderAgentSystemPrompt({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: 'base',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    })).toBe('base\n\nagents');
    expect(renderAgentSystemPrompt({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: '',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: 'agents',
    })).toBe('agents');
  });

  it('detects only normalized file maps', () => {
    expect(isNormalizedAgentSystemPrompt({
      [AGENT_SYSTEM_PROMPT_BASE_FILE]: '',
      [AGENT_SYSTEM_PROMPT_AGENTS_FILE]: '',
    })).toBe(true);
    expect(isNormalizedAgentSystemPrompt('legacy')).toBe(false);
    expect(isNormalizedAgentSystemPrompt({ [AGENT_SYSTEM_PROMPT_BASE_FILE]: '' })).toBe(false);
  });
});
