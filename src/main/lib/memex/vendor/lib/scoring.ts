/**
 * Ranked lexical scoring engine for memex search.
 * Pure functions — no I/O, no side effects. All matching is case-insensitive.
 */

// ---- Types ----

export interface ScoredMatch {
  slug: string;
  score: number;             // 0-1 normalized
  coverage: number;          // matchedTokens / effectiveTokens
  matchedTokens: number;
  effectiveTokens: number;
  firstMatchIndex: number;   // earliest matched token position in query (0-based)
  matchLine: string;         // first matching line for display
  matchedFields: string[];   // e.g. ["tag:auth", "body:JWT"]
}

export interface SearchableFields {
  slug: string;
  title: string;
  tags: string[];
  category: string;
  headings: string[];        // extracted heading lines
  wikilinks: string[];
  body: string;              // full content
  bodyLines: string[];       // split lines for matchLine extraction
}

export interface TokenizeResult {
  tokens: string[];          // effective tokens (stopwords removed, compounds expanded)
  originalTokens: string[];  // before stopword removal
  stopwordsRemoved: string[];
}

// ---- Constants ----

const FIELD_WEIGHTS = {
  slug: 5,
  title: 5,
  tags: 4,
  category: 3,
  headings: 3,
  wikilinks: 2,
  body: 1,
} as const;

const MAX_FIELD_WEIGHT = Math.max(...Object.values(FIELD_WEIGHTS));

const CODE_TOKEN_BOOST = 2;

// Tag/category segment match gets slightly lower weight than whole exact match
const SEGMENT_MATCH_PENALTY = 0.8;

// Low-signal tokens in slug/title get heavily penalized in scoring
const LOW_SIGNAL_PENALTY = 0.25;

const EN_STOPWORDS = new Set([
  "how", "what", "when", "where", "why", "which", "can", "does", "should",
  "would", "could", "the", "a", "an", "is", "are", "was", "were", "be",
  "been", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "about", "fix", "use", "get", "set", "make", "do", "did",
]);

const CJK_STOPWORDS = new Set([
  "的", "了", "是", "在", "我", "这个", "那个", "什么", "怎么", "如何",
  "问题", "实现", "使用", "一个",
]);

const ALL_STOPWORDS = new Set([...EN_STOPWORDS, ...CJK_STOPWORDS]);

// ---- Code-token detection ----

const CODE_TOKEN_RE = /(?:[A-Z]{2,}$|[a-z][a-zA-Z]*[A-Z]|[A-Z][a-z]+[A-Z]|\d|[_.\/])/;

/** Detect if a token looks like a code identifier (using original case). */
export function isCodeToken(originalToken: string): boolean {
  return CODE_TOKEN_RE.test(originalToken);
}

// ---- CJK detection ----

const CJK_RE = /\p{Unified_Ideograph}+/gu;
const CJK_CHAR_RE = /\p{Unified_Ideograph}/u;
const ASCII_TOKEN_RE = /[a-zA-Z0-9_\-./]+/g;

// ---- Tokenization ----

/**
 * Tokenize a query string:
 * 1. Extract ASCII tokens and CJK fragments
 * 2. Expand compound tokens (jwt-migration → jwt-migration, jwt, migration)
 * 3. Filter stopwords
 * 4. Fallback to original tokens if all filtered
 */
export function tokenizeQuery(query: string): TokenizeResult {
  const rawSegments = extractTokenSegments(query);

  // Expand compounds
  const expanded = expandCompoundTokens(rawSegments);

  // Build normalized→original casing map (first occurrence wins)
  const originalCasingMap = new Map<string, string>();
  for (const t of expanded) {
    const lower = t.toLowerCase();
    if (!originalCasingMap.has(lower)) {
      originalCasingMap.set(lower, t);
    }
  }

  // Remove duplicates preserving order (lowercased for matching)
  const deduped = [...new Set(expanded.map(t => t.toLowerCase()))];

  // originalTokens preserves the original casing for each unique normalized token
  const originalTokensAll = deduped.map(t => originalCasingMap.get(t) ?? t);

  // Filter stopwords
  const stopwordsRemoved: string[] = [];
  const tokens: string[] = [];
  const originalTokensFiltered: string[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const t = deduped[i];
    if (ALL_STOPWORDS.has(t)) {
      stopwordsRemoved.push(t);
    } else {
      tokens.push(t);
      originalTokensFiltered.push(originalTokensAll[i]);
    }
  }

  // Fallback: if all tokens were stopwords, use originals
  if (tokens.length === 0 && deduped.length > 0) {
    return { tokens: deduped, originalTokens: originalTokensAll, stopwordsRemoved: [] };
  }

  return { tokens, originalTokens: originalTokensFiltered, stopwordsRemoved };
}

/** Extract ASCII and CJK token segments from text. */
function extractTokenSegments(text: string): string[] {
  const segments: string[] = [];
  // Extract ASCII tokens
  for (const match of text.matchAll(ASCII_TOKEN_RE)) {
    segments.push(match[0]);
  }
  // Extract CJK fragments
  for (const match of text.matchAll(CJK_RE)) {
    segments.push(match[0]);
  }
  return segments;
}

