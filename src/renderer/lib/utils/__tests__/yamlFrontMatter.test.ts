import { parseFrontMatter } from '../yamlFrontMatter';

describe('parseFrontMatter', () => {
  it('returns null frontMatter when no front matter present', () => {
    const result = parseFrontMatter('# Hello\nWorld');
    expect(result.frontMatter).toBeNull();
    expect(result.content).toBe('# Hello\nWorld');
  });

  it('parses simple key-value pairs', () => {
    const input = `---
title: My Title
author: John
---
Content here`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter).toEqual({ title: 'My Title', author: 'John' });
    expect(result.content).toBe('Content here');
  });

  it('handles quoted values with double quotes', () => {
    const input = `---
title: "Hello World"
---
`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.title).toBe('Hello World');
  });

  it('handles quoted values with single quotes', () => {
    const input = `---
title: 'Hello World'
---
`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.title).toBe('Hello World');
  });

  it('handles folded multi-line (>)', () => {
    const input = `---
description: >
  Line one
  Line two
  Line three
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.description).toBe('Line one Line two Line three');
  });

  it('handles folded multi-line (>-)', () => {
    const input = `---
description: >-
  Line one
  Line two
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.description).toBe('Line one Line two');
  });

  it('handles literal multi-line (|)', () => {
    const input = `---
code: |
  line1
  line2
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.code).toBe('line1\nline2');
  });

  it('handles literal multi-line (|-)', () => {
    const input = `---
code: |-
  line1
  line2
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.code).toBe('line1\nline2');
  });

  it('skips comments', () => {
    const input = `---
# This is a comment
title: Test
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter).toEqual({ title: 'Test' });
  });

  it('skips empty lines', () => {
    const input = `---

title: Test

---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter).toEqual({ title: 'Test' });
  });

  it('skips lines without colons', () => {
    const input = `---
title: Test
no-colon-here
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter).toEqual({ title: 'Test' });
  });

  it('skips lines with empty key', () => {
    const input = `---
: value
title: Test
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter).toEqual({ title: 'Test' });
  });

  it('handles multi-line at end of front matter', () => {
    const input = `---
desc: >
  final line
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.desc).toBe('final line');
  });

  it('handles tab-indented multi-line content', () => {
    const input = `---
desc: |
\tline1
\tline2
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.desc).toBe('line1\nline2');
  });

  it('flushes multi-line when next key encountered', () => {
    const input = `---
desc: >
  folded text
title: Next
---
Content`;
    const result = parseFrontMatter(input);
    expect(result.frontMatter!.desc).toBe('folded text');
    expect(result.frontMatter!.title).toBe('Next');
  });
});
