/**
 * MemexService — native facade over the vendored memex commands.
 *
 * Stateless: every method takes the resolved per-agent `MemexHome` so a single
 * instance can serve all agents without caching home across calls (see
 * memexHome.ts and docs/memex-native-integration-plan.md).
 *
 * Two method families:
 *  - Text-returning (consumed by the `memex_memory` agent tool): recall,
 *    capture, search, read, links, organize, archive. These return human/LLM
 *    readable strings and THROW on genuine failures (not-found, validation,
 *    rejected sensitive input) so the tool can surface {success:false,error}.
 *  - Structured (consumed by the renderer memory sidepane via IPC): listCards,
 *    readCardStructured, getGraph. These return typed DTOs from
 *    @shared/types/memexTypes.
 */

import { unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CardStore, validateSlug } from './vendor/lib/store';
import { parseFrontmatter, stringifyFrontmatter, extractLinks } from './vendor/lib/parser';
import { prepareMemexInput, formatWarnings } from './vendor/lib/sensitiveInput';
import type { ManifestFilter } from './vendor/commands/search';
import { readCommand } from './vendor/commands/read';
import { writeCommand } from './vendor/commands/write';
import { linksCommand } from './vendor/commands/links';
import { organizeCommand } from './vendor/commands/organize';
import { archiveCommand } from './vendor/commands/archive';
import { formatCardList, formatSearchResult } from './vendor/lib/formatter';
import {
  tokenizeQuery,
  buildSearchableFields,
  scoreCard,
  sortScoredMatches,
  type ScoredMatch,
} from './vendor/lib/scoring';
import type { MemexHome } from './memexHome';
import {
  resolveMemexCaptureSource,
  type MemexCaptureSourceContext,
  type MemexCaptureSourceType,
} from './memexCaptureSourceResolver';
import { withSerializedCaptureMutation } from './memexCaptureMutationQueue';
import type {
  CardSummary,
  CardDetail,
  MemexGraph,
  MemexGraphNode,
  MemexGraphEdge,
} from '@shared/types/memexTypes';

/** Inbound-link count at/above which a card is considered a hub (matches vendored formatter/links). */
const HUB_THRESHOLD = 10;
const EXCERPT_LENGTH = 200;
const DEFAULT_SOURCE = 'openkosmos';
const CAPTURE_VALIDATION = 'memex-capture-v1';
const MAX_CAPTURE_TITLE = 160;
const MAX_CAPTURE_BODY = 12000;
const MAX_CAPTURE_APPEND_BODY = 4000;
const MAX_CAPTURE_TAG = 64;
const MAX_CAPTURE_TAGS = 16;
const MAX_PROFILE_INTENT_QUOTE = 256;
const DEFAULT_SEARCH_LIMIT = 10;
const INACTIVE_STATUSES = new Set(['resolved', 'superseded', 'archived']);
const CONFLICT_STATUS = 'conflict';

interface CurrentCardRecord {
  slug: string;
  data: Record<string, unknown>;
  content: string;
  status?: string;
}

export interface RetroInput {
  /** Optional explicit slug; derived from title when omitted. */
  slug?: string;
  title: string;
  body: string;
  category?: string;
  tags?: string[];
  /** Provenance label; defaults to 'openkosmos'. The tool passes the agent name. */
  source?: string;
}

export type MemexCaptureMode = 'remember' | 'update' | 'correct';

export interface CaptureInput {
  mode?: string;
  scope: 'current-agent' | 'profile-memory';
  slug?: string;
  title?: string;
  body?: string;
  category?: string;
  tags?: string[];
  source_type?: string;
  source?: string;
  source_anchor?: string;
  profile_intent_quote?: string;
  related_slugs?: string[];
}

export interface MemexCaptureResult {
  status: 'created' | 'updated' | 'corrected' | 'already-captured' | 'cancelled' | 'error';
  changed: boolean;
  output: string;
  metadata?: {
    writeSucceeded?: boolean;
    cancelledBeforeWrite?: boolean;
    cardPath?: string;
    slug?: string;
  };
}

export class MemexService {
  private makeStore(home: MemexHome): CardStore {
    return new CardStore(home.cardsDir, home.archiveDir, false);
  }

