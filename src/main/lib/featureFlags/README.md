# Feature Flags Management System

## Overview

Feature Flags is a developer tool for controlling feature availability. Flag states are defined by developers on the backend or passed via command-line arguments.

## Naming Convention

All Feature Flags use the unified `kosmosFeatureXXXXX` naming format:

```typescript
'kosmosFeatureDevTools'
'kosmosFeatureDebugLogging'
'kosmosFeatureExperimentalChat'
```

## Defining Feature Flag Default Values

### 1. Static Boolean Value

```typescript
{
  name: 'kosmosFeatureDevTools',
  description: 'Developer Tools Panel',
  defaultValue: false,  // Static value
},
```

### 2. Dynamic Logic Function

Dynamically computed based on context (development environment, brand, platform):

```typescript
{
  name: 'kosmosFeatureDebugLogging',
  description: 'Debug Logging',
  // Only enabled in development environment
  defaultValue: (ctx) => ctx.isDev,
},

{
  name: 'kosmosFeatureExperimentalChat',
  description: 'Experimental Chat Feature',
  // Only enabled in development environment
  defaultValue: (ctx) => ctx.isDev,
},
```

### Context (FeatureFlagContext) includes:

| Property | Type | Description |
|----------|------|-------------|
| `isDev` | boolean | Whether it is a development environment |
| `brandName` | string | Current brand (e.g., kosmos) |
| `platform` | NodeJS.Platform | Platform (darwin, win32, linux) |

## Command-Line Argument Override

Command-line arguments take higher priority than default values:

```bash
# Windows
app.exe --enable-features=kosmosFeatureDevTools,kosmosFeatureDebugLogging

# macOS
./OpenKosmos.app/Contents/MacOS/OpenKosmos --enable-features=kosmosFeatureDevTools

# Development environment
npm run dev -- --enable-features=kosmosFeatureDevTools,kosmosFeatureMcpDebug
```

## Usage in Code

### Main Process

```typescript
import { isFeatureEnabled } from './lib/featureFlags';

if (isFeatureEnabled('kosmosFeatureDevTools')) {
  // Enable developer tools related features
}
```

### Renderer Process (React)

```tsx
import { useFeatureFlag } from '../lib/featureFlags';

function MyComponent() {
  const isDevToolsEnabled = useFeatureFlag('kosmosFeatureDevTools');
  
  if (!isDevToolsEnabled) return null;
  
  return <DevToolsPanel />;
}
```

## Adding a New Flag

### 1. Add Type in types.ts

```typescript
export type FeatureFlagName = 
  | 'kosmosFeatureDevTools'
  | 'kosmosFeatureMyNewFeature'  // Add new name
  ;
```

### 2. Add Configuration in featureFlagDefinitions.ts

```typescript
{
  name: 'kosmosFeatureMyNewFeature',
  description: 'My New Feature',
  defaultValue: false,  // Or use (ctx) => ctx.isDev to restrict to development environment only
},
```

## Defined Flags

| Flag | Description | Default Value |
|------|-------------|---------------|
| `kosmosFeatureDevTools` | Developer Tools | `false` |
| `kosmosFeatureDebugLogging` | Debug Logging | `(ctx) => ctx.isDev` |
| `kosmosFeaturePerformanceMetrics` | Performance Metrics | `false` |
| `kosmosFeatureExperimentalChat` | Experimental Chat | `(ctx) => ctx.isDev` |
| `kosmosFeatureNewModelSelector` | New Model Selector | `false` |
| `kosmosFeatureMemoryV2` | Memory V2 | `false` |
| `kosmosFeatureMockApi` | Mock API | `(ctx) => ctx.isDev` |
| `kosmosFeatureMcpDebug` | MCP Debug | `false` |

## File Structure

```
src/main/lib/featureFlags/
├── index.ts                    # Export entry
├── types.ts                    # Type definitions (includes FeatureFlagContext)
├── featureFlagDefinitions.ts   # Flag configuration
├── featureFlagManager.ts       # Backend manager
└── README.md

src/renderer/lib/featureFlags/
├── index.ts                    # Export entry
├── featureFlagCacheManager.ts  # Frontend cache
└── useFeatureFlag.ts           # React Hooks
```

