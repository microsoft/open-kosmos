<!-- Last verified: 2026-07-11 -->
# LLM Integration

> Provides model API adapters and LLM-powered utility services (title generation, file naming, MCP config formatting, system prompt writing, embeddings).

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `ghcModelApi.ts` | `GhcModelApi` — primary provider; single-call wrapper over GitHub Copilot `/chat/completions`; `getEndpointForModel()` selects `/chat/completions` vs `/v1/messages` based on model capabilities | medium |
| `ghcModelsManager.ts` | Model registry (local-cache-first init, background remote refresh with Claude integrity check), capability lookups (`getModelById`, supported endpoints, context window sizes) | ~large |
| `mcpConfigLlmFormatter.ts` | `McpConfigLlmFormatter` — parses natural language or ad-hoc JSON into a standard MCP server config object via LLM | medium |
| `systemPromptLlmWritter.ts` | `SystemPromptLlmWriter` — direct system-prompt polish flow that preserves user intent, uses prompt-file-aware guidance for Agent Identity vs Project Context, returns polished prompt + change summary, and rejects unusable drafts | medium |
| `chatSessionTitleLlmSummarizer.ts` | Auto-generates chat session titles from first exchange | small |
| `fileNameLlmGenerator.ts` | AI-generated file names for downloads | small |
| `documentSummaryLlmGenerator.ts` | Summarizes document content for context injection | small |
| `contextCompressionLlmSummarizer.ts` | Dedicated compression-summary helper with fixed model, system prompt, summary template, output language, and prompt-overhead calculation | small |
| `textLlmEmbedder.ts` | `TextLlmEmbedder` — generic text-embedding adapter (GHC `text-embedding-3-small`, 1536 dims); exposed via `llm:embedText` / `llm:embedBatch` IPC | small |
| `index.ts` | Re-exports; also exports a singleton `ghcModelApi` instance | tiny |

