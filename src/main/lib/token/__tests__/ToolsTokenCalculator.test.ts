import { describe, it, expect, beforeEach } from 'vitest';
import { ToolsTokenCalculator } from '../calculators/ToolsTokenCalculator';
import { TextTokenCalculator } from '../calculators/TextTokenCalculator';

// Deterministic mock: countTokens returns text.length
const mockTextCalculator = {
  countTokens: (text: string) => text.length,
} as unknown as TextTokenCalculator;

const BASE_TOOL_TOKENS = 16;
const BASE_TOKENS_PER_TOOL = 8;
const SAFETY_MARGIN = 1.1;

describe('ToolsTokenCalculator', () => {
  let calculator: ToolsTokenCalculator;

  beforeEach(() => {
    calculator = new ToolsTokenCalculator(mockTextCalculator);
  });

  // 1. Empty tools array
  it('returns totalTokens = 0 for an empty tools array', () => {
    const result = calculator.calculateAllToolsTokens([]);
    expect(result.totalTokens).toBe(0);
    expect(result.toolTokens).toHaveLength(0);
    expect(result.basePromptTokens).toBe(0);
  });

  // 2. Single tool — verify +16 base + +8 per tool + key/value tokens then ×1.1
  it('calculates tokens for a single tool with the correct formula', () => {
    const tool = { name: 'search', description: 'Search the web' };
    // countObjectTokens({ name: 'search', description: 'Search the web' })
    //   key 'name'        -> 4
    //   value 'search'    -> 6
    //   key 'description' -> 11
    //   value 'Search the web' -> 14
    //   (no parameters key because parameters is undefined → skipped)
    // rawToolTokens = 4 + 6 + 11 + 14 = 35
    const rawToolTokens = 'name'.length + 'search'.length + 'description'.length + 'Search the web'.length;
    const numTokens = BASE_TOOL_TOKENS + BASE_TOKENS_PER_TOOL + rawToolTokens;
    const expected = Math.ceil(numTokens * SAFETY_MARGIN);

    const result = calculator.calculateAllToolsTokens([tool]);
    expect(result.totalTokens).toBe(expected);
    expect(result.toolTokens).toHaveLength(1);
    expect(result.toolTokens[0].name).toBe('search');
    expect(result.toolTokens[0].tokens).toBe(rawToolTokens + BASE_TOKENS_PER_TOOL);
  });

  // 3. Multiple tools — verify +8 additive per tool
  it('adds BASE_TOKENS_PER_TOOL for each tool in the array', () => {
    const tools = [
      { name: 'a', description: 'b' },
      { name: 'c', description: 'd' },
    ];
    // rawToolTokens for each: 'name'.length + 'a'.length + 'description'.length + 'b'.length = 4+1+11+1 = 17
    // same for second: 4+1+11+1 = 17
    const raw1 = 'name'.length + 'a'.length + 'description'.length + 'b'.length;
    const raw2 = 'name'.length + 'c'.length + 'description'.length + 'd'.length;
    const numTokens = BASE_TOOL_TOKENS + BASE_TOKENS_PER_TOOL + raw1 + BASE_TOKENS_PER_TOOL + raw2;
    const expected = Math.ceil(numTokens * SAFETY_MARGIN);

    const result = calculator.calculateAllToolsTokens(tools);
    expect(result.totalTokens).toBe(expected);
    expect(result.toolTokens).toHaveLength(2);
    // Each entry includes the per-tool base added to its individual raw tokens
    expect(result.toolTokens[0].tokens).toBe(raw1 + BASE_TOKENS_PER_TOOL);
    expect(result.toolTokens[1].tokens).toBe(raw2 + BASE_TOKENS_PER_TOOL);
  });

  // 4. countObjectTokens tokenizes both keys AND values
  it('counts both keys and values when tokenizing parameters', () => {
    const tool = {
      name: 'x',
      description: 'y',
      parameters: { query: 'hello' },
    } as any;
    // keys/values for the top-level object:
    //   'name' -> 4, 'x' -> 1
    //   'description' -> 11, 'y' -> 1
    //   'parameters' -> 10, then recurse into { query: 'hello' }
    //     'query' -> 5, 'hello' -> 5
    const rawToolTokens =
      'name'.length + 'x'.length +
      'description'.length + 'y'.length +
      'parameters'.length +
      'query'.length + 'hello'.length;

    const tokens = calculator.calculateToolTokens(tool);
    expect(tokens).toBe(rawToolTokens);
  });

  // 5. Nested parameters object — recursive tokenization
  it('recursively tokenizes nested parameter objects', () => {
    const tool = {
      name: 'n',
      description: 'd',
      parameters: {
        outer: {
          inner: 'val',
        },
      },
    } as any;
    // 'name'->4, 'n'->1, 'description'->11, 'd'->1, 'parameters'->10
    // recurse into { outer: { inner: 'val' } }:
    //   'outer'->5, then recurse into { inner: 'val' }:
    //     'inner'->5, 'val'->3
    const rawToolTokens =
      'name'.length + 'n'.length +
      'description'.length + 'd'.length +
      'parameters'.length +
      'outer'.length +
      'inner'.length + 'val'.length;

    const tokens = calculator.calculateToolTokens(tool);
    expect(tokens).toBe(rawToolTokens);
  });

  // 6. null/undefined values in parameters are skipped
  it('skips null and undefined values in parameters', () => {
    const tool = {
      name: 'p',
      description: 'q',
      parameters: {
        present: 'yes',
        missing: null as unknown as string,
        gone: undefined as unknown as string,
      },
    } as any;
    // Only 'present'/'yes' should be counted inside parameters; null/undefined keys are skipped
    // 'name'->4, 'p'->1, 'description'->11, 'q'->1, 'parameters'->10
    // 'present'->7, 'yes'->3  (missing and gone are skipped)
    const rawToolTokens =
      'name'.length + 'p'.length +
      'description'.length + 'q'.length +
      'parameters'.length +
      'present'.length + 'yes'.length;

    const tokens = calculator.calculateToolTokens(tool);
    expect(tokens).toBe(rawToolTokens);
  });

  // Edge: boolean and number values are stringified
  it('converts number and boolean parameter values to strings for counting', () => {
    const tool = {
      name: 'r',
      description: 's',
      parameters: { count: 42, enabled: true },
    } as any;
    // 'name'->4,'r'->1,'description'->11,'s'->1,'parameters'->10
    // 'count'->5, '42'->2, 'enabled'->7, 'true'->4
    const rawToolTokens =
      'name'.length + 'r'.length +
      'description'.length + 's'.length +
      'parameters'.length +
      'count'.length + String(42).length +
      'enabled'.length + String(true).length;

    const tokens = calculator.calculateToolTokens(tool);
    expect(tokens).toBe(rawToolTokens);
  });

  // Array values in parameters are traversed
  it('traverses array values in parameters', () => {
    const tool = {
      name: 't',
      description: 'u',
      parameters: { items: ['hello', 'world'] },
    } as any;
    // 'name'->4,'t'->1,'description'->11,'u'->1,'parameters'->10
    // 'items'->5, 'hello'->5, 'world'->5
    const rawToolTokens =
      'name'.length + 't'.length +
      'description'.length + 'u'.length +
      'parameters'.length +
      'items'.length + 'hello'.length + 'world'.length;

    expect(calculator.calculateToolTokens(tool)).toBe(rawToolTokens);
  });

  // calculateSystemPromptWithTools
  it('calculateSystemPromptWithTools sums base prompt and tool tokens', () => {
    const systemPrompt = 'You are a helpful assistant.';
    const tools = [{ name: 'search', description: 'Search' }];

    const result = calculator.calculateSystemPromptWithTools(systemPrompt, tools);

    expect(result.basePromptTokens).toBe(systemPrompt.length);
    expect(result.totalTokens).toBeGreaterThan(result.basePromptTokens);
  });

  it('calculateSystemPromptWithTools with empty tools returns only system prompt tokens', () => {
    const systemPrompt = 'be helpful';
    const result = calculator.calculateSystemPromptWithTools(systemPrompt, []);
    expect(result.basePromptTokens).toBe(systemPrompt.length);
    // 0 tools → toolsTokens = 0 → total = systemPrompt.length
    expect(result.totalTokens).toBe(systemPrompt.length);
  });

  it('handles array parameter containing null/undefined values (countObjectTokens null branch)', () => {
    // Covers: if (obj === null || obj === undefined) return 0 — line 26
    // Achieved via: array containing null → countObjectTokens(null) returns 0
    const tool = {
      name: 'v',
      description: 'w',
      parameters: { items: [null, 'hello', undefined] },
    } as any;
    // 'name'->4,'v'->1,'description'->11,'w'->1,'parameters'->10
    // 'items'->5, null->0 (skipped), 'hello'->5, undefined->0 (skipped)
    const rawToolTokens =
      'name'.length + 'v'.length +
      'description'.length + 'w'.length +
      'parameters'.length +
      'items'.length + 'hello'.length;

    expect(calculator.calculateToolTokens(tool)).toBe(rawToolTokens);
  });
});
