/**
 * Unit tests for ReadHtmlTool
 *
 * Tests all three modes (outline, section, selector), safety limits,
 * error handling, tool definition shape, and utility helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// ReadHtmlTool has no heavy dependencies — no mocks needed beyond the module itself.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

async function writeTmpHtml(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readhtml-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool.getDefinition', () => {
  it('returns the correct tool name', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    expect(ReadHtmlTool.getDefinition().name).toBe('read_html');
  });

  it('has a non-empty description', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    expect(ReadHtmlTool.getDefinition().description.length).toBeGreaterThan(10);
  });

  it('requires filePath and description in the schema', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const schema = ReadHtmlTool.getDefinition().inputSchema;
    expect(schema.required).toContain('filePath');
    expect(schema.required).toContain('description');
  });

  it('lists all three modes in the schema', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const modeEnum = ReadHtmlTool.getDefinition().inputSchema.properties.mode.enum;
    expect(modeEnum).toEqual(expect.arrayContaining(['outline', 'section', 'selector']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool.execute — error cases', () => {
  it('throws when filePath is empty', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    await expect(ReadHtmlTool.execute({ filePath: '' })).rejects.toThrow('filePath is required');
  });

  it('throws when file does not exist', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    await expect(
      ReadHtmlTool.execute({ filePath: '/definitely/does/not/exist.html' })
    ).rejects.toThrow('File not accessible');
  });

  it('throws for unsupported mode', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('bad-mode.html', '<html><body>hi</body></html>');
    await expect(
      ReadHtmlTool.execute({ filePath, mode: 'bogus' as any })
    ).rejects.toThrow(/Unsupported mode/);
  });

  it('throws in selector mode when selector is missing', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('no-selector.html', '<html><body>hi</body></html>');
    await expect(
      ReadHtmlTool.execute({ filePath, mode: 'selector' })
    ).rejects.toThrow('selector is required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outline mode
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool.execute — outline mode', () => {
  const SAMPLE_HTML = `<!DOCTYPE html>
<html>
  <head><title>Test Page</title></head>
  <body>
    <main id="main-content" class="main-wrapper">
      <article>
        <h1>Hello World</h1>
        <p>Some text here.</p>
      </article>
    </main>
    <footer>Footer text</footer>
  </body>
</html>`;

  it('returns mode=outline', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.mode).toBe('outline');
  });

  it('returns outline (default when mode omitted)', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline-default.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath });
    expect(result.mode).toBe('outline');
    expect(result.outline).toBeDefined();
  });

  it('outline array contains expected tags', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline-tags.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    const tags = result.outline!.map((n) => n.tag);
    expect(tags).toContain('html');
    expect(tags).toContain('body');
    expect(tags).toContain('main');
    expect(tags).toContain('article');
    expect(tags).toContain('h1');
  });

  it('captures id and className on nodes', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline-attrs.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    const mainNode = result.outline!.find((n) => n.tag === 'main');
    expect(mainNode?.id).toBe('main-content');
    expect(mainNode?.className).toContain('main-wrapper');
  });

  it('includes suggestedSelectors with semantic tags', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline-selectors.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.suggestedSelectors).toBeDefined();
    expect(result.suggestedSelectors!.some((s) => s === 'main' || s === 'article')).toBe(true);
  });

  it('suggests id-based selectors', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('outline-id.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.suggestedSelectors!).toContain('#main-content');
  });

  it('hasScript is false for HTML without script tags', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('no-script.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.hasScript).toBe(false);
  });

  it('hasScript is true for HTML with script tags', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><head><script>alert(1)</script></head><body></body></html>`;
    const filePath = await writeTmpHtml('with-script.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.hasScript).toBe(true);
  });

  it('hasStyle is true for HTML with style tags', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><head><style>body{color:red}</style></head><body></body></html>`;
    const filePath = await writeTmpHtml('with-style.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.hasStyle).toBe(true);
  });

  it('skips script content in outline nodes', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><body><script>var x = 1;</script><p>visible</p></body></html>`;
    const filePath = await writeTmpHtml('skip-script.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    const tags = result.outline!.map((n) => n.tag);
    expect(tags).not.toContain('script');
  });

  it('returns correct bytesRead', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('bytes.html', SAMPLE_HTML);
    const stat = fsSync.statSync(filePath);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.bytesRead).toBeLessThanOrEqual(stat.size + 1);
    expect(result.bytesRead).toBeGreaterThan(0);
  });

  it('truncated is false for small files', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('small.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.truncated).toBe(false);
  });

  it('sets filePath and fileName on result', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('named.html', SAMPLE_HTML);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.filePath).toBe(filePath);
    expect(result.fileName).toBe('named.html');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section mode
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool.execute — section mode', () => {
  const HTML_WITH_SECTIONS = `<html>
  <head><title>My Title</title></head>
  <body>
    <main>This is the main content area.</main>
    <article>This is an article section.</article>
  </body>
</html>`;

  it('extracts main section text', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('section-main.html', HTML_WITH_SECTIONS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'main' });
    expect(result.mode).toBe('section');
    expect(result.content).toContain('main content area');
  });

  it('extracts article section text', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('section-article.html', HTML_WITH_SECTIONS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'article' });
    expect(result.content).toContain('article section');
  });

  it('extracts body by default (no section param)', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('section-body.html', HTML_WITH_SECTIONS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section' });
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
  });

  it('returns not-found message when section absent', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><body><p>no main tag here</p></body></html>`;
    const filePath = await writeTmpHtml('no-main.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'main' });
    expect(result.content).toMatch(/No <main>/);
  });

  it('strips script tags from extracted section', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><body><main>Hello<script>evil()</script>World</main></body></html>`;
    const filePath = await writeTmpHtml('strip-script.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'main' });
    expect(result.content).not.toContain('evil');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World');
  });

  it('decodes basic HTML entities', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><body><main>5 &gt; 3 &amp; &lt;ok&gt;</main></body></html>`;
    const filePath = await writeTmpHtml('entities.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'main' });
    expect(result.content).toContain('>');
    expect(result.content).toContain('&');
    expect(result.content).toContain('<');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Selector mode
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool.execute — selector mode', () => {
  const HTML_WITH_IDS = `<html><body>
    <div id="hero">Hero content here</div>
    <div class="content main-content">Main div content</div>
    <section>Section content</section>
  </body></html>`;

  it('reads by id selector', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('selector-id.html', HTML_WITH_IDS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'selector', selector: '#hero' });
    expect(result.mode).toBe('selector');
    expect(result.content).toContain('Hero content');
  });

  it('reads by class selector', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('selector-class.html', HTML_WITH_IDS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'selector', selector: '.content' });
    expect(result.content).toContain('Main div content');
  });

  it('reads by tag selector', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const filePath = await writeTmpHtml('selector-tag.html', HTML_WITH_IDS);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'selector', selector: 'section' });
    expect(result.content).toContain('Section content');
  });

  it('returns not-found message for missing selector', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    const html = `<html><body><p>nothing here</p></body></html>`;
    const filePath = await writeTmpHtml('missing-sel.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'selector', selector: '#ghost' });
    expect(result.content).toMatch(/No element matching/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAX_NODES truncation
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool — MAX_NODES truncation', () => {
  it('sets truncated=true and truncationReason=max_nodes when outline exceeds limit', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    // Generate 250 div tags — more than MAX_NODES=200
    const divs = Array.from({ length: 250 }, (_, i) => `<div id="n${i}">item ${i}</div>`).join('\n');
    const html = `<html><body>${divs}</body></html>`;
    const filePath = await writeTmpHtml('many-nodes.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'outline' });
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('max_nodes');
    expect(result.outline!.length).toBeLessThanOrEqual(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Text-node truncation in section/selector mode
// ─────────────────────────────────────────────────────────────────────────────

describe('ReadHtmlTool — text-node size limit', () => {
  it('truncates large section content', async () => {
    const { ReadHtmlTool } = await import('../readHtmlTool');
    // 5KB text — exceeds MAX_TEXT_NODE=4KB
    const bigText = 'A'.repeat(5 * 1024);
    const html = `<html><body><main>${bigText}</main></body></html>`;
    const filePath = await writeTmpHtml('big-section.html', html);
    const result = await ReadHtmlTool.execute({ filePath, mode: 'section', section: 'main' });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('truncated');
  });
});
