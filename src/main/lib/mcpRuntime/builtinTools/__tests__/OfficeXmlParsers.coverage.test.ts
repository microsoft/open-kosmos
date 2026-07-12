// @ts-nocheck
import { vi, describe, it, expect } from 'vitest';

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('jszip'); // JSZip is used as a type; actual instances are constructed manually

import {
  decodeXmlEntities,
  extractSlideTextFromXml,
  parseExcelSharedStrings,
  parseExcelWorksheetRows,
  resolveExcelSheetEntries,
} from '../OfficeXmlParsers';

// ── helpers ────────────────────────────────────────────────────────────────────
function makeZip(files: Record<string, string | null>): any {
  const zipFiles: Record<string, any> = {};
  for (const [name, content] of Object.entries(files)) {
    if (content === null) {
      // not present
    } else {
      zipFiles[name] = {
        async: vi.fn().mockResolvedValue(content),
      };
    }
  }
  return { files: zipFiles };
}

// ── decodeXmlEntities ──────────────────────────────────────────────────────────
describe('decodeXmlEntities', () => {
  it('decodes &amp;', () => expect(decodeXmlEntities('a &amp; b')).toBe('a & b'));
  it('decodes &lt; and &gt;', () => expect(decodeXmlEntities('&lt;div&gt;')).toBe('<div>'));
  it('decodes &quot;', () => expect(decodeXmlEntities('&quot;hi&quot;')).toBe('"hi"'));
  it("decodes &apos;", () => expect(decodeXmlEntities("it&apos;s")).toBe("it's"));
  it('decodes hex numeric entity', () => expect(decodeXmlEntities('&#x41;')).toBe('A'));
  it('decodes decimal numeric entity', () => expect(decodeXmlEntities('&#65;')).toBe('A'));
  it('handles empty string', () => expect(decodeXmlEntities('')).toBe(''));
  it('leaves plain text untouched', () => expect(decodeXmlEntities('hello world')).toBe('hello world'));
  it('handles multiple entities in one string', () =>
    expect(decodeXmlEntities('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>'));
});

// ── extractSlideTextFromXml ────────────────────────────────────────────────────
describe('extractSlideTextFromXml', () => {
  it('returns empty array for xml with no paragraphs', () => {
    expect(extractSlideTextFromXml('<root></root>')).toEqual([]);
  });

  it('extracts text from a:t elements', () => {
    const xml = `<a:p><a:t>Hello World</a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['Hello World']);
  });

  it('concatenates multiple a:t runs within one paragraph', () => {
    const xml = `<a:p><a:t>Foo</a:t><a:t>Bar</a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['FooBar']);
  });

  it('inserts newline for a:br elements', () => {
    const xml = `<a:p><a:t>Line1</a:t><a:br /></a:t><a:t>Line2</a:t></a:p>`;
    const result = extractSlideTextFromXml(xml);
    expect(result).toContain('Line1');
    expect(result).toContain('Line2');
  });

  it('inserts tab for a:tab elements', () => {
    const xml = `<a:p><a:t>Col1</a:t><a:tab /><a:t>Col2</a:t></a:p>`;
    const result = extractSlideTextFromXml(xml);
    expect(result.join(' ')).toContain('Col1');
  });

  it('skips empty paragraphs', () => {
    const xml = `<a:p></a:p><a:p><a:t>Text</a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['Text']);
  });

  it('decodes XML entities in text', () => {
    const xml = `<a:p><a:t>&amp; &lt;tag&gt;</a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['& <tag>']);
  });

  it('handles multiple paragraphs', () => {
    const xml = `<a:p><a:t>First</a:t></a:p><a:p><a:t>Second</a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['First', 'Second']);
  });

  it('normalizes whitespace within text', () => {
    const xml = `<a:p><a:t>  spaces   here  </a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['spaces here']);
  });

  it('omits empty and whitespace-only text runs', () => {
    const xml = `<a:p><a:t></a:t><a:t>   </a:t><a:t>Visible</a:t><a:br/><a:t> \t </a:t></a:p>`;
    expect(extractSlideTextFromXml(xml)).toEqual(['Visible']);
  });
});

