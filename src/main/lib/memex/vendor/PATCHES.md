# Vendored memex — patch log

This directory contains source vendored from **[iamtouchskyer/memex](https://github.com/iamtouchskyer/memex)** (MIT),
upstream branch `main` (snapshot taken at upstream package version `0.3.2`).

We call this code **natively** from the main process instead of running the `memex`
CLI / stdio MCP server. Upgrades are done by **manual pump-and-merge** from upstream.

## Directory layout
Upstream's `lib/` + `commands/` split is **preserved** (`vendor/lib/*`, `vendor/commands/*`)
so the relative import specifiers inside vendored files stay byte-identical to upstream
(only the `.js` extension and the `sensitive-input` filename differ). This keeps merges cheap.

## Pump-and-merge procedure
1. Diff the upstream file against the vendored copy.
2. Re-apply the patches below (keep them minimal so merges stay cheap).
3. Update the snapshot version noted above.
4. Run `npm run typecheck` + the memex unit tests.

## Files vendored (verbatim unless a patch is listed)

| Vendored file | Upstream path | Patch |
|---|---|---|
| `store.ts` | `src/lib/store.ts` | imports rewritten extensionless only |
| `scan.ts` | `src/lib/scan.ts` | imports rewritten extensionless only |
| `scoring.ts` | `src/lib/scoring.ts` | imports rewritten extensionless only |
| `formatter.ts` | `src/lib/formatter.ts` | **P5: Chinese match label → English** |
| `sensitiveInput.ts` | `src/lib/sensitive-input.ts` | **renamed** to camelCase; imports updated |
| `parser.ts` | `src/lib/parser.ts` | **P1: gray-matter → js-yaml** |
| `config.ts` | `src/lib/config.ts` | **P2: unused embedding-provider fields removed** |
| `commands/search.ts` | `src/commands/search.ts` | **P3: semantic search + embeddings removed** |
| `commands/read.ts` | `src/commands/read.ts` | imports rewritten extensionless only |
| `commands/write.ts` | `src/commands/write.ts` | imports rewritten extensionless only |
| `commands/links.ts` | `src/commands/links.ts` | imports rewritten extensionless only |
| `commands/organize.ts` | `src/commands/organize.ts` | imports rewritten extensionless only; **P6: v8-ignore on dead branches** |
| `commands/archive.ts` | `src/commands/archive.ts` | **P4: autoSync() call removed** |

## Files intentionally NOT vendored
`lib/embeddings.ts`, `lib/sync.ts`, `lib/hooks.ts`, `mcp/*`, `cli.ts`,
upstream service and maintenance commands, `importers/*`,
`share-card/*` — these implement semantic search, git sync, the MCP server, the CLI,
and the web UI, none of which are used in the native integration.

## Patch details

### P0 — Module style (all files)
Upstream uses ESM with explicit `.js` import specifiers and `sensitive-input` kebab name.
OpenKosmos main uses `moduleResolution: "bundler"` with **extensionless** imports.
All relative import specifiers had `.js` stripped; `sensitive-input` → `sensitiveInput`.

### P1 — `parser.ts`: gray-matter → js-yaml
Upstream depends on `gray-matter`. To avoid adding an npm dependency (CLAUDE.md:
"No new npm dependencies without checking"), `parseFrontmatter()` was reimplemented
with `js-yaml` (already a OpenKosmos dependency) + a regex to split the `---` frontmatter
block. The `import * as yaml from "js-yaml"` line carries a `// @ts-ignore` (js-yaml
ships no bundled types; this matches `skillManager.ts`).
The original try/catch fallback (on YAML parse failure, treat whole file as
content with empty metadata) is preserved. `stringifyFrontmatter()` and `extractLinks()`
are upstream-verbatim (they never used gray-matter).

### P2 — `config.ts`: embedding config removed
Removed all remote and local embedding-provider configuration fields, the `EmbeddingProviderType` import,
and `isValidProvider()`. Kept `nestedSlugs`, `searchDirs`, `extraLinkDirs`,
`experimental`. `resolveMemexHome()` / `warnIfEmptyCards()` kept verbatim (unused by the
service but harmless; the service passes an explicit home).

### P3 — `commands/search.ts`: semantic search removed
Removed the `embeddings` import block, the `semantic` / `_embeddingProvider` options,
the `if (query && options.semantic)` dispatch, and the `semanticSearch()`,
`computeKeywordScores()`, `groupByStore()` helpers. Keyword (lexical) search via
`scoring.ts` is unchanged. The "--semantic" guidance line was dropped.

### P4 — `commands/archive.ts`: autoSync removed
Removed `import { autoSync }` and the `await autoSync(...)` call after `archiveCard`.
Archiving is now a pure local file move.

### P5 — `formatter.ts`: Chinese match label → English
Upstream emitted a Chinese-language match-label prefix (meaning "Match:") for the
search match line. OpenKosmos is English-only (CLAUDE.md), so `formatSearchResult()`
now emits `> Match:`.

### P6 — `commands/organize.ts`: v8-ignore on provably-dead branches
`organize.ts` reaches 100% lines / 100% functions / 98.78% statements under the unit
tests, but three sets of defensive fallbacks are unreachable from any test and capped
branch coverage at 87.7% (below the 90% per-file gate):

- `outboundMap.get(card.slug) || []` and `inboundMap.get(card.slug) || []` — both Maps
  are populated for every `card.slug` in loops immediately above, so `|| []` never fires.
- `if (!info) continue` in the recent-pairs loop — `info` comes from `cardData`, which has
  an entry for every card slug; it is never `undefined` here.
- `cardData.get(x)?.title ?? x` in the JSON output — `title` is always
  `String(data.title || slug)` (a non-empty string), so the `?? slug` arm is dead.

Per CLAUDE.md "Test Coverage Requirements", provably-unreachable lines get a surgical
`/* v8 ignore next */` (matching `src/shared/resolveable-promise.ts`), **not** an
allowlist entry — every reachable branch in the file remains fully gated. All other
vendored files reach ≥ 90% on all four metrics through real tests with no ignores.
