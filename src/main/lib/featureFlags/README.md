# Feature Flags Management System

## Overview

Feature Flags are developer tools used to control feature availability. Flag states are defined by developers in the backend, or passed via command-line arguments.

## Naming Convention

All feature flags use the unified `openkosmosFeatureXXXXX` naming format:

```typescript
'openkosmosFeatureDevTools'
'openkosmosFeatureDebugLogging'
'openkosmosFeatureExperimentalChat'
```

## Defining Feature Flag Default Values

### 1. Static Boolean

```typescript
{
  name: 'openkosmosFeatureDevTools',
  description: 'Developer tools panel',
  defaultValue: false,  // static value
},
```

### 2. Dynamic Logic Function

Dynamically computed based on context (dev environment, brand, platform):

```typescript
{
  name: 'openkosmosFeatureDebugLogging',
  description: 'Debug logging',
  // Enable only in development environment
  defaultValue: (ctx) => ctx.isDev,
},

{
  name: 'openkosmosFeatureExperimentalChat',
  description: 'Experimental chat feature',
  // Enable only in dev environment
  defaultValue: (ctx) => ctx.isDev && ctx.brandName === 'openkosmos',
},
```

### Context (FeatureFlagContext) Fields:

| Property | Type | Description |
|----------|------|-------------|
| `isDev` | boolean | Whether running in a development environment |
| `brandName` | string | Current brand name (e.g. `openkosmos`) |
| `platform` | NodeJS.Platform | Platform (darwin, win32, linux) |

## Command-Line Overrides

Command-line arguments take precedence over default values:

```bash
# Windows
app.exe --enable-features=openkosmosFeatureDevTools,openkosmosFeatureDebugLogging

# macOS
./KOSMOS.app/Contents/MacOS/KOSMOS --enable-features=openkosmosFeatureDevTools

# Development environment
npm run dev -- --enable-features=openkosmosFeatureDevTools,openkosmosFeatureMcpDebug
```

## Using Flags in Code

### Main Process

```typescript
import { isFeatureEnabled } from './lib/featureFlags';

if (isFeatureEnabled('openkosmosFeatureDevTools')) {
  // Enable developer tools functionality
}
```

### Renderer Process (React)

```tsx
import { useFeatureFlag } from '../lib/featureFlags';

function MyComponent() {
  const isDevToolsEnabled = useFeatureFlag('openkosmosFeatureDevTools');

  if (!isDevToolsEnabled) return null;

  return <DevToolsPanel />;
}
```

## Adding a New Flag

### 1. Add the type in `types.ts`

```typescript
export type FeatureFlagName =
  | 'openkosmosFeatureDevTools'
  | 'openkosmosFeatureMyNewFeature'  // add new name
  ;
```

### 2. Add the definition in `featureFlagDefinitions.ts`

```typescript
{
  name: 'openkosmosFeatureMyNewFeature',
  description: 'My new feature',
  defaultValue: false,  // or use (ctx) => ctx.isDev to restrict to dev only
},
```

## Defined Flags

| Flag | Description | Default |
|------|-------------|---------|
| `openkosmosFeatureDevTools` | Developer tools | `false` |
| `openkosmosFeatureDebugLogging` | Debug logging | `(ctx) => ctx.isDev` |
| `openkosmosFeaturePerformanceMetrics` | Performance metrics | `false` |
| `openkosmosFeatureExperimentalChat` | Experimental chat | `(ctx) => ctx.isDev && brandName=kosmos` |
| `openkosmosFeatureNewModelSelector` | New model selector | `false` |
| `openkosmosFeatureMemoryV2` | Memory V2 | `false` |
| `openkosmosFeatureMockApi` | Mock API | `(ctx) => ctx.isDev` |
| `openkosmosFeatureMcpDebug` | MCP debug | `false` |

## File Structure

```
src/main/lib/featureFlags/
├── index.ts                    # Export entry point
├── types.ts                    # Type definitions (including FeatureFlagContext)
├── featureFlagDefinitions.ts   # Flag configuration
├── featureFlagManager.ts       # Backend manager
└── README.md

src/renderer/lib/featureFlags/
├── index.ts                    # Export entry point
├── featureFlagCacheManager.ts  # Frontend cache
└── useFeatureFlag.ts           # React hooks
```
