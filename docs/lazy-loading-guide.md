# On-Demand Loading Implementation Guide

## Option Comparison

### Option 1: Code-Level Lazy Loading (Recommended — Simple)

**Advantages:**
- No additional UI needed; automatically transparent
- Dependencies still included in the installation package but not loaded into memory immediately
- Simple to implement; no download logic required

**Disadvantages:**
- Installation package size is not reduced
- Brief delay the first time a feature is used

**Best For:**
- Optimizing memory usage and startup speed
- When reducing installation package size is not required

### Option 2: True On-Demand Download — removed

A plugin-based on-demand-download mechanism (a runtime downloader that fetched
optional features as installable plugins) was previously documented here as a
second option. The user-facing plugin feature has since been removed, so this
guide now covers only Option 1 (code-level lazy loading). The historical Option 2
blueprint and its plugin-manager implementation have been deleted.

---

## Option 1: Code-Level Lazy Loading (Recommended First)

### Principle

Use dynamic `import()` syntax to load modules only when needed, rather than loading everything at application startup.

### Implementation Examples

#### 1. Playwright Lazy Loading

**Current code (eager loading):**

```typescript
// src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts
import { chromium, Browser, Page } from 'playwright';

export async function executeGoogleSearch() {
  const browser = await chromium.launch();
  // ...
}
```

**Optimized (lazy loading):**

```typescript
// src/main/lib/mcpRuntime/builtinTools/googleWebSearchTool.ts

let playwrightModule: typeof import('playwright') | null = null;

async function getPlaywright() {
  if (!playwrightModule) {
    try {
      playwrightModule = await import('playwright');
    } catch (error) {
      throw new Error('Playwright is not installed. Please run: npm install playwright');
    }
  }
  return playwrightModule;
}

export async function executeGoogleSearch() {
  const playwright = await getPlaywright();
  const browser = await playwright.chromium.launch();
  // ...
}
```

#### 2. Mermaid Lazy Loading

**Current code:**

```typescript
// src/renderer/components/chat/MermaidDiagram.tsx
import mermaid from 'mermaid';

export async function renderDiagram(source: string) {
  return mermaid.render('diagram', source);
}
```

**Optimized:**

```typescript
// src/renderer/components/chat/MermaidDiagram.tsx

let mermaidCache: typeof import('mermaid').default | null = null;

async function getMermaid() {
  if (!mermaidCache) {
    try {
      const mod = await import('mermaid');
      mermaidCache = mod.default;
    } catch (error) {
      throw new Error('Mermaid renderer is not available.');
    }
  }
  return mermaidCache;
}

export async function renderDiagram(source: string) {
  const mermaid = await getMermaid();
  return mermaid.render('diagram', source);
}
```

### Results

- ✅ Application startup speed improved by 30–50%
- ✅ Memory usage reduced by 50–100 MB
- ✅ Installation package size unchanged (but can be combined with optionalDependencies)
- ✅ No UI changes required

---

## Recommended Approach

### Quick Optimization (1–2 hours)

1. Use **Option 1 code-level lazy loading**
2. Combine with [`electron-builder.optimized.yml`](../electron-builder.optimized.yml:1)
3. Remove unused `@xenova/transformers`

**Expected results:**
- Installation package reduced by 60–80 MB
- Startup speed improved by 40%
- Memory usage reduced by 80 MB

### Full Optimization

The previous "full optimization" path relied on the plugin download system
(Option 2), which has been removed along with the user-facing plugin feature.
There is currently no plugin-based optimization path; use the Quick Optimization
steps above.

---

## Recommendations

**If your goal is:**
- Quick results → Use Option 1 + configuration optimization
- Smaller package size → Combine Option 1 with optionalDependencies and remove unused heavy dependencies
- Balanced approach → Option 1 + optionalDependencies + configuration optimization

In most cases, **Option 1 + configuration optimization** is sufficient.