/** Expand compound tokens: jwt-migration → [jwt-migration, jwt, migration] */
function expandCompoundTokens(tokens: string[]): string[] {
  const result: string[] = [];
  for (const token of tokens) {
    result.push(token);
    if (/[-_.\/]/.test(token)) {
      const parts = token.split(/[-_.\/]+/).filter(Boolean);
      if (parts.length > 1) {
        for (const part of parts) {
          result.push(part);
        }
      }
    }
  }
  return result;
}

// ---- Field matching ----

/**
 * Check if a token matches within a field using field-appropriate strategy.
 * Returns the match weight (0 = no match, >0 = matched with weight).
 */
function matchTokenInField(
  token: string,
  field: keyof typeof FIELD_WEIGHTS,
  fields: SearchableFields,
  originalToken: string,
): number {
  const t = token.toLowerCase();
  const weight = FIELD_WEIGHTS[field];

  switch (field) {
    case "slug": {
      if (!matchSegment(t, fields.slug, /[-_\/]/g)) return 0;
      return LOW_SIGNAL_TOKENS.has(t) ? weight * LOW_SIGNAL_PENALTY : weight;
    }

    case "title": {
      const titleMatch = matchSegment(t, fields.title, /[\s\-_]/g)
        || (CJK_CHAR_RE.test(token) && fields.title.toLowerCase().includes(t));
      if (!titleMatch) return 0;
      return LOW_SIGNAL_TOKENS.has(t) ? weight * LOW_SIGNAL_PENALTY : weight;
    }

    case "tags": {
      // Whole exact match first (highest), then segment match (penalized)
      for (const tag of fields.tags) {
        if (tag.toLowerCase() === t) return weight; // whole exact
      }
      for (const tag of fields.tags) {
        if (matchSegment(t, tag, /[-_]/g)) return weight * SEGMENT_MATCH_PENALTY;
      }
      return 0;
    }

    case "category": {
      const cat = fields.category.toLowerCase();
      if (cat === t) return weight; // whole exact
      if (matchSegment(t, fields.category, /[-_]/g)) return weight * SEGMENT_MATCH_PENALTY;
      return 0;
    }

    case "headings": {
      // CJK tokens: substring match
      if (CJK_CHAR_RE.test(token)) {
        for (const h of fields.headings) {
          if (h.toLowerCase().includes(t)) return weight;
        }
        return 0;
      }
      // ASCII tokens: word boundary match + code-token boost
      const escaped = escapeRegex(t);
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      for (const h of fields.headings) {
        if (re.test(h)) {
          const codeBoost = isCodeToken(originalToken) ? CODE_TOKEN_BOOST : 1;
          return Math.min(weight * codeBoost, MAX_FIELD_WEIGHT);
        }
      }
      return 0;
    }

    case "wikilinks":
      for (const link of fields.wikilinks) {
        if (matchSegment(t, link, /[-]/g)) return weight;
      }
      return 0;

    case "body": {
      // CJK tokens: substring match
      if (CJK_CHAR_RE.test(token)) {
        if (fields.body.toLowerCase().includes(t)) return weight;
        return 0;
      }
      // ASCII tokens: word boundary match
      const escaped = escapeRegex(t);
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      if (re.test(fields.body)) {
        // Apply code-token boost
        const codeBoost = isCodeToken(originalToken) ? CODE_TOKEN_BOOST : 1;
        return Math.min(weight * codeBoost, MAX_FIELD_WEIGHT);
      }
      return 0;
    }
  }
}

/** Check if token matches a segment in text after splitting by separator. */
function matchSegment(token: string, text: string, separatorRe: RegExp): boolean {
  const segments = text.toLowerCase().split(separatorRe).filter(Boolean);
  return segments.includes(token);
}

/** Escape regex special characters. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Build searchable fields ----

/**
 * Build SearchableFields from parsed card data.
 * Only indexes allowlisted frontmatter fields.
 */
