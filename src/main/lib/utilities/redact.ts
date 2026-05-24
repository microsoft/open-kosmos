/**
 * Debug-info redaction utilities.
 *
 * Ported from `browser-control/native-server/src/scripts/report.ts` and
 * extended with alias-aware and schedule-JSON–aware redaction for the
 * Download Debug Info feature.
 */

import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** File extensions considered safe to decode as UTF-8 and redact. */
const TEXT_EXTENSIONS = new Set([
  '.json', '.log', '.txt', '.md', '.csv', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.env', '.sh', '.bat', '.ps1',
]);

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Literal replacements (homedir, username)
// ---------------------------------------------------------------------------

function buildLiteralReplacements(extraLiterals?: Array<[string, string]>): Array<[RegExp, string]> {
  const replacements: Array<[RegExp, string]> = [];
  const ignoreCase = process.platform === 'win32';

  const addLiteral = (literal: string | undefined, replacement: string): void => {
    if (!literal) return;
    const variants = new Set<string>();
    variants.add(literal);
    variants.add(literal.replace(/\\/g, '/'));
    variants.add(literal.replace(/\//g, '\\'));

    for (const v of variants) {
      if (!v) continue;
      replacements.push([new RegExp(escapeRegExp(v), ignoreCase ? 'gi' : 'g'), replacement]);
    }
  };

  addLiteral(os.homedir(), '<HOME>');
  addLiteral(process.env.USERPROFILE, '<USERPROFILE>');
  addLiteral(process.env.HOME, '<HOME>');

  try {
    const username = os.userInfo().username;
    if (username) {
      replacements.push([
        new RegExp(`\\b${escapeRegExp(username)}\\b`, ignoreCase ? 'gi' : 'g'),
        '<USER>',
      ]);
    }
  } catch {
    // os.userInfo() can throw on some systems — ignore
  }

  if (extraLiterals) {
    for (const [literal, replacement] of extraLiterals) {
      addLiteral(literal, replacement);
    }
  }

  return replacements;
}

// ---------------------------------------------------------------------------
// Pattern replacements (tokens, auth headers, emails, user paths)
// ---------------------------------------------------------------------------

const PATTERN_REPLACEMENTS: Array<[RegExp, string]> = [
  // Sensitive key=value patterns
  [
    /(\b[A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY)\b)(\s*["']?\s*[:=]\s*["']?)([^\s"']+)/gi,
    '$1$2<REDACTED>',
  ],
  // HTTP Authorization headers
  [/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1<REDACTED>'],
  [/(Authorization:\s*Basic\s+)[^\s]+/gi, '$1<REDACTED>'],
  // JSON-style Authorization fields
  [
    /(\bAuthorization\b)(\s*["']?\s*[:=]\s*["']?)(Bearer\s+|Basic\s+)?[^\s"']+/gi,
    '$1$2$3<REDACTED>',
  ],
  // Cookies
  [/(Cookie:\s*)[^\r\n]+/gi, '$1<REDACTED>'],
  [/(Set-Cookie:\s*)[^\r\n]+/gi, '$1<REDACTED>'],
  [/(\b(?:Cookie|Set-Cookie)\b)(\s*["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, '$1$2<REDACTED>'],
  // Common API header patterns
  [
    /(\b(?:x-api-key|api-key|x-auth-token|x-access-token)\b)(\s*["']?\s*[:=]\s*["']?)([^\s"']+)/gi,
    '$1$2<REDACTED>',
  ],
  // GitHub tokens (ghp_, gho_, ghs_, ghr_, github_pat_)
  [/\b(ghp_[A-Za-z0-9_]+)\b/g, '<REDACTED>'],
  [/\b(gho_[A-Za-z0-9_]+)\b/g, '<REDACTED>'],
  [/\b(ghs_[A-Za-z0-9_]+)\b/g, '<REDACTED>'],
  [/\b(ghr_[A-Za-z0-9_]+)\b/g, '<REDACTED>'],
  [/\b(github_pat_[A-Za-z0-9_]+)\b/g, '<REDACTED>'],
  // Email addresses
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<EMAIL>'],
  // User paths (Windows and macOS/Linux)
  [/[A-Z]:\\Users\\[^\\]+/gi, '<USERPROFILE>'],
  [/\/Users\/[^/\s]+/g, '/Users/<USER>'],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RedactorOptions {
  /** Current user alias — will be replaced with <REDACTED_ALIAS> everywhere. */
  userAlias?: string | null;
}

/**
 * Create a string redactor function.
 * The returned function applies all redaction rules to the input string.
 */
export function createRedactor(options?: RedactorOptions): (input: string) => string {
  const literalReplacements = buildLiteralReplacements();

  const aliasReplacements: Array<[RegExp, string]> = [];
  if (options?.userAlias) {
    const alias = options.userAlias;
    // Whole-word match for alias in text content
    aliasReplacements.push([
      new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g'),
      '<REDACTED_ALIAS>',
    ]);
    // Path segment match (e.g. /profiles/alias/ or \profiles\alias\)
    aliasReplacements.push([
      new RegExp(`([/\\\\])${escapeRegExp(alias)}([/\\\\])`, 'g'),
      '$1<REDACTED_ALIAS>$2',
    ]);
  }

  return (input: string): string => {
    let out = input;
    // Alias first — before general patterns that might partially match
    for (const [re, replacement] of aliasReplacements) {
      out = out.replace(re, replacement);
    }
    for (const [re, replacement] of literalReplacements) {
      out = out.replace(re, replacement);
    }
    for (const [re, replacement] of PATTERN_REPLACEMENTS) {
      out = out.replace(re, replacement);
    }
    return out;
  };
}

/**
 * Recursively apply a redactor to all string values in a JSON-like structure.
 */
export function redactDeep(value: unknown, redact: (s: string) => string): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = redactDeep(v, redact);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Structured JSON redactors
// ---------------------------------------------------------------------------

/** Fields in schedule job JSON that contain user-authored content. */
const SCHEDULE_SENSITIVE_FIELDS = new Set(['message', 'description', 'name']);

/**
 * Redact a schedule month JSON file.
 * - `message`, `description`, `name` fields → replaced entirely with `<REDACTED>`
 * - All other string values → run through the generic redactor
 */
export function redactScheduleJson(content: string, redact: (s: string) => string): string {
  try {
    const parsed = JSON.parse(content);
    const jobs = Array.isArray(parsed?.schedulerJobs) ? parsed.schedulerJobs : [];

    const redactedJobs = jobs.map((job: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(job)) {
        if (SCHEDULE_SENSITIVE_FIELDS.has(k) && typeof v === 'string') {
          out[k] = '<REDACTED>';
        } else {
          out[k] = redactDeep(v, redact);
        }
      }
      return out;
    });

    return JSON.stringify({ schedulerJobs: redactedJobs }, null, 2);
  } catch {
    // If JSON parsing fails, apply text-level redaction as fallback
    return redact(content);
  }
}

/**
 * Redact a scheduler runtime-state.json file.
 * - `alias` field → `<REDACTED_ALIAS>`
 * - All other string values → run through the generic redactor
 */
export function redactRuntimeStateJson(content: string, redact: (s: string) => string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.alias === 'string') {
      parsed.alias = '<REDACTED_ALIAS>';
    }
    const result = redactDeep(parsed, redact) as Record<string, unknown>;
    // Ensure alias stays as the explicit placeholder (redactDeep may have already handled it)
    result.alias = '<REDACTED_ALIAS>';
    return JSON.stringify(result, null, 2);
  } catch {
    return redact(content);
  }
}

/**
 * Determine the appropriate redaction strategy for a file based on its zip path,
 * apply it, and return the redacted content string.
 */
export function redactFileContent(
  content: string,
  zipPath: string,
  redact: (s: string) => string,
): string {
  // Normalize to forward slashes so Windows/mixed paths match reliably
  const normalized = zipPath.replace(/\\/g, '/');
  // Schedule month files: profiles/<alias>/schedules/<YYYYMM>.json
  if (/profiles\/[^/]+\/schedules\/\d{6}\.json$/i.test(normalized)) {
    return redactScheduleJson(content, redact);
  }
  // Runtime state files
  if (normalized.endsWith('runtime-state.json')) {
    return redactRuntimeStateJson(content, redact);
  }
  // All other text files — generic redaction
  return redact(content);
}