  /**
   * Reject slugs containing a path separator. The store is constructed with
   * nestedSlugs=false, so a write to `deep/topic/card` lands in a nested dir and
   * confirms, but scanAll collapses nested files to their basename — a later
   * read/list cannot resolve the original nested slug (silent inconsistency).
   * The vendored validateSlug intentionally allows `topic/card`; we forbid it at
   * this facade so write/read/archive stay symmetric. slugify() already produces
   * flat slugs, so derived slugs never trip this guard.
   */
  private assertFlatSlug(slug: string): void {
    validateSlug(slug);
    if (slug.includes('/') || slug.includes('\\')) {
      throw new Error(`Invalid slug "${slug}": nested paths are not supported (use a flat slug).`);
    }
  }

  // ---- Text-returning methods (agent tool) ----

  /**
   * Browse or search the knowledge base. With a query, runs keyword search;
   * without one, lists all cards (the "knowledge map" entry point). An optional
   * manifest filter (category/tag/since/before) narrows results in both modes.
   */
  async recall(home: MemexHome, query?: string, limit?: number, filter?: ManifestFilter): Promise<string> {
    const store = this.makeStore(home);
    const trimmed = query?.trim();
    if (trimmed) {
      return this.runSearch(store, trimmed, limit, filter);
    }
    const records = await this.loadCurrentCardRecords(store, filter);
    if (records.length === 0) {
      return 'No cards yet. Use the `capture` operation to save your first memory.';
    }

    const rawLimit = limit ?? DEFAULT_SEARCH_LIMIT;
    const effectiveLimit = rawLimit < 0 ? DEFAULT_SEARCH_LIMIT : Math.floor(rawLimit);
    const visibleRecords = effectiveLimit > 0 ? records.slice(0, effectiveLimit) : [];
    if (visibleRecords.length === 0) {
      return 'No active cards matched the requested limit.';
    }
    let output = formatCardList(visibleRecords.map((record) => ({
      slug: record.slug,
      title: titleWithStatusWarning(String(record.data.title || record.slug), record.status),
    })));
    if (records.length > visibleRecords.length) {
      output += `\n\n(${visibleRecords.length} of ${records.length} active cards shown. Use \`memex search <keyword>\` to narrow results.)`;
    }
    return output;
  }

  /** Keyword search (query required), with optional manifest filter. */
  async search(home: MemexHome, query: string, limit?: number, filter?: ManifestFilter): Promise<string> {
    const trimmed = query?.trim();
    if (!trimmed) throw new Error('search requires a non-empty query');
    return this.runSearch(this.makeStore(home), trimmed, limit, filter);
  }

  async capture(
    home: MemexHome,
    input: CaptureInput,
    ctx: MemexCaptureSourceContext,
  ): Promise<MemexCaptureResult> {
    const mode = normalizeCaptureMode(input.mode);
    const category = normalizeCaptureText('category', input.category, { maxLength: MAX_CAPTURE_TAG });
    if (input.profile_intent_quote) {
      normalizeCaptureText('profile_intent_quote', input.profile_intent_quote, { maxLength: MAX_PROFILE_INTENT_QUOTE });
    }

    return withSerializedCaptureMutation(home.cardsDir, async () => {
      const source = await resolveMemexCaptureSource(
        {
          scope: input.scope,
          category,
          source_type: input.source_type,
          source: input.source,
          source_anchor: input.source_anchor,
          profile_intent_quote: input.profile_intent_quote,
        },
        ctx,
      );
      return mode === 'remember'
        ? this.captureRemember(home, input, source, category, ctx)
        : this.captureAppend(home, mode, input, source, category, ctx);
    });
  }

