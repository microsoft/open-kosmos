import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  resolveHookTimeoutMs,
  USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS,
} from '../types';

describe('resolveHookTimeoutMs', () => {
  it('prefers official timeout seconds over legacy milliseconds', () => {
    expect(resolveHookTimeoutMs({ timeout: 2.5, timeoutMs: 100 }, { hook_event_name: 'PreToolUse' })).toBe(2500);
  });

  it('uses legacy timeoutMs when official timeout is absent', () => {
    expect(resolveHookTimeoutMs({ timeoutMs: 1234 }, { hook_event_name: 'PostToolUse' })).toBe(1234);
  });

  it('caps official timeout seconds at the runtime maximum', () => {
    expect(resolveHookTimeoutMs({ timeout: 9999 }, { hook_event_name: 'SessionStart' })).toBe(MAX_HOOK_TIMEOUT_MS);
  });

  it('caps legacy timeoutMs at the runtime maximum', () => {
    expect(resolveHookTimeoutMs({ timeoutMs: MAX_HOOK_TIMEOUT_MS + 1 }, { hook_event_name: 'PostToolUse' })).toBe(MAX_HOOK_TIMEOUT_MS);
  });

  it('uses the official UserPromptSubmit default', () => {
    expect(resolveHookTimeoutMs({}, { hook_event_name: 'UserPromptSubmit' })).toBe(USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS);
  });

  it('uses the official default for other events', () => {
    expect(resolveHookTimeoutMs({}, { hook_event_name: 'SessionStart' })).toBe(DEFAULT_HOOK_TIMEOUT_MS);
  });
});
