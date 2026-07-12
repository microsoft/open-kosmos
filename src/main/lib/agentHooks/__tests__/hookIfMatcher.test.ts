import { describe, it, expect } from 'vitest';

import {
  parseIfRule,
  globToRegExp,
  matchesCommandPattern,
  matchesFilePattern,
  evaluateHookIfCondition,
} from '../hookIfMatcher';
import type { AgentHookInput } from '../types';

function toolInput(event: AgentHookInput['hook_event_name'], toolName: string, input: Record<string, unknown>): AgentHookInput {
  return {
    hook_event_name: event,
    tool_name: toolName,
    tool_input: input,
  } as unknown as AgentHookInput;
}

describe('parseIfRule', () => {
  it('returns null for an empty or whitespace rule', () => {
    expect(parseIfRule('')).toBeNull();
    expect(parseIfRule('   ')).toBeNull();
  });

  it('parses a bare tool name', () => {
    expect(parseIfRule('execute_command')).toEqual({ tool: 'execute_command' });
  });

  it('parses a tool with a pattern', () => {
    expect(parseIfRule('execute_command(rm *)')).toEqual({ tool: 'execute_command', pattern: 'rm *' });
  });

  it('treats an empty pattern as a bare tool', () => {
    expect(parseIfRule('execute_command()')).toEqual({ tool: 'execute_command' });
  });

  it('returns null when the parenthesis is not closed', () => {
    expect(parseIfRule('execute_command(rm')).toBeNull();
  });

  it('returns null when the tool name is empty', () => {
    expect(parseIfRule('(rm)')).toBeNull();
  });
});