  private async captureRemember(
    home: MemexHome,
    input: CaptureInput,
    source: Awaited<ReturnType<typeof resolveMemexCaptureSource>>,
    category: string,
    ctx: MemexCaptureSourceContext,
  ): Promise<MemexCaptureResult> {
    const title = normalizeCaptureText('title', input.title, { maxLength: MAX_CAPTURE_TITLE });
    const body = normalizeCaptureText('body', input.body, { maxLength: MAX_CAPTURE_BODY });
    const tags = normalizeCaptureTags(input.tags);
    const slug = normalizeCaptureSlug(input.slug, title);
    const relatedSlugs = normalizeRelatedSlugs(input.related_slugs);
    const store = this.makeStore(home);
    const captureKey = makeCaptureKey('remember', slug, body, source);
    const existingPath = await store.resolve(slug);
    if (existingPath) {
      const existingRaw = await store.readCard(slug);
      if (existingRaw.includes(`capture-key:${captureKey}`) || existingRaw.includes(`capture_key: ${captureKey}`)) {
        return {
          status: 'already-captured',
          changed: false,
          output: `Already captured card: ${slug}`,
          metadata: { writeSucceeded: true, cardPath: existingPath, slug },
        };
      }
      throw new Error(`Card already exists: ${slug}. Use capture mode "update" or "correct".`);
    }
    const existingTitleSlug = await this.findCardSlugByTitle(store, title);
    if (existingTitleSlug) {
      throw new Error(`Card title already exists: ${title} (${existingTitleSlug}). Use capture mode "update" or "correct".`);
    }

    ctx.abortSignal?.throwIfAborted();
    const today = currentDate();
    const data = buildCaptureFrontmatter({
      title,
      category,
      source,
      captureKey,
      today,
      tags,
    });
    const relatedText = relatedSlugs.length > 0
      ? `\n\nRelated: ${relatedSlugs.map((related) => `[[${related}]]`).join(', ')}`
      : '';
    const markdown = stringifyFrontmatter(`${body}${relatedText}`, data);
    const result = await writeCommand(store, slug, markdown);
    if (!result.success) throw new Error(result.error || 'Failed to write captured card');
    const cardPath = await store.resolve(slug) ?? undefined;
    return {
      status: 'created',
      changed: true,
      output: appendWarnings(`Captured memory card: ${slug}`, result.warnings),
      metadata: { writeSucceeded: true, cardPath, slug },
    };
  }

  private async captureAppend(
    home: MemexHome,
    mode: 'update' | 'correct',
    input: CaptureInput,
    source: Awaited<ReturnType<typeof resolveMemexCaptureSource>>,
    category: string,
    ctx: MemexCaptureSourceContext,
  ): Promise<MemexCaptureResult> {
    if (input.related_slugs && input.related_slugs.length > 0) {
      throw new Error('related_slugs is only supported for capture mode "remember".');
    }
    const body = normalizeCaptureText('body', input.body, { maxLength: MAX_CAPTURE_APPEND_BODY });
    const store = this.makeStore(home);
    const target = await this.resolveCaptureTarget(store, input);
    const raw = await store.readCard(target.slug);
    const { data, content } = parseFrontmatter(raw);
    if (raw.trimStart().startsWith('---') && Object.keys(data).length === 0) {
      throw new Error(`Card "${target.slug}" has malformed frontmatter; capture append is not allowed.`);
    }
    const status = optionalString(data.status)?.toLowerCase();
    if (status && INACTIVE_STATUSES.has(status)) {
      throw new Error(`Card "${target.slug}" is ${status}; capture append is not allowed.`);
    }

    const captureKey = makeCaptureKey(mode, target.slug, body, source);
    if (raw.includes(`capture-key:${captureKey}`)) {
      return {
        status: 'already-captured',
        changed: false,
        output: `Already captured ${mode} for card: ${target.slug}`,
        metadata: { writeSucceeded: true, cardPath: target.path, slug: target.slug },
      };
    }

    ctx.abortSignal?.throwIfAborted();
    const today = currentDate();
    const section = mode === 'update' ? 'Updates' : 'Corrections';
    const appendLine = `- ${today}: ${collapseMarkdown(body)} Source: \`${source.sourcePath}\`${source.sourceAnchor ? ` (${source.sourceAnchor})` : ''}. <!-- capture-key:${captureKey} -->`;
    const nextContent = `${content.trimEnd()}\n\n## ${section}\n\n${appendLine}\n`;
    const nextData: Record<string, unknown> = {
      ...data,
      title: optionalString(data.title) ?? target.slug,
      created: toDateString(data.created) || today,
      source: optionalString(data.source) ?? source.sourcePath,
      modified: today,
      category: optionalString(data.category) ?? category,
    };
    const result = await writeCommand(store, target.slug, stringifyFrontmatter(nextContent, nextData));
    if (!result.success) throw new Error(result.error || 'Failed to append captured memory');
    return {
      status: mode === 'update' ? 'updated' : 'corrected',
      changed: true,
      output: appendWarnings(`${mode === 'update' ? 'Updated' : 'Corrected'} memory card: ${target.slug}`, result.warnings),
      metadata: { writeSucceeded: true, cardPath: target.path, slug: target.slug },
    };
  }

