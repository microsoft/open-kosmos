const UNIX_DIR_PREFIXES = 'Users|home|opt|var|etc|usr|Applications|Library|System|private|tmp|bin|sbin|dev|proc|sys|mnt|media|run';

// Windows path regex: matches paths starting with a drive letter
// Negative lookbehind (?<![:/]) prevents matching URL path segments
const WindowsPathRegex = /(?<![:/])([A-Za-z]:[\\\/](?:[^\\\/<>"'|?*:\n]+[\\\/])*[^\\\/<>"'|?*:\n]*\.[a-zA-Z0-9]+)/gi;
// Unix path regex: matches paths starting with common system directories (allows spaces)
// Negative lookbehind (?<![:/\w]) prevents matching URL path segments like https://cdn.example.com/media/...
const UnixPathRegex = new RegExp(`(?<![:/\\w])(\\/(?:${UNIX_DIR_PREFIXES})(?:\\/[^/\\n<>"'|?*:]+)*\\/[^/\\n<>"'|?*:]*\\.[a-zA-Z0-9]+)`, 'gi');

// Strict regexes for linkification: no spaces in path segments to prevent
// merging prose between two same-line paths into one match.
const StrictWindowsPathRegex = /(?<![:/])([A-Za-z]:[\\\/](?:[^\\\/<>"'|?*:\s\n]+[\\\/])*[^\\\/<>"'|?*:\s\n]*\.[a-zA-Z0-9]+)/gi;
const StrictUnixPathRegex = new RegExp(`(?<![:/\\w])(\\/(?:${UNIX_DIR_PREFIXES})(?:\\/[^/\\n\\s<>"'|?*:]+)*\\/[^/\\n\\s<>"'|?*:]*\\.[a-zA-Z0-9]+)`, 'g');

// Permissive regex: allows spaces — safe when checking a bounded string (e.g. inline code content)
const UNIX_FILE_PATH_PERMISSIVE_RE = new RegExp(`^/(?:${UNIX_DIR_PREFIXES})/.+\\.\\w+$`);

export function stripFileScheme(p: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(p); } catch { decoded = p; }
  if (!/^file:\/\/\//i.test(decoded)) return decoded;
  const stripped = decoded.replace(/^file:\/\/\//i, '');
  return /^[A-Za-z]:/.test(stripped) ? stripped : '/' + stripped;
}

/** Check if a URL/href points to a local file (not a web URL). */
export function isLocalFilePath(href: string): boolean {
  return /^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href) || /^file:\/\/\//i.test(href);
}

/** Check if a complete string is a file path (for inline code detection).
 *  Uses permissive matching (allows spaces) since the input is bounded by backticks. */
export function isFilePathString(text: string): boolean {
  return /^[A-Za-z]:[\\/].+\.\w+$/.test(text) || UNIX_FILE_PATH_PERMISSIVE_RE.test(text);
}

/** Extract filename from a full path. */
export function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

/**
 * Extract file paths from text. Supports Windows and Unix path formats.
 */
export function extractFilePathsFromText(text: string): string[] {
  const filePaths: string[] = [];

  let match;

  while ((match = WindowsPathRegex.exec(text)) !== null) {
    const rawPath = match[1];
    const normalizedPath = rawPath.replace(/\//g, '\\');
    filePaths.push(normalizedPath);
  }

  while ((match = UnixPathRegex.exec(text)) !== null) {
    filePaths.push(match[1]);
  }

  return [...new Set(filePaths)];
}

/**
 * Convert bare file paths in text to markdown links: [filename](encoded-path).
 * Skips paths already inside markdown links, inline code, or code blocks.
 * Uses strict regexes that exclude whitespace from path segments to avoid
 * merging prose between same-line paths into one match.
 */
export function linkifyFilePaths(text: string): string {
  const linkMatches: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    linkMatches.push({ start: m.index!, end: m.index! + m[0].length });
  }

  const inlineCodeRanges: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(/`[^`]+`/g)) {
    inlineCodeRanges.push({ start: m.index!, end: m.index! + m[0].length });
  }
  const codeBlockRanges: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(/```[\s\S]*?```/g)) {
    codeBlockRanges.push({ start: m.index!, end: m.index! + m[0].length });
  }
  // During streaming an opening ``` may not yet have its closing fence; treat
  // everything from the first unclosed fence to end-of-text as a code block range.
  for (const m of text.matchAll(/```/g)) {
    const pos = m.index!;
    if (codeBlockRanges.some(r => pos >= r.start && pos < r.end)) continue;
    codeBlockRanges.push({ start: pos, end: text.length });
    break;
  }

  const isInsideCode = (pos: number) =>
    inlineCodeRanges.some(r => pos >= r.start && pos < r.end) ||
    codeBlockRanges.some(r => pos >= r.start && pos < r.end);

  const isInsideLink = (pos: number, len: number) =>
    linkMatches.some(r => pos >= r.start && pos + len <= r.end);

  type Replacement = { start: number; end: number; replacement: string };
  const replacements: Replacement[] = [];

  const collect = (re: RegExp) => {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const fullPath = m[1];
      const start = m.index! + m[0].indexOf(fullPath);
      const end = start + fullPath.length;
      if (isInsideCode(start) || isInsideLink(start, fullPath.length)) continue;
      const fileName = fullPath.split(/[/\\]/).pop()!;
      let encodedPath: string;
      if (/^[A-Za-z]:/.test(fullPath)) {
        encodedPath = 'file:///' + encodeURI(fullPath.replace(/\\/g, '/'));
      } else {
        encodedPath = encodeURI(fullPath);
      }
      replacements.push({ start, end, replacement: `[${fileName}](${encodedPath})` });
    }
  };

  collect(StrictWindowsPathRegex);
  collect(StrictUnixPathRegex);

  // Deduplicate: when two replacements overlap, keep the one starting earlier (more complete)
  replacements.sort((a, b) => a.start - b.start);
  const deduped: Replacement[] = [];
  for (const r of replacements) {
    if (deduped.some(a => r.start < a.end && r.end > a.start)) continue;
    deduped.push(r);
  }

  // Apply from end to start so indices remain valid
  deduped.sort((a, b) => b.start - a.start);
  let result = text;
  for (const r of deduped) {
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }

  return result;
}