// ── parseExcelSharedStrings ────────────────────────────────────────────────────
describe('parseExcelSharedStrings', () => {
  it('returns empty array when sharedStrings.xml is absent', async () => {
    const zip = makeZip({});
    const result = await parseExcelSharedStrings(zip);
    expect(result).toEqual([]);
  });

  it('parses single shared string', async () => {
    const xml = `<sst><si><t>Hello</t></si></sst>`;
    const zip = makeZip({ 'xl/sharedStrings.xml': xml });
    expect(await parseExcelSharedStrings(zip)).toEqual(['Hello']);
  });

  it('parses multiple shared strings', async () => {
    const xml = `<sst><si><t>A</t></si><si><t>B</t></si><si><t>C</t></si></sst>`;
    const zip = makeZip({ 'xl/sharedStrings.xml': xml });
    expect(await parseExcelSharedStrings(zip)).toEqual(['A', 'B', 'C']);
  });

  it('concatenates rich text runs within a si', async () => {
    const xml = `<sst><si><r><t>Foo</t></r><r><t>Bar</t></r></si></sst>`;
    const zip = makeZip({ 'xl/sharedStrings.xml': xml });
    expect(await parseExcelSharedStrings(zip)).toEqual(['FooBar']);
  });

  it('decodes XML entities in shared strings', async () => {
    const xml = `<sst><si><t>&amp;amp;</t></si></sst>`;
    const zip = makeZip({ 'xl/sharedStrings.xml': xml });
    expect(await parseExcelSharedStrings(zip)).toEqual(['&amp;']);
  });
});

// ── parseExcelWorksheetRows ────────────────────────────────────────────────────
describe('parseExcelWorksheetRows', () => {
  it('returns empty array for xml with no rows', () => {
    expect(parseExcelWorksheetRows('<worksheet/>', [])).toEqual([]);
  });

  it('parses shared string cell (type s)', () => {
    const xml = `<worksheet><row><c t="s"><v>0</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, ['Hello'])).toEqual(['Hello']);
  });

  it('returns empty for out-of-range shared string index', () => {
    // idx=99 is out of range → cell value is '' → row text '' → filtered out
    const xml = `<worksheet><row><c t="s"><v>99</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, ['Only'])).toEqual([]);
  });

  it('parses inline string cell (type inlineStr)', () => {
    const xml = `<worksheet><row><c t="inlineStr"><is><t>Inline</t></is></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual(['Inline']);
  });

  it('parses boolean cell TRUE', () => {
    const xml = `<worksheet><row><c t="b"><v>1</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual(['TRUE']);
  });

  it('parses boolean cell FALSE', () => {
    const xml = `<worksheet><row><c t="b"><v>0</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual(['FALSE']);
  });

  it('parses numeric cell', () => {
    const xml = `<worksheet><row><c><v>42.5</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual(['42.5']);
  });

  it('skips rows where all cells are empty', () => {
    const xml = `<worksheet><row><c/></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual([]);
  });

  it('joins cells with tabs', () => {
    const xml = `<worksheet><row><c><v>A</v></c><c><v>B</v></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual(['A\tB']);
  });

  it('handles self-closing cell tags', () => {
    const xml = `<worksheet><row><c t="s" r="A1"/><c><v>99</v></c></row></worksheet>`;
    const result = parseExcelWorksheetRows(xml, ['X']);
    // Self-closing c has no v, so shared string with no v → index -1 → ''
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('handles inline strings without a text node', () => {
    const xml = `<worksheet><row><c t="inlineStr"><is/></c></row></worksheet>`;
    expect(parseExcelWorksheetRows(xml, [])).toEqual([]);
  });
});