describe('globToRegExp', () => {
  it('escapes regex specials and matches literally', () => {
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('converts * to a multi-character wildcard', () => {
    expect(globToRegExp('a*c').test('abbbc')).toBe(true);
    expect(globToRegExp('a*c').test('ac')).toBe(true);
  });

  it('converts ? to a single-character wildcard', () => {
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('a?c').test('ac')).toBe(false);
  });
});

describe('matchesCommandPattern (command pattern matching)', () => {
  it('fails open for an empty command', () => {
    expect(matchesCommandPattern('', 'rm *')).toBe(true);
    expect(matchesCommandPattern('   ', 'rm *')).toBe(true);
  });

  it('strips leading VAR=value assignments: execute_command(git *) / FOO=bar git push -> match', () => {
    expect(matchesCommandPattern('FOO=bar git push', 'git *')).toBe(true);
  });

  it('strips quoted leading assignments', () => {
    expect(matchesCommandPattern('FOO="a b" git push', 'git *')).toBe(true);
    expect(matchesCommandPattern("FOO='a b' git push", 'git *')).toBe(true);
  });

  it('splits subcommands: execute_command(git *) / npm test && git push -> match', () => {
    expect(matchesCommandPattern('npm test && git push', 'git *')).toBe(true);
  });

  it('extracts $() inner commands: execute_command(rm *) / echo $(rm -rf /) -> match', () => {
    expect(matchesCommandPattern('echo $(rm -rf /)', 'rm *')).toBe(true);
  });

  it('extracts backtick inner commands', () => {
    expect(matchesCommandPattern('echo `rm -rf /`', 'rm *')).toBe(true);
  });

  it('does not match a command-name-only pattern on a dynamic command: execute_command(rm *) / echo $(date) -> no match', () => {
    expect(matchesCommandPattern('echo $(date)', 'rm *')).toBe(false);
  });

  it('fails open when a more-specific pattern meets a dynamic command: execute_command(git push *) / echo $(date) -> match', () => {
    expect(matchesCommandPattern('echo $(date)', 'git push *')).toBe(true);
  });

  it('fails open for a $VAR dynamic command with a more-specific pattern', () => {
    expect(matchesCommandPattern('$DYN run', 'rm -rf *')).toBe(true);
  });

  it('returns false for a non-matching static command', () => {
    expect(matchesCommandPattern('npm test', 'git *')).toBe(false);
  });

  it('ignores empty command substitutions', () => {
    expect(matchesCommandPattern('echo $()', 'rm *')).toBe(false);
    expect(matchesCommandPattern('echo ``', 'rm *')).toBe(false);
  });

  it('skips empty segments from a trailing operator', () => {
    expect(matchesCommandPattern('git push ;', 'git *')).toBe(true);
  });

  it('matches the raw segment when the pattern spans a substitution', () => {
    expect(matchesCommandPattern('run $(x)', 'run *')).toBe(true);
  });
});

describe('matchesFilePattern', () => {
  it('returns false when there is no tool input', () => {
    expect(matchesFilePattern(undefined, '*.ts')).toBe(false);
  });

  it('matches a glob against known file-path fields', () => {
    expect(matchesFilePattern({ file_path: '/a/b.ts' }, '*.ts')).toBe(true);
    expect(matchesFilePattern({ notebook_path: '/a/b.ipynb' }, '*.ipynb')).toBe(true);
  });

  it('returns false when no file-path field matches', () => {
    expect(matchesFilePattern({ file_path: '/a/b.js' }, '*.ts')).toBe(false);
    expect(matchesFilePattern({ other: 5 }, '*.ts')).toBe(false);
  });
});

describe('evaluateHookIfCondition', () => {
  it('runs when there is no condition', () => {
    const input = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /' });
    expect(evaluateHookIfCondition(undefined, input)).toBe(true);
    expect(evaluateHookIfCondition('', input)).toBe(true);
    expect(evaluateHookIfCondition('   ', input)).toBe(true);
  });

  it('never runs on a non-tool event when a condition is set', () => {
    const input = { hook_event_name: 'SessionStart' } as unknown as AgentHookInput;
    expect(evaluateHookIfCondition('execute_command(rm *)', input)).toBe(false);
  });

  it('does not run when the rule is unparseable', () => {
    const input = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /' });
    expect(evaluateHookIfCondition('execute_command(rm', input)).toBe(false);
  });

  it('does not run when the tool name differs', () => {
    const input = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /' });
    expect(evaluateHookIfCondition('Read', input)).toBe(false);
  });

  it('runs for a bare tool-name rule that matches', () => {
    const input = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /' });
    expect(evaluateHookIfCondition('execute_command', input)).toBe(true);
  });

  it('evaluates command patterns using actual OpenKosmos tool names', () => {
    const match = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /' });
    const noMatch = toolInput('PreToolUse', 'execute_command', { command: 'echo $(date)' });
    expect(evaluateHookIfCondition('execute_command(rm *)', match)).toBe(true);
    expect(evaluateHookIfCondition('execute_command(rm *)', noMatch)).toBe(false);
  });

  it('evaluates execute_command conditions using actual tool name', () => {
    const match = toolInput('PreToolUse', 'execute_command', { command: 'rm -rf /tmp/cache' });
    expect(evaluateHookIfCondition('execute_command(rm *)', match)).toBe(true);
  });

  it('evaluates file tool conditions using actual tool names', () => {
    const editMatch = toolInput('PostToolUse', 'edit_file', { file_path: '/src/a.ts' });
    const readMatch = toolInput('PostToolUse', 'read_file', { path: '/src/a.ts' });
    const writeMatch = toolInput('PostToolUse', 'write_file', { filePath: '/src/a.ts' });
    expect(evaluateHookIfCondition('edit_file(*.ts)', editMatch)).toBe(true);
    expect(evaluateHookIfCondition('read_file(*.ts)', readMatch)).toBe(true);
    expect(evaluateHookIfCondition('write_file(*.ts)', writeMatch)).toBe(true);
  });

  it('returns false for a file pattern when tool input is missing', () => {
    const input = { hook_event_name: 'PostToolUseFailure', tool_name: 'edit_file' } as unknown as AgentHookInput;
    expect(evaluateHookIfCondition('edit_file(*.ts)', input)).toBe(false);
  });
});
