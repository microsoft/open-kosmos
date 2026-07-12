/**
 * OfficeXmlParsers - Shared Office XML parsing utilities
 *
 * Pure functions for parsing Office Open XML content from ZIP archives (via jszip).
 * Used by both OfficeTextExtractor (buffer-based) and ReadOfficeFileTool (file-based).
 */

import JSZip from 'jszip';

/**
 * Decode XML entities
 */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isNaN(cp) ? '' : String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isNaN(cp) ? '' : String.fromCodePoint(cp);
    });
}

/**
 * Extract text from slide XML
 */
export function extractSlideTextFromXml(slideXml: string): string[] {
  const lines: string[] = [];
  const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = paragraphRegex.exec(slideXml)) !== null) {
    const pXml = pMatch[1];
    const runRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>|<a:tab\s*\/>/gi;
    const parts: string[] = [];
    let rMatch: RegExpExecArray | null;

    while ((rMatch = runRegex.exec(pXml)) !== null) {
      if (rMatch[1] !== undefined) {
        const decoded = decodeXmlEntities(rMatch[1]);
        if (decoded.length > 0) parts.push(decoded);
      } else if (rMatch[0].toLowerCase().startsWith('<a:br')) {
        parts.push('\n');
      } else {
        parts.push('\t');
      }
    }

    if (parts.length === 0) continue;
    const text = parts.join('');
    text.split(/\n+/).forEach(segment => {
      const normalized = segment.replace(/\s+/g, ' ').trim();
      if (normalized.length > 0) lines.push(normalized);
    });
  }

  return lines;
}

/**
 * Parse shared strings table from xl/sharedStrings.xml
 */
export async function parseExcelSharedStrings(zip: JSZip): Promise<string[]> {
  const ssFile = zip.files['xl/sharedStrings.xml'];
  if (!ssFile) return [];

  const ssXml = await ssFile.async('string');
  const strings: string[] = [];

  // Each <si> element is one shared string entry
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(ssXml)) !== null) {
    const siContent = siMatch[1];
    // Collect all <t> elements within (handles rich text with multiple <r><t> runs)
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    const parts: string[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(''));
  }

  return strings;
}

/**
 * Parse worksheet XML and extract row text (tab-separated cells)
 */
export function parseExcelWorksheetRows(wsXml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];

  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(wsXml)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];

    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1];
      const cellContent = cellMatch[2] || '';
      const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';

      if (type === 's') {
        // Shared string reference
        const vMatch = cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        const idx = vMatch ? parseInt(vMatch[1], 10) : -1;
        cells.push(idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '');
      } else if (type === 'inlineStr') {
        // Inline string
        const tMatch = cellContent.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i);
        cells.push(tMatch ? decodeXmlEntities(tMatch[1]) : '');
      } else if (type === 'b') {
        // Boolean
        const vMatch = cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        cells.push(vMatch?.[1] === '1' ? 'TRUE' : 'FALSE');
      } else {
        // Number or other — use raw <v> value
        const vMatch = cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        cells.push(vMatch ? vMatch[1] : '');
      }
    }

    // Only add non-empty rows
    const rowText = cells.join('\t');
    if (rowText.trim().length > 0) {
      rows.push(rowText);
    }
  }

  return rows;
}

/**
 * Resolve Excel sheet entries (name + zip path) in the correct order
 * from workbook.xml + relationship file, with numeric fallback
 */
export async function resolveExcelSheetEntries(zip: JSZip): Promise<Array<{ name: string; zipPath: string }>> {
  let sheetEntries: Array<{ name: string; zipPath: string }> = [];
  const workbookFile = zip.files['xl/workbook.xml'];
  const workbookRelsFile = zip.files['xl/_rels/workbook.xml.rels'];

  if (workbookFile && workbookRelsFile) {
    try {
      const [workbookXml, relsXml] = await Promise.all([
        workbookFile.async('string'),
        workbookRelsFile.async('string'),
      ]);

      // Build rId → target path map
      const relMap = new Map<string, string>();
      const relRegex = /<Relationship\b([^>]*?)\/>/gi;
      let relMatch: RegExpExecArray | null;
      while ((relMatch = relRegex.exec(relsXml)) !== null) {
        const attrs = relMatch[1];
        const idMatch = attrs.match(/\bId="([^"]+)"/i);
        const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
        const typeMatch = attrs.match(/\bType="([^"]+)"/i);
        if (!idMatch || !targetMatch) continue;
        if (!typeMatch?.[1]?.endsWith('/worksheet')) continue;
        const normalizedTarget = targetMatch[1].replace(/^\.\//, '').replace(/^\.\.\//, '');
        const zipPath = normalizedTarget.startsWith('xl/') ? normalizedTarget : `xl/${normalizedTarget}`;
        relMap.set(idMatch[1], zipPath.replace(/\\/g, '/'));
      }

      // Parse sheet entries in order from workbook.xml
      const sheetRegex = /<sheet\b([^>]*?)\/>/gi;
      let sheetMatch: RegExpExecArray | null;
      while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
        const attrs = sheetMatch[1];
        const nameMatch = attrs.match(/\bname="([^"]+)"/i);
        const ridMatch = attrs.match(/\br:id="([^"]+)"/i);
        if (!nameMatch || !ridMatch) continue;
        const zipPath = relMap.get(ridMatch[1]);
        if (zipPath && zip.files[zipPath]) {
          sheetEntries.push({ name: decodeXmlEntities(nameMatch[1]), zipPath });
        }
      }
    } catch {
      // Fall back to numeric sorting
    }
  }

  // Fallback: sort by sheetN number
  if (sheetEntries.length === 0) {
    const sheetFiles = Object.keys(zip.files)
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/sheet(\d+)\.xml$/i)?.[1] || '0');
        const bNum = parseInt(b.match(/sheet(\d+)\.xml$/i)?.[1] || '0');
        return aNum - bNum;
      });
    sheetEntries = sheetFiles.map((zp, i) => ({ name: `Sheet${i + 1}`, zipPath: zp }));
  }

  return sheetEntries;
}