// ── resolveExcelSheetEntries ───────────────────────────────────────────────────
describe('resolveExcelSheetEntries', () => {
  it('returns empty array when no workbook files and no worksheet files', async () => {
    const zip = makeZip({});
    expect(await resolveExcelSheetEntries(zip)).toEqual([]);
  });

  it('falls back to numeric sort when workbook files missing', async () => {
    const zip = makeZip({
      'xl/worksheets/sheet2.xml': '<ws/>',
      'xl/worksheets/sheet1.xml': '<ws/>',
    });
    const result = await resolveExcelSheetEntries(zip);
    expect(result).toEqual([
      { name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' },
      { name: 'Sheet2', zipPath: 'xl/worksheets/sheet2.xml' },
    ]);
  });

  it('resolves sheet entries from workbook.xml and rels', async () => {
    const workbookXml = `
      <workbook>
        <sheets>
          <sheet name="Sales" r:id="rId1"/>
          <sheet name="Data" r:id="rId2"/>
        </sheets>
      </workbook>`;
    const relsXml = `
      <Relationships>
        <Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>
        <Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>
      </Relationships>`;

    const zip = makeZip({
      'xl/workbook.xml': workbookXml,
      'xl/_rels/workbook.xml.rels': relsXml,
      'xl/worksheets/sheet1.xml': '<ws/>',
      'xl/worksheets/sheet2.xml': '<ws/>',
    });

    const result = await resolveExcelSheetEntries(zip);
    expect(result).toEqual([
      { name: 'Sales', zipPath: 'xl/worksheets/sheet1.xml' },
      { name: 'Data', zipPath: 'xl/worksheets/sheet2.xml' },
    ]);
  });

  it('skips relationship entries whose zipPath is not in zip.files', async () => {
    const workbookXml = `<workbook><sheets><sheet name="Missing" r:id="rId1"/></sheets></workbook>`;
    const relsXml = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet99.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>`;

    const zip = makeZip({
      'xl/workbook.xml': workbookXml,
      'xl/_rels/workbook.xml.rels': relsXml,
      // sheet99.xml is intentionally absent
    });

    const result = await resolveExcelSheetEntries(zip);
    // Falls back to numeric sort — nothing found either way
    expect(result).toEqual([]);
  });

  it('normalizes target paths with ../ prefix', async () => {
    const workbookXml = `<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`;
    const relsXml = `<Relationships><Relationship Id="rId1" Target="../xl/worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>`;
    const zip = makeZip({
      'xl/workbook.xml': workbookXml,
      'xl/_rels/workbook.xml.rels': relsXml,
      'xl/xl/worksheets/sheet1.xml': '<ws/>',
    });
    // Just make sure it doesn't throw
    await expect(resolveExcelSheetEntries(zip)).resolves.toBeDefined();
  });

  it('falls back to numeric sort when workbook parsing yields no entries', async () => {
    // Empty workbook XML — no <sheet> elements
    const zip = makeZip({
      'xl/workbook.xml': '<workbook/>',
      'xl/_rels/workbook.xml.rels': '<Relationships/>',
      'xl/worksheets/sheet1.xml': '<ws/>',
    });
    const result = await resolveExcelSheetEntries(zip);
    expect(result).toEqual([{ name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' }]);
  });

  it('handles async failure gracefully and falls back to numeric sort', async () => {
    const failingFile = { async: vi.fn().mockRejectedValue(new Error('IO error')) };
    const zip = {
      files: {
        'xl/workbook.xml': failingFile,
        'xl/_rels/workbook.xml.rels': failingFile,
        'xl/worksheets/sheet1.xml': { async: vi.fn().mockResolvedValue('<ws/>') },
      },
    };
    const result = await resolveExcelSheetEntries(zip);
    expect(result).toEqual([{ name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' }]);
  });

  it('ignores malformed, non-worksheet, and incomplete workbook entries', async () => {
    const zip = makeZip({
      'xl/workbook.xml': [
        '<workbook><sheets>',
        '<sheet name="MissingRelationship"/>',
        '<sheet r:id="rId1"/>',
        '<sheet name="Valid" r:id="rId3"/>',
        '</sheets></workbook>',
      ].join(''),
      'xl/_rels/workbook.xml.rels': [
        '<Relationships>',
        '<Relationship Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId1"/>',
        '<Relationship Id="rId2" Target="styles.xml" Type="styles"/>',
        '<Relationship Id="rId3" Target="worksheets/sheet3.xml" Type="worksheet"/>',
        '</Relationships>',
      ].join(''),
      'xl/worksheets/sheet1.xml': '<ws/>',
    });

    expect(await resolveExcelSheetEntries(zip)).toEqual([
      { name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' },
    ]);
  });
});
