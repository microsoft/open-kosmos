/**
 * Log entry filtering — glob source match, level filter, time window, grep expression.
 */

import type { LogEntry } from './parser';

export interface Filters {
  source?: string;       // glob, supports * wildcard
  level?: string[];      // upper-cased level values
  from?: Date;
  to?: Date;
  grep?: string;
  /** Compiled grep matcher cache (set internally on first match). */
  _grepMatcher?: GrepMatcher;
}

export type GrepMatcher = (haystack: string) => boolean;

export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .toLowerCase()
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return re.test(value.toLowerCase());
}

/**
 * Grep expression syntax:
 *   plain text   case-insensitive substring match
 *   /regex/flags regular expression
 *   a,b          OR — match any term
 *   a+b          AND — match all terms
 *   !term        NOT — exclude lines matching term
 *   Combine: "error+mcp,warn+timeout" = (error AND mcp) OR (warn AND timeout)
 */
export function buildGrepMatcher(expr: string): GrepMatcher {
  const reMatch = expr.match(/^\/(.+)\/([gimsuy]*)$/);
  if (reMatch) {
    const re = new RegExp(reMatch[1], reMatch[2] || 'i');
    return (h) => re.test(h);
  }

  const orGroups = expr.split(',').map((g) => g.trim()).filter(Boolean);

  const orMatchers: GrepMatcher[] = orGroups.map((group) => {
    const andTerms = group.split('+').map((t) => t.trim()).filter(Boolean);
    const termMatchers = andTerms.map((term) => {
      const negated = term.startsWith('!');
      const keyword = (negated ? term.slice(1) : term).toLowerCase();
      return (h: string) => {
        const found = h.includes(keyword);
        return negated ? !found : found;
      };
    });
    return (h) => termMatchers.every((m) => m(h));
  });

  return (h) => orMatchers.some((m) => m(h));
}

export function matchesFilter(entry: LogEntry, filters: Filters): boolean {
  if (filters.level && !filters.level.includes(entry.level)) return false;
  if (filters.source && !globMatch(filters.source, entry.source)) return false;
  if (filters.from && entry.timestamp < filters.from) return false;
  if (filters.to && entry.timestamp > filters.to) return false;
  if (filters.grep) {
    const haystack =
      (entry.message + ' ' + entry.source + ' ' + entry.metadata).toLowerCase();
    if (!filters._grepMatcher) {
      filters._grepMatcher = buildGrepMatcher(filters.grep);
    }
    if (!filters._grepMatcher(haystack)) return false;
  }
  return true;
}
