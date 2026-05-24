import { parseStreamingJson } from '../streamingJsonParser';

describe('parseStreamingJson', () => {
  it('returns undefined for empty string', () => {
    expect(parseStreamingJson('')).toBeUndefined();
  });

  it('returns undefined for whitespace only', () => {
    expect(parseStreamingJson('   ')).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(parseStreamingJson(null as any)).toBeUndefined();
    expect(parseStreamingJson(undefined as any)).toBeUndefined();
  });

  it('parses complete valid JSON', () => {
    expect(parseStreamingJson('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('parses JSON array', () => {
    expect(parseStreamingJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('handles single quotes by replacing with double', () => {
    expect(parseStreamingJson("{'key': 'value'}")).toEqual({ key: 'value' });
  });

  describe('strategy 1: basic completion', () => {
    it('completes missing closing brace', () => {
      const result = parseStreamingJson('{"key": "value"');
      expect(result).toEqual({ key: 'value' });
    });

    it('completes missing closing bracket', () => {
      const result = parseStreamingJson('[1, 2, 3');
      expect(result).toEqual([1, 2, 3]);
    });

    it('completes missing quote and brace', () => {
      const result = parseStreamingJson('{"key": "value');
      expect(result).toEqual({ key: 'value' });
    });

    it('handles nested incomplete objects', () => {
      const result = parseStreamingJson('{"a": {"b": 1}');
      expect(result).toBeDefined();
      expect((result as any).a.b).toBe(1);
    });
  });

  describe('strategy 2: trailing commas', () => {
    it('handles trailing comma in object', () => {
      const result = parseStreamingJson('{"a": 1, "b": 2,');
      expect(result).toBeDefined();
    });

    it('handles trailing comma in array', () => {
      const result = parseStreamingJson('[1, 2,');
      expect(result).toBeDefined();
    });
  });

  describe('strategy 3: aggressive completion', () => {
    it('handles incomplete key after colon', () => {
      const result = parseStreamingJson('{"key":');
      expect(result).toBeDefined();
    });

    it('handles incomplete key-value pair', () => {
      const result = parseStreamingJson('{"incompleteKey');
      expect(result).toBeDefined();
    });

    it('handles unquoted key in object', () => {
      // This triggers the unquoted key regex in strategy 3
      // Need input that fails strategies 1 and 2 but succeeds with strategy 3's unquoted key handling
      const result = parseStreamingJson('{myKey');
      // Strategy 3 converts to {"myKey": null}
      expect(result).toBeDefined();
    });

    it('handles trailing comma in strategy 3', () => {
      // Input that needs strategy 3 trailing comma removal
      // Strategy 1 would try basic completion, strategy 2 handles some trailing commas,
      // but if those fail, strategy 3's trailing comma removal kicks in
      const result = parseStreamingJson('{"a": 1,');
      expect(result).toBeDefined();
    });

    it('handles incomplete string as key with colon', () => {
      // Triggers the "incomplete key" null value addition in strategy 3
      const result = parseStreamingJson('{"key": "val", "k2');
      expect(result).toBeDefined();
    });
  });

  it('handles escaped characters in incomplete strings', () => {
    // Incomplete JSON with escape sequence — triggers escape handling in completePartialJson
    const result = parseStreamingJson('{"msg": "hello \\"world');
    expect(result).toBeDefined();
    expect((result as any).msg).toContain('hello');
  });

  it('handles backslash at end of incomplete string', () => {
    const result = parseStreamingJson('{"path": "C:\\\\');
    expect(result).toBeDefined();
  });

  it('handles escaped characters in strings', () => {
    const result = parseStreamingJson('{"msg": "hello \\"world\\""}');
    expect(result).toEqual({ msg: 'hello "world"' });
  });

  it('handles backslash before non-quote', () => {
    const result = parseStreamingJson('{"path": "C:\\\\test"}');
    expect(result).toEqual({ path: 'C:\\test' });
  });

  it('returns undefined for completely invalid input', () => {
    expect(parseStreamingJson('not json at all }{][')).toBeUndefined();
  });

  it('handles closing bracket that matches stack', () => {
    expect(parseStreamingJson('[1]')).toEqual([1]);
    expect(parseStreamingJson('{}')).toEqual({});
  });

  it('handles mismatched brackets gracefully', () => {
    // This may or may not parse depending on strategy
    const result = parseStreamingJson('[1}');
    // Just ensure no crash
  });
});
