<!-- Last verified: 2026-03-25 -->
# Workspace System

> Provides high-performance file tree enumeration, content search, and real-time file-change watching for the active workspace directory.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `FileTreeService.ts` | Enumerates file tree using `ripgrep --files`; stream-processes output to avoid memory overflow on large workspaces; includes metadata (size, mtime) | large |
| `RipgrepSearchEngine.ts` | Content-search engine using `@vscode/ripgrep` binary; VSCode-level fuzzy scoring and ranking; primary search path | large |
| `SearchService.ts` | Unified `ISearchEngine` interface; routes queries to `RipgrepSearchEngine` with `NodeFSSearchEngine` as fallback | medium |
| `NodeFSSearchEngine.ts` | Pure Node.js fallback search (recursive `fs.readdir`); used when ripgrep binary is unavailable | medium |
| `WorkspaceWatcher.ts` | Chokidar-based file system watcher; emits typed `IFileChange` events (`ADDED`, `UPDATED`, `DELETED`) | small |
| `FileSystemWatcher.ts` | Lower-level watcher abstraction over WorkspaceWatcher | small |
| `fuzzyScorer.ts` | VSCode-ported fuzzy match algorithm (`prepareQuery`, `compareItemsByFuzzyScore`, `FuzzyScorerCache`); used by `RipgrepSearchEngine` for result ranking | large |
| `FileIndexCache.ts` | **Deprecated** — `@deprecated` tag in source; do not use; ripgrep search replaced it | — |

## Architecture
- `FileTreeService` and `RipgrepSearchEngine` both locate the `rg` binary by first calling `require('@vscode/ripgrep').rgPath`, then falling back through a list of candidate paths (dev `node_modules`, `app.asar.unpacked`, `process.resourcesPath`). Both files duplicate this resolution logic — a known inconsistency.
- **ripgrep is unpacked from asar** (`electron-builder.config.js` `asarUnpack: ['**/node_modules/@vscode/ripgrep/**']`). If this entry is ever removed, workspace search silently degrades to the Node.js fallback.
- Workspace root defaults to the user's home directory (`os.homedir()`) when no workspace is configured in the profile. File operations are security-scoped to this root by `SecurityValidator`.
- `fuzzyScorer.ts` is a direct port from VSCode's internal scorer — do not refactor it against a linter; it is intentionally kept close to the upstream source for easier diff-tracking.
- `FileIndexCache` is still imported nowhere meaningful; leave it as-is (already deprecated).

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change default workspace root | `ProfileCacheManager` or the IPC handler that resolves workspace path | `FileTreeService`/`SearchService` are passed the root at call time |
| Add a new file search filter | `RipgrepSearchEngine.ts` | Append ripgrep flags to the `spawn` args array |
| Handle ripgrep binary in a new environment | Both `FileTreeService.ts` and `RipgrepSearchEngine.ts` | Both have their own `getRipgrepPath()` — keep them in sync |
| Watch additional event types | `WorkspaceWatcher.ts` | Extend `FileChangeType` enum and chokidar event bindings |
| Improve fuzzy ranking | `fuzzyScorer.ts` | Consider pulling latest from VSCode upstream instead of modifying locally |

## Gotchas
- ⚠️ `FileIndexCache.ts` is marked `@deprecated` but still present in the directory — it is NOT used by any active code path. Do not wire it up.
- ⚠️ `getRipgrepPath()` is copy-pasted between `FileTreeService.ts` and `RipgrepSearchEngine.ts`. Changes to binary path resolution must be applied in both files.
- ⚠️ Workspace search results flow to the MCP built-in `search_files` and `search_text_in_files` tools; those tools also have their own path-validation via `SecurityValidator`. Keep workspace root consistent between both systems.
- ⚠️ `chokidar` is a devDependency — verify it is included in production builds before shipping workspace watcher features.

## Related
- Depends on: `@vscode/ripgrep` (must be in `dependencies`, not `devDependencies`), `chokidar`, `fs/promises`
- Depended by: [Chat Engine](../chat/ai.prompt.md) (context mentions, workspace file browsing), MCP built-in tools (`search_files`, `search_text_in_files`, `read_file`), renderer `FileTreeExplorer` component
