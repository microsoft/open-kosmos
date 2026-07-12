# Postmortem: Bing image/web search returns irrelevant or zero aggregated results

**Date:** 2026-06-18 | **Severity:** P2 (built-in search quality; no crash) | **Affected:** `bing_image_search` and `bing_web_search` built-in tools whenever the model issues more than one query in a single call

## Symptom
Searching images for a Chinese prompt meaning "Freedom Gundam" through the chat agent returned results that were wildly off-topic compared to running the same search in a browser. In one real session the model expanded the prompt into several reasonable queries (`Freedom Gundam images`, `ZGMF-X10A Freedom Gundam`, `Chinese-language Freedom Gundam images`, ...), yet the **aggregated** output contained **zero** Freedom Gundam images - instead it returned Cristiano Ronaldo wallpapers, Norway rugby jerseys, Japanese sticky notes, and interior-design pages.

A second prompt that produced a single clean Chinese-language Freedom Gundam query returned correct results. The difference was not the query text - it was **how many queries ran in one tool call**.

## Investigation (real evidence)
Source session: `chatSession_20260618132748_...44uny0h08.json`. Per-call result grouping by `query`:

| Call | Queries in the call | Result distribution |
|------|--------------------|---------------------|
| [5]  | `Freedom Gundam images`, `Chinese-language Freedom Gundam images` | one query got 8 results (all Ronaldo), the other got **1** junk result |
| [7]  | `ZGMF-X10A Freedom Gundam`, `Japanese-language Freedom Gundam ZGMF-X10A`, `Chinese-language Freedom Gundam ZGMF-X10A` | one query got 8 (all Norway jerseys), the other two got **1** junk each |
| [18] | `Chinese-language Freedom Gundam`, `Chinese-language Freedom Gundam images`, `ZGMF-X10A Chinese-language Freedom Gundam` | the bare Chinese-language Freedom Gundam query got 10 correct results; the other two got **1** junk each |

Two facts fall out of this data:
1. In **every** multi-query call, exactly **one** query returned a full grid (~8-10) and the remaining queries each returned **1** result. That is the signature of contention, not of bad query text.
2. The **same** Chinese-language query string for Freedom Gundam images returned junk in call [5] and junk again in call [18], while the bare Chinese-language Freedom Gundam query returned a perfect grid. Same query, different outcome across runs => a race, not the query.

A standalone single-query replica (`scripts/debug-bing-image-search.js`) consistently returned correct results, because it runs one query, one browser, no shared state.

## Root Cause
Both tools shipped the same copy-pasted execution model with three compounding defects:

1. **Unbounded parallelism.** `execute()` ran every query at once via `args.queries.map(async ... performSingle...)` + `Promise.allSettled` (image `~410/438`, web `~342/369`). With the model routinely emitting 2-3 queries (cap is 10), 2-3 full headless Chromium instances hit Bing simultaneously from the same IP, triggering anti-bot **degraded/generic pages** for the losers — hence whole-but-off-topic result sets.

2. **A single shared, hardcoded browser-state file.** Every parallel query read and wrote the *same* path: `os.tmpdir()/openkosmos-bing-image-browser-state.json` (web: `openkosmos-bing-browser-state.json`). The load path even **deletes** the file when it parses as invalid JSON (image `~360-371`). With several queries reading/writing/deleting the one file concurrently, contexts loaded torn cookies/storageState and clobbered each other — the losers fell through to a near-empty page that the parser scraped for a single stray thumbnail.

3. **Persisted cookies polluted ranking.** Even without the race, reusing one cross-query session injected personalization into a context where a fresh anonymous session demonstrably ranks better (the debug script and the single-query call both prove fresh sessions return the right images).

The "one query wins, the rest get exactly 1 result" pattern is the direct fingerprint of defects 1+2.

## Optimal Fix
Rewrite the execution model in both tools so queries are isolated and de-bursted:

1. **One shared browser per tool call.** Launch a single headless Chromium once in `execute()`, reuse it for all queries, close it once at the end. (Was: one full browser launched per query.)
2. **A fresh, isolated `browser.newContext()` per query, with no `storageState`.** Each query gets clean cookies; queries can no longer cross-contaminate.
3. **Delete the shared state-file mechanism entirely.** No load, no write-back, no `unlinkSync`. Fingerprint (locale/timezone/device) is still generated per context via `getHostMachineConfig()` for anti-detection, but nothing is persisted to disk. This removes the read/write/delete race **and** the cookie-pollution source in one move.
4. **Bounded concurrency = 2.** Queries run through a tiny inline concurrency pool (no new dependency) capped at 2 in-flight, which removes the same-IP burst that triggered anti-bot degradation while keeping latency reasonable (10 queries → 5 waves).
5. **Retry once on a degraded page.** If a query parses 0 results, or 1 result when `maxResults` allows more, retry it once in a fresh context and keep the better attempt. This self-heals the occasional degraded page instead of emitting a single junk row while avoiding needless retries for intentional `maxResults: 1` calls.

### Why not the cheaper alternatives
- **Per-query state file (`...-<index>.json`)** removes the file race but *keeps* cookie-pollution and adds more disk I/O and cleanup. We proved fresh anonymous sessions rank better, so persistence has no upside here.
- **Just lower concurrency to 1** (full serialize) is safe but worst-case ~10×latency for a 10-query call. The pool of 2 keeps isolation while bounding wall-clock time.
- **Sharing one browser alone (#3)** fixes resource cost but not the state-file race or the cookie pollution; it is necessary but not sufficient.

## Note on query expansion (separate, not the root cause)
The model's expansion of an unquoted prompt into translated/extended queries is *not* the bug - those queries return correct images in a browser. Quoting the exact Chinese phrase for Freedom Gundam nudged the model toward a single literal query, which is why turn 2 looked better. The tool schema still invites many parallel variants; tightening that guidance is a possible follow-up but is orthogonal to this fix.

## Verification
- Unit tests assert: bounded concurrency (limit clamped, order preserved), retry-once on degraded pages without retrying successful `maxResults: 1` calls, per-query error isolation, single shared-browser close, and no state-file writes.
- `npm run typecheck`, `npm test` (bing suites), `npm run build:vite`, and the per-file coverage gate (`node scripts/check-coverage.js`) all pass for both changed files.

## Lessons
1. **Fan-out over a shared external resource needs both isolation and a concurrency bound.** Unbounded `Promise.all` over N browser sessions that share one state file is a race factory.
2. **Don't persist global mutable state under a fixed temp path for concurrent callers.** If state must be shared, key it per unit of work; better yet, prove you need persistence at all.
3. **A "one winner, the rest return exactly 1" result shape is a contention signature** — reach for that hypothesis before blaming inputs.
