/**
 * Log line parser for OpenKosmos `kosmos-YYYY-MM-DD.log` files.
 * Pure functions only — no I/O, no globals.
 */

export interface LogEntry {
  timestamp: Date;
  level: string;
  source: string; // empty string if no source
  message: string;
  metadata: string; // raw JSON string, empty if none
  raw: string;
}

const LOG_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(DEBUG|INFO|WARN|ERROR)\s+(?:\[([^\]]*)\]\s+)?(.*)$/;

export function parseLine(line: string): LogEntry | null {
  if (!line || line.startsWith('#')) return null;

  const m = LOG_LINE_RE.exec(line);
  if (!m) return null;

  const [, tsStr, level, source, rest] = m;
  const timestamp = new Date(tsStr);

  let message = rest;
  let metadata = '';
  const jsonIdx = rest.lastIndexOf(' {');
  if (jsonIdx >= 0) {
    const candidate = rest.slice(jsonIdx + 1);
    if (candidate.endsWith('}')) {
      try {
        JSON.parse(candidate);
        message = rest.slice(0, jsonIdx);
        metadata = candidate;
      } catch {
        // not valid JSON, keep as message
      }
    }
  }

  return {
    timestamp,
    level,
    source: source || '',
    message: message.trim(),
    metadata,
    raw: line,
  };
}

export function parseDateTime(s: string): Date {
  // Accept ISO or "YYYY-MM-DD HH:mm" or "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
    return new Date(s.replace(' ', 'T') + ':00');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + 'T00:00:00');
  }
  return new Date(s);
}
