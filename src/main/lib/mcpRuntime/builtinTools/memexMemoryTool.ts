/**
 * memex_memory — single built-in tool that orchestrates memex memory operations.
 * By default it uses the calling agent's isolated current-agent memory tree
 * under <userData>/profiles/<alias>/agents/<agentId>/memory. With
 * scope="profile-memory", it uses the profile-scoped shared memory tree under
 * <userData>/profiles/<alias>/profile-memory.
 *
 * Operations:
 *  - recall   : browse the knowledge map, keyword-search, or browse by filter (no query)
 *  - search   : keyword search (query required); for no-keyword filtering use recall
 *  - capture  : save durable memory from validated existing local evidence
 *  - read     : read one card's full markdown by slug
 *  - links    : inspect the link graph (per-card with slug, else aggregate stats)
 *  - organize : produce an organize report (orphans/hubs/conflicts/neighbors)
 *  - archive  : soft-delete a card by slug
 *
 * Wraps the native MemexService (vendored memex), not the memex CLI/MCP server.
 * See docs/memex-native-integration-plan.md and vendor/PATCHES.md.
 */

import { app } from 'electron';
import { memexService, type MemexCaptureResult } from '../../memex/MemexService';
import { buildAgentMemexHome, buildProfileMemexHome, type MemexHome } from '../../memex/memexHome';
import { emitCardsChanged } from '../../memex/memexEvents';
import type { ManifestFilter } from '../../memex/vendor/commands/search';
import type { MemexMemoryScope } from '@shared/types/memexTypes';
import type { BuiltinToolDefinition } from './types';
import type { MemexCaptureSourceContext } from '../../memex/memexCaptureSourceResolver';

export const MEMEX_OPERATIONS = [
  'recall',
  'search',
  'capture',
  'read',
  'links',
  'organize',
  'archive',
] as const;

export type MemexOperation = (typeof MEMEX_OPERATIONS)[number];

export const MEMEX_MEMORY_SCOPES = ['current-agent', 'profile-memory'] as const;

export interface MemexMemoryToolArgs {
  operation?: string;
  /** Memory scope. Defaults to current-agent for backward compatibility. */
  scope?: string;
  /** Short human-readable summary of intent (shown in activity/UI). */
  description?: string;
  query?: string;
  slug?: string;
  title?: string;
  body?: string;
  mode?: string;
  source_type?: string;
  source?: string;
  source_anchor?: string;
  profile_intent_quote?: string;
  category?: string;
  /** Tag list for capture-created cards. */
  tags?: string[];
  related_slugs?: string[];
  /** Single tag for search/recall metadata filtering. */
  tag?: string;
  /** Metadata filter: created/modified >= YYYY-MM-DD. */
  since?: string;
  /** Metadata filter: created/modified < YYYY-MM-DD. */
  before?: string;
  /** Result cap for recall/search. */
  limit?: number;
}

/** Context injected by BuiltinToolsManager dispatch from the execution context. */
export interface MemexToolContext {
  userAlias: string;
  agentId?: string;
  chatId: string;
  /** Sub-agents may read memory but must not mutate durable memory. */
  isSubAgent?: boolean;
  /** Agent display name stored as best-effort capture provenance. */
  agentName?: string;
  /** Detailed immutable context required by capture. */
  captureContext?: MemexCaptureSourceContext;
}

export interface MemexToolResult {
  success: boolean;
  operation: string;
  /** Text output for the model on success. */
  output?: string;
  error?: string;
  hint?: string;
  changed?: boolean;
  metadata?: MemexCaptureResult['metadata'];
}

