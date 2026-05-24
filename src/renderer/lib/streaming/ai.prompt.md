<!-- Last verified: 2026-03-25 -->
# Streaming Lib

> Configuration, device-adaptive optimization, and performance monitoring for the LLM streaming typewriter renderer — the config/monitoring layer that backs `StreamingV2Message`.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `streamingConfig.ts` | `StreamingConfigManager` singleton: global + per-agent config for batch size, delay, FPS target, adaptive throttling, cursor style, auto-scroll threshold; `StreamingConfigValidator` for bounds checking; exports `streamingConfigManager` | ~359 LOC |
| `streamingOptimizer.ts` | `StreamingOptimizer` singleton: detects device CPU/memory on first init, selects `fast`/`balanced`/`smooth` perf mode, provides per-text config (larger batches for long text and code); exports `streamingOptimizer` | ~311 LOC |
| `performanceMonitor.ts` | `StreamingPerformanceMonitor` singleton: tracks render time, FPS, memory delta, and chars/second during an active stream; raises typed `PerformanceAlert`s and generates a scored report; exports `streamingPerformanceMonitor` | ~441 LOC |
| `compatibilityLayer.ts` | `StreamingCompatibilityLayer` singleton: initializes optimizer, detects user customizations, provides `getCompatibleConfig()` with legacy/enhanced/auto mode switching and fallback path; exports `streamingCompatibility`, auto-inits on `requestAnimationFrame` | ~280 LOC |
| `index.ts` | Re-exports all four singletons and types | — |

## Architecture

All four files export module-level singletons initialized at import time (or on first `requestAnimationFrame` / `setTimeout` for optimizer and compatibility layer, to avoid blocking page load).

`streamingConfigManager` is the central authority. `streamingOptimizer` detects device capability once and converts it into a `StreamingOptimizationConfig`; `streamingCompatibility` wraps the optimizer and provides a single `getCompatibleConfig(text)` call that `StreamingV2Message` (in `src/renderer/components/streaming/`) consults before each render pass.

`streamingPerformanceMonitor` is opt-in: call `startMonitoring()` before a stream and `stopMonitoring()` after to collect a session snapshot. It is not called automatically by the renderer; callers are responsible for lifecycle.

Default performance profile targets maximum throughput: `batchSize=10`, `batchDelay=5ms`, `targetFPS=120`, adaptive throttling disabled, no cursor animation, `renderingMode='immediate'`. The adaptive memory check runs every 10 s and silently adjusts buffer/batch sizes when JS heap exceeds 85 % or drops below 30 %.

The actual rendering (RAF typewriter loop, auto-scroll) lives in `src/renderer/components/streaming/`, not here.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Tune default throughput (batch size, delay) | `streamingConfig.ts` — `DEFAULT_STREAMING_V2_CONFIG` / `DEFAULT_PERFORMANCE_CONFIG` | Changes apply globally; per-agent overrides can be set via `streamingConfigManager.updateAgentConfig()` |
| Change auto-scroll threshold | `streamingConfig.ts` — `DEFAULT_UI_CONFIG.autoScrollThreshold` | Default is 150 px from bottom; also used by `StreamingScrollManager` in the rendering layer |
| Adjust device-tier speed profiles | `streamingOptimizer.ts` — `getOptimalConfigForDevice()` | Low-end / mid / high-end branches; affects `baseDelay` and `maxBatchSize` |
| Add a new performance metric | `performanceMonitor.ts` — extend `PerformanceMetrics`, update `getMetrics()` and `generateReport()` | Keep the rolling-window arrays bounded (current cap: 100 renders, 60 frames) |

## Gotchas

- Do not confuse this directory (`src/renderer/lib/streaming/`) with `src/renderer/components/streaming/`. This directory is **config + monitoring**; the components directory is the actual **rendering implementation** (`StreamingV2Message` with the RAF typewriter, `StreamingScrollManager`).
- `streamingOptimizer.initialize()` runs a CPU microbenchmark (`Math.sin/cos/sqrt` loop) in a `setTimeout` 1 s after page load. In test environments without `window`, the auto-init guard (`typeof window !== 'undefined'`) prevents it from running.
- `StreamingConfigManager` intentionally does not persist to `localStorage`; config resets to defaults on every app launch. Per-agent configs are in-memory only for the session.
- Config listeners registered via `addConfigListener()` are only notified on explicit `updateGlobalConfig()` calls, not on the silent adaptive-memory adjustments — by design to avoid cascade re-renders.

## Related

- Depended on by [Chat UI](../../components/chat/ai.prompt.md) (consulted by `StreamingV2Message` for per-text config)
- Rendering layer: `src/renderer/components/streaming/StreamingV2Message.tsx` (RAF typewriter, 8 chars/frame text, 1 char/frame punctuation) and `StreamingScrollManager.tsx` (VSCode-style smart scroll)
- Works with [Chat Engine](../../../main/lib/chat/ai.prompt.md) indirectly via IPC streaming chunks forwarded through `AgentChatIpc` → `AgentChatSessionCacheManager`