  private async resolveCaptureTarget(
    store: CardStore,
    input: CaptureInput,
  ): Promise<{ slug: string; path: string }> {
    const slug = input.slug?.trim();
    if (slug) {
      this.assertFlatSlug(slug);
      const cardPath = await store.resolve(slug);
      if (!cardPath) throw new Error(`Card not found: ${slug}`);
      return { slug, path: cardPath };
    }

    const title = normalizeCaptureText('title', input.title, { maxLength: MAX_CAPTURE_TITLE });
    const cards = await store.scanAll();
    const matches: Array<{ slug: string; path: string }> = [];
    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { data } = parseFrontmatter(raw);
      if (optionalString(data.title) === title) {
        matches.push(card);
      }
    }
    if (matches.length === 0) {
      throw new Error(`No card matched title: ${title}`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple cards matched title: ${title}; provide slug.`);
    }
    return matches[0];
  }

  private async findCardSlugByTitle(store: CardStore, title: string): Promise<string | undefined> {
    const cards = await store.scanAll();
    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { data } = parseFrontmatter(raw);
      if (!isMalformedFrontmatter(raw, data) && optionalString(data.title) === title) {
        return card.slug;
      }
    }
    return undefined;
  }

  private async loadCurrentCardRecords(store: CardStore, filter?: ManifestFilter): Promise<CurrentCardRecord[]> {
    const cards = await store.scanAll();
    const records: CurrentCardRecord[] = [];
    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { data, content } = parseFrontmatter(raw);
      if (isMalformedFrontmatter(raw, data)) {
        continue;
      }
      const status = normalizedStatus(data.status);
      if (isInactiveStatus(status) || !matchesManifestFilter(data, filter)) {
        continue;
      }
      records.push({ slug: card.slug, data, content, status });
    }

    records.sort((a, b) =>
      recordSortKey(b).localeCompare(recordSortKey(a)) || a.slug.localeCompare(b.slug)
    );
    return records;
  }

  private async runSearch(
    store: CardStore,
    query: string,
    limit: number | undefined,
    filter?: ManifestFilter,
  ): Promise<string> {
    const safety = prepareMemexInput(query, 'query');
    if (!safety.ok) {
      throw new Error(safety.error || `Search failed for "${query}".`);
    }

    const records = await this.loadCurrentCardRecords(store, filter);
    const scored: ScoredMatch[] = [];
    const { tokens, originalTokens } = tokenizeQuery(safety.text);
    if (tokens.length === 0) {
      return `No cards matched "${query}".`;
    }

    for (const record of records) {
      const links = extractLinks(record.content);
      const fields = buildSearchableFields(record.slug, record.data, record.content, links);
      const match = scoreCard(tokens, originalTokens, fields);
      if (match) {
        scored.push(match);
      }
    }

    if (scored.length > 0) {
      sortScoredMatches(scored);
      const rawLimit = limit ?? DEFAULT_SEARCH_LIMIT;
      const effectiveLimit = rawLimit < 0 ? DEFAULT_SEARCH_LIMIT : Math.floor(rawLimit);
      const recordsBySlug = new Map(records.map((record) => [record.slug, record]));
      const results = scored.slice(0, effectiveLimit).map((match) => {
        const record = recordsBySlug.get(match.slug);
        if (!record) {
          return '';
        }

        const links = extractLinks(record.content);
        const paragraphs = record.content.trim().split(/\n\n+/);
        const firstParagraph = paragraphs[0]?.trim() || '';
        const warning = statusWarning(record.status);
        const showMatchLine = match.matchLine && !firstParagraph.includes(match.matchLine) ? match.matchLine : null;
        const showMatchedFields = match.matchLine === '' ? match.matchedFields : undefined;

        return formatSearchResult({
          slug: record.slug,
          title: titleWithStatusWarning(String(record.data.title || record.slug), record.status),
          firstParagraph: warning ? `${warning}\n${firstParagraph}`.trim() : firstParagraph,
          matchLine: showMatchLine,
          links,
          matchedFields: showMatchedFields,
        });
      }).filter(Boolean);

      if (results.length > 0) {
        const output = results.join('\n\n');
        return safety.warnings.length > 0 ? `${formatWarnings(safety.warnings)}\n\n${output}` : output;
      }
    }

    return `No cards matched "${query}".`;
  }

  /**
   * Capture a new memory (or overwrite an existing slug) from structured fields,
   * auto-filling `created` (today) and `source`. Returns a confirmation string.
   */
  async retro(home: MemexHome, input: RetroInput): Promise<string> {
    if (!input.title?.trim()) throw new Error('retro requires a title');
    const store = this.makeStore(home);
    const slug = (input.slug?.trim() || slugify(input.title)) ?? '';
    if (!slug) throw new Error('retro could not derive a slug from the title');
    this.assertFlatSlug(slug);

    const today = new Date().toISOString().split('T')[0];
    const data: Record<string, unknown> = {
      title: input.title.trim(),
      created: today,
      source: input.source?.trim() || DEFAULT_SOURCE,
    };
    if (input.category?.trim()) data.category = input.category.trim();
    if (input.tags && input.tags.length > 0) {
      data.tags = input.tags.map((t) => t.trim()).filter(Boolean).join(', ');
    }

    const markdown = stringifyFrontmatter(input.body ?? '', data);
    const result = await writeCommand(store, slug, markdown);
    if (!result.success) throw new Error(result.error || 'Failed to write card');
    return formatWriteConfirmation(slug, result.warnings);
  }

  /**
   * Write a raw card whose markdown already contains YAML frontmatter
   * (must include title/created/source). Power-user path; prefer `retro`.
   */
  async write(home: MemexHome, slug: string, content: string): Promise<string> {
    if (!slug?.trim()) throw new Error('write requires a slug');
    this.assertFlatSlug(slug.trim());
    const result = await writeCommand(this.makeStore(home), slug.trim(), content);
    if (!result.success) throw new Error(result.error || 'Failed to write card');
    return formatWriteConfirmation(slug.trim(), result.warnings);
  }

  /** Read a card's full markdown by slug. */
  async read(home: MemexHome, slug: string): Promise<string> {
    if (!slug?.trim()) throw new Error('read requires a slug');
    this.assertFlatSlug(slug.trim());
    const result = await readCommand(this.makeStore(home), slug.trim());
    if (!result.success) throw new Error(result.error || `Card not found: ${slug}`);
    const content = result.content ?? '';
    const { data } = parseFrontmatter(content);
    const status = normalizedStatus(data.status);
    if (isInactiveStatus(status)) {
      throw new Error(`Card "${slug.trim()}" is ${status}; read is not available for inactive memory.`);
    }
    const warning = statusWarning(status);
    return warning ? `${warning}\n\n${content}` : content;
  }

  /**
   * Inspect the link graph. With a slug, shows that card's outbound/inbound
   * links; without one, shows aggregate link stats.
   */
  async links(home: MemexHome, slug?: string): Promise<string> {
    const store = this.makeStore(home);
    const target = slug?.trim() || undefined;
    if (target) {
      this.assertFlatSlug(target);
      const resolved = await store.resolve(target);
      if (!resolved) throw new Error(`Card not found: ${target}`);
    }
    const result = await linksCommand(store, target, { stats: !target, home: home.root });
    return result.output || 'No cards yet.';
  }

  /** Produce an organize report (orphans, hubs, conflicts, neighbor pairs). */
  async organize(home: MemexHome): Promise<string> {
    const result = await organizeCommand(this.makeStore(home), null);
    return result.output || 'No cards yet.';
  }

  /** Archive (soft-delete) a card by slug. */
  async archive(home: MemexHome, slug: string): Promise<string> {
    if (!slug?.trim()) throw new Error('archive requires a slug');
    this.assertFlatSlug(slug.trim());
    const result = await archiveCommand(this.makeStore(home), slug.trim());
    if (!result.success) throw new Error(result.error || `Failed to archive: ${slug}`);
    return `Archived card: ${slug.trim()}`;
  }

  /** Permanently delete an active card by slug. */
  async delete(home: MemexHome, slug: string): Promise<string> {
    if (!slug?.trim()) throw new Error('delete requires a slug');
    const trimmed = slug.trim();
    this.assertFlatSlug(trimmed);
    const store = this.makeStore(home);
    const cardPath = await store.resolve(trimmed);
    if (!cardPath) throw new Error(`Card not found: ${trimmed}`);
    await unlink(cardPath);
    store.invalidateCache();
    return `Deleted card: ${trimmed}`;
  }

  // ---- Structured methods (renderer sidepane) ----

  /** List all cards (newest first) as one-line summaries. */
  async listCards(home: MemexHome): Promise<CardSummary[]> {
    const store = this.makeStore(home);
    const records = await this.loadCurrentCardRecords(store);
    const summaries: CardSummary[] = [];
    for (const record of records) {
      summaries.push({
        slug: record.slug,
        title: String(record.data.title || record.slug),
        category: optionalString(record.data.category),
        created: toDateString(record.data.created) || undefined,
        modified: toDateString(record.data.modified) || undefined,
        status: record.status,
        warning: statusWarning(record.status),
        excerpt: buildExcerpt(record.content),
      });
    }
    summaries.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.slug.localeCompare(b.slug));
    return summaries;
  }

  /**
   * Keyword-filter cards for the sidepane search box. Every whitespace-separated
   * token must match (case-insensitive) against slug, title, category, tags, or
   * body. Returns the same CardSummary shape as listCards, newest-first. An empty
   * query returns all cards (capped by limit when provided).
   */
  async searchCards(home: MemexHome, query: string, limit?: number): Promise<CardSummary[]> {
    const store = this.makeStore(home);
    const records = await this.loadCurrentCardRecords(store);
    const tokens = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const summaries: CardSummary[] = [];
    for (const record of records) {
      if (tokens.length > 0) {
        const tags = parseTags(record.data.tags ?? record.data.tag) ?? [];
        const haystack = [
          record.slug,
          String(record.data.title || ''),
          optionalString(record.data.category) ?? '',
          tags.join(' '),
          record.content,
        ].join(' ').toLowerCase();
        if (!tokens.every((tok) => haystack.includes(tok))) continue;
      }
      summaries.push({
        slug: record.slug,
        title: String(record.data.title || record.slug),
        category: optionalString(record.data.category),
        created: toDateString(record.data.created) || undefined,
        modified: toDateString(record.data.modified) || undefined,
        status: record.status,
        warning: statusWarning(record.status),
        excerpt: buildExcerpt(record.content),
      });
    }
    summaries.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.slug.localeCompare(b.slug));
    return typeof limit === 'number' && limit > 0 ? summaries.slice(0, Math.floor(limit)) : summaries;
  }

  /** Full detail for one card, including resolved inbound/outbound links. */
  async readCardStructured(home: MemexHome, slug: string): Promise<CardDetail> {
    const store = this.makeStore(home);
    const raw = await store.readCard(slug);
    const { data, content } = parseFrontmatter(raw);
    const linkResult = await linksCommand(store, slug, { json: true, home: home.root });
    const cards = await store.scanAll();
    const { outbound, resolvedWikilinks } = resolveKnownOutboundLinks(store, cards, content);
    let inbound: string[] = [];
    try {
      const parsed = JSON.parse(linkResult.output) as { inbound?: string[] };
      if (Array.isArray(parsed.inbound)) inbound = parsed.inbound;
    } catch {
      // Fall back to resolved outbound; inbound stays empty.
    }
    return {
      slug,
      title: String(data.title || slug),
      category: optionalString(data.category),
      created: toDateString(data.created) || undefined,
      modified: toDateString(data.modified) || undefined,
      source: optionalString(data.source),
      tags: parseTags(data.tags ?? (data as Record<string, unknown>).tag),
      status: optionalString(data.status),
      content: content.trim(),
      rawContent: raw.trim(),
      outbound,
      resolvedWikilinks,
      inbound,
    };
  }

  /** Build the full link graph (nodes + edges + orphan/hub classification). */
  async getGraph(home: MemexHome): Promise<MemexGraph> {
    const store = this.makeStore(home);
    const cards = await store.scanAll();
    const resolveLink = store.buildLinkResolver(cards);
    const titles = new Map<string, string>();
    const outboundMap = new Map<string, string[]>(); // resolved targets that are known cards
    const inboundMap = new Map<string, string[]>();
    const known = new Set(cards.map((c) => c.slug));

    for (const card of cards) inboundMap.set(card.slug, []);

    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { data, content } = parseFrontmatter(raw);
      titles.set(card.slug, String(data.title || card.slug));
      const resolvedOut: string[] = [];
      for (const link of extractLinks(content)) {
        const resolved = resolveLink(link) ?? link;
        if (!known.has(resolved)) continue; // only edges between known cards
        resolvedOut.push(resolved);
        inboundMap.get(resolved)!.push(card.slug);
      }
      outboundMap.set(card.slug, resolvedOut);
    }

    const nodes: MemexGraphNode[] = [];
    const edges: MemexGraphEdge[] = [];
    const orphans: string[] = [];
    const hubs: string[] = [];
    const seenEdges = new Set<string>();

    for (const card of cards) {
      const out = outboundMap.get(card.slug) ?? [];
      const inboundCount = (inboundMap.get(card.slug) ?? []).length;
      const isOrphan = inboundCount === 0;
      const isHub = inboundCount >= HUB_THRESHOLD;
      nodes.push({
        slug: card.slug,
        title: titles.get(card.slug) ?? card.slug,
        outbound: out.length,
        inbound: inboundCount,
        isOrphan,
        isHub,
      });
      if (isOrphan) orphans.push(card.slug);
      if (isHub) hubs.push(card.slug);
      for (const to of out) {
        const key = JSON.stringify([card.slug, to]);
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        edges.push({ from: card.slug, to });
      }
    }

    return { nodes, edges, orphans, hubs };
  }
}

/** Shared singleton — the service holds no per-agent state. */
export const memexService = new MemexService();

// ---- helpers ----

function formatWriteConfirmation(slug: string, warnings?: string[]): string {
  const base = `Saved card: ${slug}`;
  if (warnings && warnings.length > 0) {
    return `${base}\n${warnings.map((w) => `Warning: ${w}`).join('\n')}`;
  }
  return base;
}

function appendWarnings(output: string, warnings?: string[]): string {
  return warnings && warnings.length > 0 ? `${output}\n${formatWarnings(warnings)}` : output;
}

function normalizeCaptureMode(raw: string | undefined): MemexCaptureMode {
  const mode = raw?.trim() || 'remember';
  if (mode === 'remember' || mode === 'update' || mode === 'correct') {
    return mode;
  }
  throw new Error('capture mode must be remember, update, or correct.');
}

function normalizeCaptureText(
  field: string,
  raw: string | undefined,
  options: { maxLength: number },
): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error(`capture requires ${field}.`);
  }
  if (trimmed.length > options.maxLength) {
    throw new Error(`capture ${field} exceeds ${options.maxLength} characters.`);
  }
  if (trimmed.includes('<!-- capture-key:')) {
    throw new Error(`capture ${field} must not contain capture-key comments.`);
  }
  if (trimmed.includes('[[') || trimmed.includes(']]')) {
    throw new Error(`capture ${field} must not contain raw wikilinks.`);
  }
  const safety = prepareMemexInput(trimmed, 'content');
  if (!safety.ok) {
    throw new Error(safety.error || `capture ${field} was rejected.`);
  }
  const prepared = safety.text.trim();
  if (!prepared) {
    throw new Error(`capture requires ${field}.`);
  }
  return prepared;
}

function normalizeCaptureTags(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const tags = raw
    .map((tag) => normalizeCaptureText('tag', tag, { maxLength: MAX_CAPTURE_TAG }))
    .filter(Boolean);
  if (tags.length > MAX_CAPTURE_TAGS) {
    throw new Error(`capture tags exceeds ${MAX_CAPTURE_TAGS} items.`);
  }
  return Array.from(new Set(tags));
}

function normalizeRelatedSlugs(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  return Array.from(new Set(raw.map((slug) => {
    const trimmed = slug.trim();
    validateSlug(trimmed);
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error(`Invalid related slug "${trimmed}": nested paths are not supported.`);
    }
    return trimmed;
  })));
}

function normalizeCaptureSlug(raw: string | undefined, title: string): string {
  const slug = raw?.trim() || slugify(title);
  validateSlug(slug);
  if (slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Invalid slug "${slug}": nested paths are not supported.`);
  }
  return slug;
}

