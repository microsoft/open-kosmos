import { CardStore } from "../lib/store";
import { parseFrontmatter, extractLinks } from "../lib/parser";
import { formatCardList, formatSearchResult, formatCompactSearchResult } from "../lib/formatter";
import { MemexConfig } from "../lib/config";
// VENDOR PATCH: embeddings import + semantic search removed (no semantic search
// in OpenKosmos). See vendor/PATCHES.md.
import {
  tokenizeQuery,
  buildSearchableFields,
  scoreCard,
  sortScoredMatches,
  type ScoredMatch,
} from "../lib/scoring";
import { join } from "node:path";
import { formatWarnings, prepareMemexInput, type SensitiveInputResult } from "../lib/sensitiveInput";

const DEFAULT_LIMIT = 10;

export interface ManifestFilter {
  category?: string;
  tag?: string;
  author?: string;
  since?: string;   // YYYY-MM-DD
  before?: string;  // YYYY-MM-DD
}

interface SearchOptions {
  limit?: number;
  all?: boolean;
  config?: MemexConfig;
  memexHome?: string;
  compact?: boolean;
  filter?: ManifestFilter;
  /** When true with no query, list cards instead of showing guidance. */
  list?: boolean;
}

interface SearchResult {
  output: string;
  exitCode: number;
  totalCount?: number;
  warnings?: string[];
}

export async function searchCommand(store: CardStore, query: string | undefined, options: SearchOptions = {}): Promise<SearchResult> {
  const safety: SensitiveInputResult = query ? prepareMemexInput(query, "query") : { ok: true, text: query ?? "", warnings: [] };
  if (!safety.ok) return { output: safety.error ?? "Sensitive input rejected.", exitCode: 1 };
  query = safety.text;

  // Gather all stores to search
  const storesToSearch: Array<{ store: CardStore; dirPrefix: string }> = [
    { store, dirPrefix: "cards" }
  ];

  // Add additional search directories if --all is set
  if (options.all && options.config?.searchDirs && options.config.searchDirs.length > 0 && options.memexHome) {
    const archiveDir = join(options.memexHome, "archive");
    for (const searchDir of options.config.searchDirs) {
      const fullPath = join(options.memexHome, searchDir);
      const additionalStore = new CardStore(fullPath, archiveDir, store["nestedSlugs"]);
      const dirName = searchDir.split("/").pop() || searchDir;
      storesToSearch.push({ store: additionalStore, dirPrefix: dirName });
    }
  }

  // Only prefix slugs if we're actually searching multiple directories
  const shouldPrefix = storesToSearch.length > 1;

  // Collect all cards from all stores
  let allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }> = [];
  for (const { store: s, dirPrefix } of storesToSearch) {
    const cards = await s.scanAll();
    for (const card of cards) {
      allCards.push({ slug: card.slug, store: s, dirPrefix });
    }
  }

  if (allCards.length === 0) return withWarnings({ output: "", exitCode: 0 }, safety.warnings);

  // Apply manifest pre-filter
  if (options.filter) {
    allCards = await filterByManifest(allCards, options.filter);
    if (allCards.length === 0) return withWarnings({ output: "", exitCode: 0 }, safety.warnings);
  }

  // VENDOR PATCH: semantic search path removed.

  // No query: guidance or list
  if (!query) {
    // Show guidance only when no query, no filter, and no list flag
    if (!options.list && !options.filter) {
      const guidance = [
        "No query provided. To search your knowledge base:",
        "- memex read index — view your knowledge map",
        "- memex search <keyword> — keyword search",
        "Use --list to browse all cards.",
      ].join("\n");
      return withWarnings({ output: guidance, exitCode: 0, totalCount: allCards.length }, safety.warnings);
    }
    const rawLimit = options.limit ?? DEFAULT_LIMIT;
    const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;
    const toProcess = limit > 0 ? allCards.slice(0, limit) : [];
    const items = await Promise.all(
      toProcess.map(async (c) => {
        const raw = await c.store.readCard(c.slug);
        const { data } = parseFrontmatter(raw);
        const prefixedSlug = shouldPrefix ? `${c.dirPrefix}/${c.slug}` : c.slug;
        return { slug: prefixedSlug, title: String(data.title || c.slug) };
      })
    );
    let output = formatCardList(items);
    if (allCards.length > toProcess.length) {
      output += `\n\n(${toProcess.length} of ${allCards.length} cards shown. Use \`memex search <keyword>\` to narrow results.)`;
    }
    return withWarnings({ output, exitCode: 0, totalCount: allCards.length }, safety.warnings);
  }

  // With query: keyword search body only (strip frontmatter before matching)
  return withWarnings(await keywordSearch(query, allCards, shouldPrefix, options), safety.warnings);
}