export class MemexMemoryTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'memex_memory',
      description:
        'Your persistent long-term memory (a Zettelkasten of linked markdown cards). ' +
        'By default this reads/writes current-agent memory; set scope to profile-memory for memory shared by every agent in the current profile. ' +
        'Use it to remember durable facts, decisions, and context across conversations. ' +
        'Operations: ' +
        'recall (browse your memory map, keyword-search, or filter past memories by category/tag/date — call this before answering when prior context may help; to browse by category or tag with NO keyword, use recall with the category/tag filter and omit query); ' +
        'search (keyword search; a query is required — for pure category/tag/date browsing with no keyword, use recall instead); ' +
        'capture (save durable memory from existing local evidence; modes: remember, update, correct); ' +
        'read (read one card by slug); ' +
        'links (inspect the link graph for one card, or aggregate stats); ' +
        'organize (report orphans, hubs, and contradictions to maintain memory health); ' +
        'archive (soft-delete an obsolete card by slug).',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: MEMEX_OPERATIONS as unknown as string[],
            description: 'The memory operation to perform.',
          },
          scope: {
            type: 'string',
            enum: MEMEX_MEMORY_SCOPES as unknown as string[],
            description:
              'Memory scope. current-agent is isolated to this agent and is the default. ' +
              'profile-memory is shared across all agents in the current profile.',
          },
          description: {
            type: 'string',
            description: 'A short, human-readable summary of what this memory action is for.',
          },
          query: {
            type: 'string',
            description:
              'Search keywords for recall/search, matched literally (no wildcards — "*" is treated as the literal text, not "match all"). ' +
              'To browse everything or filter only by category/tag/date, use recall and omit query.',
          },
          slug: {
            type: 'string',
            description: 'Card identifier (for capture update/correct, read, links, archive). Lowercase, hyphenated.',
          },
          title: {
            type: 'string',
            description: 'Card title for capture remember, or unique title match for capture update/correct when slug is omitted.',
          },
          body: {
            type: 'string',
            description: 'Distilled memory text for capture. Do not include raw wikilinks or capture-key comments.',
          },
          mode: {
            type: 'string',
            enum: ['remember', 'update', 'correct'],
            description: 'Capture mode. remember creates a new card; update/correct append dated entries.',
          },
          source_type: {
            type: 'string',
            enum: ['chat-session', 'knowledge-file', 'session-deliverable'],
            description: 'Existing local evidence type for capture.',
          },
          source: {
            type: 'string',
            description:
              'Capture evidence path for knowledge-file or session-deliverable. Use absolute path or @knowledge-base:{relative_path} / @chat-session:{relative_path}. Omit for chat-session.',
          },
          source_anchor: {
            type: 'string',
            enum: ['message:user:latest'],
            description: 'Capture anchor for chat-session evidence. Omit or use message:user:latest.',
          },
          profile_intent_quote: {
            type: 'string',
            description: 'Required for profile-memory capture: exact quote from the user message showing profile-level preference, constraint, or correction intent.',
          },
          category: {
            type: 'string',
            description:
              'Category — capture frontmatter value, or exact-match filter for recall/search. ' +
              'To list every card in a category with no keyword, use recall with this filter and omit query.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags to store on the card for capture remember.',
          },
          related_slugs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Validated related card slugs for capture remember. The service generates wikilinks from these.',
          },
          tag: {
            type: 'string',
            description:
              'Single tag to filter by (for recall/search). ' +
              'To list every card with this tag and no keyword, use recall with this filter and omit query.',
          },
          since: {
            type: 'string',
            description: 'Filter: only cards created/modified on or after this date (YYYY-MM-DD).',
          },
          before: {
            type: 'string',
            description: 'Filter: only cards created/modified before this date (YYYY-MM-DD).',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results for recall/search (default 10).',
          },
        },
        required: ['operation', 'description'],
      },
    };
  }

  static async execute(args: MemexMemoryToolArgs, ctx: MemexToolContext): Promise<MemexToolResult> {
    return MemexMemoryTool.executeInternal(args, ctx, { allowCapture: false });
  }

  static async executeDetailed(args: MemexMemoryToolArgs, ctx: MemexToolContext): Promise<MemexToolResult> {
    return MemexMemoryTool.executeInternal(args, ctx, { allowCapture: true });
  }

  private static async executeInternal(
    args: MemexMemoryToolArgs,
    ctx: MemexToolContext,
    options: { allowCapture: boolean },
  ): Promise<MemexToolResult> {
    const operation = String(args.operation || '').trim() as MemexOperation;
    if (!operation || !(MEMEX_OPERATIONS as readonly string[]).includes(operation)) {
      return {
        success: false,
        operation: String(args.operation ?? ''),
        error: `Invalid operation "${args.operation}".`,
        hint: `Valid operations: ${MEMEX_OPERATIONS.join(', ')}.`,
      };
    }

    if (operation === 'capture' && !options.allowCapture) {
      return {
        success: false,
        operation,
        error: 'capture requires the detailed internal execution path.',
      };
    }

    if ((operation === 'capture' || operation === 'archive') && ctx.isSubAgent) {
      return {
        success: false,
        operation,
        error: `Sub-agents can only read memex_memory; operation "${operation}" is not allowed.`,
      };
    }

    const scope = normalizeScope(args.scope);
    if (!scope) {
      return {
        success: false,
        operation,
        error: `Invalid scope "${args.scope}".`,
        hint: `Valid scopes: ${MEMEX_MEMORY_SCOPES.join(', ')}.`,
      };
    }

    if (!ctx.userAlias) {
      return {
        success: false,
        operation,
        error: 'No profile execution context available; cannot resolve memory.',
      };
    }

    if (scope === 'current-agent' && !ctx.agentId) {
      return {
        success: false,
        operation,
        error: 'No agent execution context available; cannot resolve this agent\'s memory.',
      };
    }

    let home: MemexHome;
    try {
      home = scope === 'profile-memory'
        ? buildProfileMemexHome(app.getPath('userData'), ctx.userAlias)
        : buildAgentMemexHome(app.getPath('userData'), ctx.userAlias, ctx.agentId!);
    } catch (e) {
      return { success: false, operation, error: `Failed to open memory: ${errMsg(e)}` };
    }

    try {
      const memexResult = await MemexMemoryTool.dispatch(operation, args, ctx, home);
      // Notify the sidepane after mutations.
      if ((operation === 'capture' && memexResult.changed) || operation === 'archive') {
        emitCardsChanged({
          userAlias: ctx.userAlias,
          scope,
          agentId: scope === 'current-agent' ? ctx.agentId : undefined,
          chatId: ctx.chatId,
        });
      }
      return {
        success: true,
        operation,
        output: memexResult.output,
        changed: memexResult.changed,
        metadata: memexResult.metadata,
      };
    } catch (e) {
      return { success: false, operation, error: errMsg(e) };
    }
  }

  private static async dispatch(
    operation: MemexOperation,
    args: MemexMemoryToolArgs,
    ctx: MemexToolContext,
    home: MemexHome,
  ): Promise<{ output: string; changed?: boolean; metadata?: MemexCaptureResult['metadata'] }> {
    switch (operation) {
      case 'recall':
        return { output: await memexService.recall(home, args.query, normalizeLimit(args.limit), buildFilter(args)) };
      case 'search':
        return { output: await memexService.search(home, requireField(args.query, 'query', 'search'), normalizeLimit(args.limit), buildFilter(args)) };
      case 'capture': {
        if (!ctx.captureContext) {
          throw new Error('capture requires detailed source context.');
        }
        const result = await memexService.capture(home, {
          mode: args.mode,
          scope: normalizeScope(args.scope) ?? 'current-agent',
          slug: args.slug,
          title: args.title,
          body: args.body,
          category: args.category,
          tags: args.tags,
          source_type: args.source_type,
          source: args.source,
          source_anchor: args.source_anchor,
          profile_intent_quote: args.profile_intent_quote,
          related_slugs: args.related_slugs,
        }, ctx.captureContext);
        return { output: result.output, changed: result.changed, metadata: result.metadata };
      }
      case 'read':
        return { output: await memexService.read(home, requireField(args.slug, 'slug', 'read')) };
      case 'links':
        return { output: await memexService.links(home, args.slug) };
      case 'organize':
        return { output: await memexService.organize(home) };
      case 'archive':
        return { output: await memexService.archive(home, requireField(args.slug, 'slug', 'archive')), changed: true };
    }
  }
}

// ---- helpers ----

function buildFilter(args: MemexMemoryToolArgs): ManifestFilter | undefined {
  const filter: ManifestFilter = {};
  if (args.category?.trim()) filter.category = args.category.trim();
  if (args.tag?.trim()) filter.tag = args.tag.trim();
  if (args.since?.trim()) filter.since = args.since.trim();
  if (args.before?.trim()) filter.before = args.before.trim();
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function normalizeScope(scope?: string): MemexMemoryScope | null {
  const trimmed = scope?.trim();
  if (!trimmed) return 'current-agent';
  return (MEMEX_MEMORY_SCOPES as readonly string[]).includes(trimmed)
    ? (trimmed as MemexMemoryScope)
    : null;
}

function normalizeLimit(limit?: number): number | undefined {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return undefined;
  return Math.floor(limit);
}

function requireField(value: string | undefined, field: string, operation: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Operation "${operation}" requires "${field}".`);
  return trimmed;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