function buildCaptureFrontmatter(options: {
  title: string;
  category: string;
  source: {
    sourceType: MemexCaptureSourceType;
    sourcePath: string;
    sourceAnchor?: string;
    sourceRelpath?: string;
    sourceChatId?: string;
    sourceChatSessionId?: string;
    sourceAgentId?: string;
    sourceAgentName?: string;
  };
  captureKey: string;
  today: string;
  tags: string[];
}): Record<string, unknown> {
  const { source } = options;
  const data: Record<string, unknown> = {
    title: options.title,
    created: options.today,
    modified: options.today,
    source_type: source.sourceType,
    source: source.sourcePath,
    provenance: 'validated',
    capture_validation: CAPTURE_VALIDATION,
    capture_key: options.captureKey,
    category: options.category,
    status: 'active',
  };
  if (source.sourceAnchor) {
    data.source_anchor = source.sourceAnchor;
    data.source_anchor_validation = 'validated';
  }
  if (source.sourceChatId) data.source_chat_id = source.sourceChatId;
  if (source.sourceChatSessionId) data.source_chat_session_id = source.sourceChatSessionId;
  if (source.sourceRelpath) data.source_relpath = source.sourceRelpath;
  if (source.sourceAgentId) data.source_agent_id = source.sourceAgentId;
  if (source.sourceAgentName) data.source_agent_name = source.sourceAgentName;
  if (options.tags.length > 0) data.tags = options.tags.join(', ');
  return data;
}

