/**
 * Pure formatters — return strings, never write to stdout.
 */

import * as path from 'path';
import type { LogEntry } from './parser';

export function formatEntry(entry: LogEntry): string {
  const time = entry.timestamp.toISOString().slice(11, 19); // HH:mm:ss
  const lvl = entry.level.padEnd(5);
  const src = entry.source ? `[${entry.source}] ` : '';
  let line = `${time} ${lvl} ${src}${entry.message}`;
  if (entry.metadata) {
    try {
      const obj = JSON.parse(entry.metadata);
      const pairs = Object.entries(obj)
        .map(([k, v]) => {
          const vs = typeof v === 'string' ? v : JSON.stringify(v);
          return `${k}=${vs.length > 60 ? vs.slice(0, 57) + '...' : vs}`;
        })
        .join(' ');
      line += ' ' + pairs;
    } catch {
      line += ' ' + entry.metadata;
    }
  }
  return line;
}

export function formatStalenessHeader(entries: LogEntry[], files: string[]): string {
  if (entries.length === 0) return '';

  const lastEntry = entries[entries.length - 1];
  const lastTs = lastEntry.timestamp;
  const now = new Date();
  const diffMs = now.getTime() - lastTs.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);

  const fileNames = files.map((f) => path.basename(f)).join(', ');
  const lastTime = lastTs.toISOString().replace('T', ' ').slice(0, 19) + 'Z';

  const lines = [
    `--- Log file(s): ${fileNames}`,
    `--- Last log entry: ${lastTime}`,
  ];

  if (diffDays >= 1) {
    lines.push(
      `--- ⚠ WARNING: These logs are ${diffDays} day(s) old. They may not reflect the current code or application state.`,
    );
  } else if (diffHours >= 2) {
    lines.push(`--- Note: Last entry was ${Math.floor(diffHours)} hours ago.`);
  }

  lines.push('---');
  return lines.join('\n');
}

export function formatStats(entries: LogEntry[]): string {
  if (entries.length === 0) return 'No log entries found.';

  const total = entries.length;
  const first = entries[0].timestamp.toISOString().slice(11, 19);
  const last = entries[total - 1].timestamp.toISOString().slice(11, 19);

  const byLevel: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  for (const e of entries) {
    byLevel[e.level] = (byLevel[e.level] || 0) + 1;
    if (e.source) {
      bySource[e.source] = (bySource[e.source] || 0) + 1;
    }
  }

  const lines: string[] = [];
  lines.push('=== Log Statistics ===');
  lines.push(`Total: ${total.toLocaleString()} entries`);
  lines.push(`Time range: ${first} - ${last}`);
  lines.push('');
  lines.push('By Level:');
  for (const lvl of ['ERROR', 'WARN', 'INFO', 'DEBUG']) {
    const count = byLevel[lvl] || 0;
    if (count > 0) {
      const pct = ((count / total) * 100).toFixed(1);
      lines.push(`  ${lvl.padEnd(8)} ${String(count).padStart(6)} (${pct}%)`);
    }
  }
  lines.push('');
  lines.push('By Source (top 15):');
  const sortedSources = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (sortedSources.length === 0) {
    lines.push('  (none)');
  } else {
    const maxSrcLen = Math.max(...sortedSources.map(([s]) => s.length), 5);
    for (const [src, count] of sortedSources) {
      lines.push(`  ${src.padEnd(maxSrcLen)} ${String(count).padStart(6)}`);
    }
  }
  return lines.join('\n');
}

export function formatSources(entries: LogEntry[]): string {
  const sources = new Set<string>();
  for (const e of entries) {
    if (e.source) sources.add(e.source);
  }
  const sorted = [...sources].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return sorted.length === 0 ? '(no sources found)' : sorted.join('\n');
}
