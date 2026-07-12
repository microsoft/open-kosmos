/**
 * Coding CLI adapter unit tests: JSON/text final extraction and per-CLI argv construction.
 */

import {
  parseJsonField,
  extractText,
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
  copilotAdapter,
} from '../adapters';

describe('parseJsonField', () => {
  it('parses a field from whole-stdout JSON', () => {
    expect(parseJsonField(JSON.stringify({ result: 'done' }), 'result')).toBe('done');
  });

  it('parses a field from the last non-empty JSON line when logs precede it', () => {
    const stdout = 'log line one\n  \n' + JSON.stringify({ response: 'final answer' });
    expect(parseJsonField(stdout, 'response')).toBe('final answer');
  });

  it('returns null when the field is missing', () => {
    expect(parseJsonField(JSON.stringify({ other: 'x' }), 'result')).toBeNull();
  });

  it('returns null when the field is not a string', () => {
    expect(parseJsonField(JSON.stringify({ result: 42 }), 'result')).toBeNull();
  });

  it('returns null for empty stdout', () => {
    expect(parseJsonField('   ', 'result')).toBeNull();
  });

  it('returns null when no line is valid JSON', () => {
    expect(parseJsonField('not json\nstill not json', 'result')).toBeNull();
  });

  it('returns null when JSON parses to a non-object', () => {
    expect(parseJsonField('"a string"', 'result')).toBeNull();
  });
});

describe('extractText', () => {
  it('returns trimmed stdout when present', () => {
    expect(extractText('  hello world  ', 'err')).toBe('hello world');
  });

  it('falls back to trimmed stderr when stdout is empty', () => {
    expect(extractText('   ', '  some error  ')).toBe('some error');
  });

  it('returns empty string when both are empty', () => {
    expect(extractText('', '')).toBe('');
  });
});

describe('claudeAdapter', () => {
  it('has the expected metadata', () => {
    expect(claudeAdapter.id).toBe('claude');
    expect(claudeAdapter.binaryName).toBe('claude');
    expect(claudeAdapter.installHint).toContain('@anthropic-ai/claude-code');
    expect(claudeAdapter.docsUrl).toMatch(/^https?:\/\//);
  });

  it('builds non-interactive JSON argv with the task last', () => {
    expect(claudeAdapter.buildArgs('do it')).toEqual([
      '-p', '--output-format', 'json', '--dangerously-skip-permissions', 'do it',
    ]);
  });

  it('extracts the JSON result field', () => {
    expect(claudeAdapter.extractFinal(JSON.stringify({ result: 'claude final' }), '')).toBe('claude final');
  });

  it('falls back to raw text when JSON has no result field', () => {
    expect(claudeAdapter.extractFinal('plain text out', '')).toBe('plain text out');
  });
});

describe('codexAdapter', () => {
  it('has the expected metadata', () => {
    expect(codexAdapter.id).toBe('codex');
    expect(codexAdapter.binaryName).toBe('codex');
    expect(codexAdapter.installHint).toContain('@openai/codex');
    expect(codexAdapter.docsUrl).toBe('https://github.com/openai/codex');
  });

  it('builds an exec argv with the task last', () => {
    expect(codexAdapter.buildArgs('refactor')).toEqual([
      'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', 'refactor',
    ]);
  });

  it('returns trimmed stdout as the final message', () => {
    expect(codexAdapter.extractFinal('  codex result  ', 'err')).toBe('codex result');
  });
});

describe('geminiAdapter', () => {
  it('has the expected metadata', () => {
    expect(geminiAdapter.id).toBe('gemini');
    expect(geminiAdapter.binaryName).toBe('gemini');
    expect(geminiAdapter.installHint).toContain('@google/gemini-cli');
  });

  it('builds JSON argv with the prompt value after -p', () => {
    expect(geminiAdapter.buildArgs('write tests')).toEqual([
      '-p', 'write tests', '--output-format', 'json', '--yolo',
    ]);
  });

  it('extracts the JSON response field', () => {
    expect(geminiAdapter.extractFinal(JSON.stringify({ response: 'gemini final' }), '')).toBe('gemini final');
  });

  it('falls back to raw text when JSON has no response field', () => {
    expect(geminiAdapter.extractFinal('raw gemini', '')).toBe('raw gemini');
  });
});

describe('copilotAdapter', () => {
  it('has the expected metadata', () => {
    expect(copilotAdapter.id).toBe('copilot');
    expect(copilotAdapter.binaryName).toBe('copilot');
    expect(copilotAdapter.installHint).toContain('@github/copilot');
  });

  it('builds unattended argv with the prompt value after -p', () => {
    expect(copilotAdapter.buildArgs('fix lint')).toEqual([
      '-p', 'fix lint', '-s', '--allow-all', '--no-ask-user',
    ]);
  });

  it('returns trimmed stdout as the final message', () => {
    expect(copilotAdapter.extractFinal('  copilot result  ', 'err')).toBe('copilot result');
  });
});