function makeCaptureKey(
  mode: MemexCaptureMode,
  slug: string,
  body: string,
  source: { sourceType: string; sourcePath: string; sourceAnchor?: string },
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      mode,
      slug,
      body,
      sourceType: source.sourceType,
      sourcePath: source.sourcePath,
      sourceAnchor: source.sourceAnchor ?? '',
    }))
    .digest('hex');
}

function currentDate(): string {
  return new Date().toISOString().split('T')[0];
}

function collapseMarkdown(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `card-${Date.now()}`;
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string') return val.slice(0, 10);
  return '';
}

function optionalString(val: unknown): string | undefined {
  if (typeof val === 'string' && val.trim()) return val.trim();
  return undefined;
}

function isMalformedFrontmatter(raw: string, data: Record<string, unknown>): boolean {
  return raw.trimStart().startsWith('---') && Object.keys(data).length === 0;
}

function normalizedStatus(val: unknown): string | undefined {
  const status = optionalString(val);
  return status ? status.toLowerCase() : undefined;
}

function isInactiveStatus(status: string | undefined): boolean {
  return status ? INACTIVE_STATUSES.has(status) : false;
}

function statusWarning(status: string | undefined): string | undefined {
  if (status === CONFLICT_STATUS) {
    return 'Warning: this memory is marked conflict; verify it before relying on it.';
  }
  return undefined;
}