export function buildSearchableFields(
  slug: string,
  data: Record<string, unknown>,
  content: string,
  wikilinks: string[],
): SearchableFields {
  const title = String(data.title || slug);

  // Tags: array or comma-separated string
  let tags: string[] = [];
  const rawTags = data.tags ?? data.tag;
  if (Array.isArray(rawTags)) {
    tags = rawTags.map(t => String(t).trim()).filter(Boolean);
  } else if (typeof rawTags === "string") {
    tags = rawTags.split(",").map(t => t.trim()).filter(Boolean);
  }

  const category = typeof data.category === "string" ? data.category : "";

  // Extract headings from content
  const headings: string[] = [];
  for (const line of content.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      headings.push(line.replace(/^#{1,6}\s+/, "").trim());
    }
  }

  const bodyLines = content.split("\n");

  return { slug, title, tags, category, headings, wikilinks, body: content, bodyLines };
}

// ---- Scoring ----

const FIELD_ORDER: (keyof typeof FIELD_WEIGHTS)[] = [
  "slug", "title", "tags", "category", "headings", "wikilinks", "body",
];

/**
 * Score a card against query tokens.
 * Returns null if the card doesn't meet the minimum quality threshold.
 */
export function scoreCard(
  tokens: string[],
  originalTokens: string[],  // for code-token detection (pre-lowercase)
  fields: SearchableFields,
): ScoredMatch | null {
  const effectiveTokens = tokens.length;
  if (effectiveTokens === 0) return null;

  let totalScore = 0;
  let matchedCount = 0;
  let firstMatchIndex = -1;
  const matchedFields: string[] = [];
  let firstMatchLine = "";
  let hasHighSignalMatch = false;  // for threshold exemption

  // Build a map from lowercase token → original token for code-token detection
  const originalMap = new Map<string, string>();
  for (const ot of originalTokens) {
    originalMap.set(ot.toLowerCase(), ot);
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const origToken = originalMap.get(token) ?? token;
    let bestWeight = 0;
    let bestField = "";

    // Check each field, keep highest weight
    for (const field of FIELD_ORDER) {
      const w = matchTokenInField(token, field, fields, origToken);
      if (w > bestWeight) {
        bestWeight = w;
        bestField = field;
      }
    }

    if (bestWeight > 0) {
      totalScore += bestWeight;
      matchedCount++;
      if (firstMatchIndex === -1) firstMatchIndex = i;
      matchedFields.push(`${bestField}:${token}`);

      // Check high-signal exemption
      if (isHighSignalMatch(token, bestField)) {
        hasHighSignalMatch = true;
      }

      // Find matchLine from body or headings
      if (!firstMatchLine) {
        firstMatchLine = findMatchLine(token, origToken, fields);
      }
    }
  }

  if (matchedCount === 0) return null;

  const coverage = matchedCount / effectiveTokens;
  const normalizedScore = totalScore / (effectiveTokens * MAX_FIELD_WEIGHT);

  // Apply minimum quality threshold
  if (!meetsThreshold(effectiveTokens, matchedCount, hasHighSignalMatch)) {
    return null;
  }

  return {
    slug: fields.slug,
    score: normalizedScore,
    coverage,
    matchedTokens: matchedCount,
    effectiveTokens,
    firstMatchIndex,
    matchLine: firstMatchLine,
    matchedFields,
  };
}

// Common English words that appear in many slugs/titles but carry low discriminative value.
// These do NOT get high-signal exemption for long queries.
const LOW_SIGNAL_TOKENS = new Set([
  "guide", "pattern", "patterns", "server", "config", "setup",
  "test", "testing", "flow", "workflow", "deployment", "service",
  "client", "handler", "manager", "helper", "util", "utils",
  "base", "core", "common", "shared", "default", "main",
  "index", "list", "item", "data", "info", "detail",
  "new", "old", "tmp", "temp", "app", "api",
]);

/** Check if a match qualifies for high-signal threshold exemption. */
function isHighSignalMatch(token: string, field: string): boolean {
  // Tag match always qualifies (human-curated signal)
  if (field === "tags") return true;

  // Slug/title match qualifies if token is distinctive
  if (field === "slug" || field === "title") {
    if (ALL_STOPWORDS.has(token)) return false;
    // CJK tokens are always meaningful (2 chars = a real word)
    if (CJK_CHAR_RE.test(token)) return true;
    if (token.length < 3 && !isCodeToken(token)) return false;
    // Common generic terms don't warrant exemption
    if (LOW_SIGNAL_TOKENS.has(token)) return false;
    return true;
  }

  return false;
}

/**
 * Check if a card meets the minimum quality threshold.
 * For queries with >= 4 effective tokens, require sufficient coverage.
 */
export function meetsThreshold(
  effectiveTokens: number,
  matchedTokens: number,
  hasHighSignalMatch: boolean,
): boolean {
  if (effectiveTokens < 4) return true; // short queries always pass
  if (hasHighSignalMatch) return true;   // high-signal exemption

  const minRequired = Math.max(2, Math.ceil(0.3 * effectiveTokens));
  return matchedTokens >= minRequired;
}

/** Find the first matching line in body or headings for display. */
function findMatchLine(
  token: string,
  originalToken: string,
  fields: SearchableFields,
): string {
  const escaped = escapeRegex(token);

  // Try body lines first (word boundary)
  if (CJK_CHAR_RE.test(token)) {
    for (const line of fields.bodyLines) {
      if (line.toLowerCase().includes(token)) {
        return line.trim();
      }
    }
  } else {
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    for (const line of fields.bodyLines) {
      if (re.test(line)) {
        return line.trim();
      }
    }
  }

  // Try headings
  const headingRe = new RegExp(`\\b${escaped}\\b`, "i");
  for (const h of fields.headings) {
    if (headingRe.test(h)) {
      return h;
    }
  }

  return "";
}

/** Sort scored matches: score DESC → coverage DESC → firstMatchIndex ASC → slug ASC */
export function sortScoredMatches(matches: ScoredMatch[]): ScoredMatch[] {
  return matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (a.firstMatchIndex !== b.firstMatchIndex) return a.firstMatchIndex - b.firstMatchIndex;
    return a.slug.localeCompare(b.slug);
  });
}
