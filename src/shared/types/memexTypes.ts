/**
 * Shared memex DTOs — produced by the main-process MemexService and consumed by
 * the renderer memory sidepane and Settings profile-memory manager via IPC. Kept
 * free of any main/renderer-only imports so both processes can depend on this
 * single source of truth.
 */

export type MemexMemoryScope = 'current-agent' | 'profile-memory';

export type MemexMemoryTarget =
  | { scope?: 'current-agent'; chatId: string }
  | { scope: 'profile-memory' };

/** One-line summary of a card, used for the sidepane list. */
export interface CardSummary {
  slug: string;
  title: string;
  category?: string;
  /** YYYY-MM-DD, when known. */
  created?: string;
  /** YYYY-MM-DD, when known. */
  modified?: string;
  /** Current frontmatter status when present. Inactive statuses are filtered out. */
  status?: string;
  /** Warning for current-but-disputed statuses such as conflict. */
  warning?: string;
  /** First paragraph, whitespace-collapsed and truncated. */
  excerpt: string;
}

/** Full card detail, used for sidepane and Settings detail views. */
export interface CardDetail {
  slug: string;
  title: string;
  category?: string;
  created?: string;
  modified?: string;
  source?: string;
  tags?: string[];
  status?: string;
  /** Body markdown with the YAML frontmatter stripped. */
  content: string;
  /** Full raw card markdown, including YAML frontmatter, for read-only Markdown previews. */
  rawContent?: string;
  /** Navigable wikilink targets this card points to, resolved to known card slugs only. */
  outbound: string[];
  /** Raw wikilink target text mapped to the resolved known card slug. */
  resolvedWikilinks?: Record<string, string>;
  /** Slugs that link to this card. */
  inbound: string[];
}

export interface MemexGraphNode {
  slug: string;
  title: string;
  /** Number of outbound edges to known cards. */
  outbound: number;
  /** Number of inbound edges from known cards. */
  inbound: number;
  /** No inbound links. */
  isOrphan: boolean;
  /** Inbound link count >= hub threshold. */
  isHub: boolean;
}

export interface MemexGraphEdge {
  from: string;
  to: string;
}

/** Link graph for the sidepane graph view. */
export interface MemexGraph {
  nodes: MemexGraphNode[];
  edges: MemexGraphEdge[];
  orphans: string[];
  hubs: string[];
}