function titleWithStatusWarning(title: string, status: string | undefined): string {
  return status === CONFLICT_STATUS ? `${title} [CONFLICT - verify before relying]` : title;
}

function matchesManifestFilter(data: Record<string, unknown>, filter: ManifestFilter | undefined): boolean {
  if (!filter) return true;

  if (filter.category) {
    const category = optionalString(data.category);
    if (!category || category.toLowerCase() !== filter.category.toLowerCase()) return false;
  }

  if (filter.tag) {
    const tag = filter.tag.toLowerCase();
    const tags = parseTags(data.tags ?? data.tag) ?? [];
    if (!tags.map((item) => item.toLowerCase()).includes(tag)) return false;
  }

  if (filter.author) {
    const author = optionalString(data.author)?.toLowerCase();
    const source = optionalString(data.source)?.toLowerCase();
    const expected = filter.author.toLowerCase();
    if (author !== expected && source !== expected) return false;
  }

  if (filter.since) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    if (!(created >= filter.since || modified >= filter.since)) return false;
  }

  if (filter.before) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    const createdOk = created !== '' && created < filter.before;
    const modifiedOk = modified !== '' && modified < filter.before;
    if (!createdOk && !modifiedOk) return false;
  }

  return true;
}

function parseTags(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  let tags: string[];
  if (Array.isArray(raw)) {
    tags = raw.map((t) => String(t).trim());
  } else {
    tags = String(raw).split(',').map((t) => t.trim());
  }
  tags = tags.filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function resolveKnownOutboundLinks(
  store: CardStore,
  cards: Awaited<ReturnType<CardStore['scanAll']>>,
  content: string,
): { outbound: string[]; resolvedWikilinks: Record<string, string> } {
  const resolveLink = store.buildLinkResolver(cards);
  const known = new Set(cards.map((card) => card.slug));
  const resolved: string[] = [];
  const resolvedWikilinks: Record<string, string> = {};
  const seen = new Set<string>();
  for (const link of extractLinks(content)) {
    const slug = resolveLink(link);
    if (!slug || !known.has(slug)) continue;
    resolvedWikilinks[link] = slug;
    if (seen.has(slug)) continue;
    seen.add(slug);
    resolved.push(slug);
  }
  return { outbound: resolved, resolvedWikilinks };
}

function buildExcerpt(content: string): string {
  const firstParagraph = content.trim().split(/\n\n+/)[0] ?? '';
  const collapsed = firstParagraph.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= EXCERPT_LENGTH) return collapsed;
  return collapsed.slice(0, EXCERPT_LENGTH).trimEnd() + '…';
}

function sortKey(summary: CardSummary): string {
  return summary.modified || summary.created || '';
}

function recordSortKey(record: CurrentCardRecord): string {
  return toDateString(record.data.modified) || toDateString(record.data.created) || '';
}