function withWarnings(result: SearchResult, warnings: string[]): SearchResult {
  if (warnings.length === 0) return result;
  const warningText = formatWarnings(warnings);
  return {
    ...result,
    warnings,
    output: result.output ? `${warningText}\n\n${result.output}` : warningText,
  };
}

// --- Manifest pre-filter ---

async function filterByManifest(
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  filter: ManifestFilter,
): Promise<Array<{ slug: string; store: CardStore; dirPrefix: string }>> {
  const results: Array<{ slug: string; store: CardStore; dirPrefix: string }> = [];

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data } = parseFrontmatter(raw);

    if (!matchesFilter(data, filter)) continue;
    results.push(card);
  }

  return results;
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "string") return val.slice(0, 10);
  return "";
}

function matchesFilter(data: Record<string, unknown>, filter: ManifestFilter): boolean {
  // Category: exact match (case-insensitive)
  if (filter.category) {
    const val = data.category;
    if (typeof val !== "string" || val.toLowerCase() !== filter.category.toLowerCase()) {
      return false;
    }
  }

  // Tag: check if filter value appears in tags (array or comma-separated string)
  if (filter.tag) {
    const needle = filter.tag.toLowerCase();
    const raw = data.tags ?? data.tag;
    if (raw == null) return false;

    let tags: string[];
    if (Array.isArray(raw)) {
      tags = raw.map((t) => String(t).trim().toLowerCase());
    } else {
      tags = String(raw).split(",").map((t) => t.trim().toLowerCase());
    }

    if (!tags.includes(needle)) return false;
  }

  // Author: match against 'author' or 'source' field (case-insensitive)
  if (filter.author) {
    const needle = filter.author.toLowerCase();
    const author = data.author;
    const source = data.source;
    const authorMatch = typeof author === "string" && author.toLowerCase() === needle;
    const sourceMatch = typeof source === "string" && source.toLowerCase() === needle;
    if (!authorMatch && !sourceMatch) return false;
  }

  // Since: card's 'created' OR 'modified' date >= filter date
  if (filter.since) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    if (!(created >= filter.since || modified >= filter.since)) return false;
  }

  // Before: card's 'created' OR 'modified' date < filter date
  if (filter.before) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    const createdOk = created !== "" && created < filter.before;
    const modifiedOk = modified !== "" && modified < filter.before;
    if (!createdOk && !modifiedOk) return false;
  }

  return true;
}

// --- Keyword search (ranked lexical retrieval) ---

async function keywordSearch(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  shouldPrefix: boolean,
  options: SearchOptions,
): Promise<SearchResult> {
  const rawLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;

  const { tokens, originalTokens } = tokenizeQuery(query);
  if (tokens.length === 0) return { output: "", exitCode: 0 };

  const scored: ScoredMatch[] = [];

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const fields = buildSearchableFields(card.slug, data, content, links);

    const match = scoreCard(tokens, originalTokens, fields);
    if (!match) continue;

    // Override slug with prefixed version if needed
    if (shouldPrefix) {
      match.slug = `${card.dirPrefix}/${card.slug}`;
    }

    scored.push(match);
  }

  if (scored.length === 0) return { output: "", exitCode: 0 };

  sortScoredMatches(scored);
  const topCards = scored.slice(0, limit);

  const results: string[] = [];
  for (const matched of topCards) {
    // Re-read to get full content for display
    const originalSlug = shouldPrefix ? matched.slug.split("/").slice(1).join("/") : matched.slug;
    const card = allCards.find(c => c.slug === originalSlug || `${c.dirPrefix}/${c.slug}` === matched.slug);
    if (!card) continue;

    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const paragraphs = content.trim().split(/\n\n+/);
    const firstParagraph = paragraphs[0]?.trim() || "";

    const showMatchLine = matched.matchLine && !firstParagraph.includes(matched.matchLine) ? matched.matchLine : null;

    // Only show matchedFields when it's a true metadata-only match (no body/heading matchLine found by scorer)
    // Don't show it when matchLine was just suppressed because it's in firstParagraph
    const showMatchedFields = matched.matchLine === "" ? matched.matchedFields : undefined;

    const item = {
      slug: matched.slug,
      title: String(data.title || card.slug),
      firstParagraph,
      matchLine: showMatchLine,
      links,
      matchedFields: showMatchedFields,
    };

    results.push(
      options.compact
        ? formatCompactSearchResult(item)
        : formatSearchResult(item)
    );
  }
  return { output: results.join(options.compact ? "\n" : "\n\n"), exitCode: 0, totalCount: scored.length };
}