## Architecture
- **Primary provider**: `GhcModelApi` calls GitHub Copilot's API using the session token obtained from `MainAuthManager`. It is NOT built on Vercel AI SDK — it issues raw `fetch` calls.
- **Streaming** in the main `AgentChat` uses Vercel AI SDK 5.x directly with provider-specific adapters (openai-compatible, google-generative-ai, cohere, ollama). `GhcModelApi` is a non-streaming single-call utility.
- **Endpoint selection**: `getEndpointForModel()` in `ghcModelApi.ts` prefers `/chat/completions` (OpenAI-compatible) over `/v1/messages` (Anthropic native) to avoid `tool_choice` structure differences.
- **LLM utility classes** (`McpConfigLlmFormatter`, `SystemPromptLlmWriter`, `chatSessionTitleLlmSummarizer`, `contextCompressionLlmSummarizer`) all use `ghcModelApi` internally — they are stateless and do not share instances.
- **System prompt polish targets**: `SystemPromptLlmWriter.improveSystemPrompt(prompt, { promptFile })` defaults to `Base.md` / Agent Identity. `Base.md` polish may improve role, expertise, behavior, tone, boundaries, and safety rules but must not invent project/domain context. `AGENTS.md` polish may improve project/domain context, workflow, rules, constraints, terminology, and gotchas but must not invent facts or add generic persona rules.
- **Compression summary specialization**: `contextCompressionLlmSummarizer.ts` owns the compression-specific system prompt, structured summary template, output language, and prompt-overhead calculation. Its overhead must reflect the real `ghcModelApi.callModel(...)` request shape, including both the system message and the generated user prompt. Callers should pass only the conversation text plus retry budget.
- **Reasoning effort capability**: `getModelCapabilities()` exposes `reasoningEfforts?: string[]` derived from the Copilot `/models` `capabilities.supports.reasoning_effort` array, normalized to lowercase and deduped by `normalizeReasoningEfforts()`. `supportsReasoning` is now `true` whenever any tier is advertised (in addition to the legacy `o3`/`o4` family detection), and `isReasoningModel()` delegates to `supportsReasoning` so both signals stay aligned. Request shaping is performed by `buildReasoningParams({ endpoint, supportedEfforts, reasoningEffort, defaultEffort })`, which produces the OpenAI flat form `{ reasoning_effort }` for `/chat/completions` and the nested form `{ reasoning: { effort } }` for `/responses`; when `reasoningEffort` is omitted (user didn't pick), `defaultEffort` (from `getDefaultReasoningEffort()`) is used so an explicit tier is always sent for models that support reasoning. `getDefaultReasoningEffort(modelId, supportedEfforts)` implements the vendor-aware heuristic: Claude→high, GPT/others→medium. An unsupported or capability-gated tier yields `{}`. New tiers (e.g. `minimal`, `xhigh`) are passed through verbatim — do not whitelist tier names.
- **Compression model — `claude-haiku-4.5`**: Tokenizer `o200k_base`; `max_prompt_tokens` = 128K; `max_non_streaming_output_tokens` = 16K (used as `MAX_TOKENS`); `max_context_window_tokens` = 200K. The `FullModeCompressor` uses `summaryPromptTokenBudget = 100K` (28K safety margin against the 128K prompt limit). The compressor's `TokenCounter` must use `o200k_base` encoding to match the API's actual tokenizer — using `cl100k_base` would underestimate by ~42% and risk exceeding the API limit.
- **Model picker list**: `GhcModelsManager.getAllOpenKosmosUsedModels()` dynamically filters the Copilot `/models` response instead of maintaining a static picker list. The picker includes chat models with `model_picker_enabled === true`, then matches Claude mythos/fable 5+ and Claude opus/sonnet 4+, Gemini pro 2.5+, and GPT 5.1+; lightweight variants (`mini`, `flash`, `haiku`) are excluded. Picker order is Claude → Gemini → GPT; within Claude, family order is mythos → fable → opus → sonnet, then ID descending inside the same family.
- Model configurations (provider, model ID, API key, endpoint) are stored per-profile in `profile.json` and managed by `ProfileCacheManager`. The LLM layer reads them at call time, not at startup.
- Multiple provider support (OpenAI-compatible APIs, Gemini, Claude, Cohere, and Ollama) is handled in `AgentChat` via Vercel AI SDK factory functions; the files here cover GitHub Copilot-backed utility calls only.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Change which Copilot models appear in the picker | `ghcModelsManager.ts` | Update `OPENKOSMOS_MODEL_PATTERNS` and sorting rules; the source list still comes from Copilot `/models` |
| Point utility LLMs at a different model | `ghcModelApi.ts` constructor (`this.currentModel`) or callers | Default is `gpt-4.1` |
| Add a new LLM-powered utility | Create new file, import `ghcModelApi` singleton from `index.ts` | Follow pattern of `mcpConfigLlmFormatter.ts` |
| Change compression-summary wording, language, or prompt shape | `contextCompressionLlmSummarizer.ts` | Keep `FullModeCompressor` free of helper-specific prompt configuration |
| Change MCP config parsing system prompt | `mcpConfigLlmFormatter.ts` (`SYSTEM_PROMPT` static field) | Hard-coded template |
| Change system prompt writer behavior | `systemPromptLlmWritter.ts` (`SYSTEM_PROMPT` static field plus prompt-file instructions) | Keep it as a direct polish flow; preserve Agent Identity vs Project Context boundaries and do not reintroduce role-description expansion unless the product requirement changes |

## Gotchas
- ⚠️ `ghcModelsManager.initialize(alias)` returns after loading the local cache only — the remote refresh runs in the background. Callers that `await initialize()` must NOT assume the model list is up-to-date from the remote; it may still be the locally cached version. Use `ensureModelsReady()` in IPC handlers to wait for initialization (with timeout), but note that even after it resolves the cache may contain only local data if the remote fetch failed or is still in progress.
- ⚠️ `refreshFromRemote()` has an integrity check: if the remote list is missing Claude models but the local cache has them, the update is rejected to prevent model loss in network-restricted environments (e.g., no VPN). This means the local cache file will NOT be updated in that scenario.
- ⚠️ The file is `systemPromptLlmWritter.ts` (double-t) — this typo is in the source and must be preserved when referencing it.
- ⚠️ `SystemPromptLlmWriter` is intended to polish an existing system prompt draft, not invent a new prompt from a role label. Its file-aware modes must preserve the user's facts and the boundary between Agent Identity (`Base.md`) and Project Context (`AGENTS.md`).
- ⚠️ `GhcModelApi` does NOT use Vercel AI SDK. It issues plain `fetch` calls and returns `Promise<string>`. Do not expect streaming responses from it.
- ⚠️ The `McpConfigLlmFormatter` system prompt instructs the model to return pure JSON with no markdown fences. Parsing failures are surfaced via `rawResponse` in the result object.
- ⚠️ The `McpConfigLlmFormatter` schema for `sse` / `StreamableHttp` transports now includes a `headers` object alongside `env`. Use `headers` for HTTP headers like `x-apikey` or `Authorization: Bearer …`; reserve `env` for actual environment variables. The example block and the per-server-name format rules both reflect this — keep them in sync if you change one.

## Related
- Depends on: [Auth](../auth/ai.prompt.md) (session token via `MainAuthManager`), `ghcModelsManager.ts` (model capability lookup)
- Depended by: [Chat Engine](../chat/ai.prompt.md), [Sub-Agent](../subAgent/ai.prompt.md), [Context Compression](../compression/), main.ts utility IPC handlers
