# OpenKosmos Design System — Reference

> The visual and component language for the OpenKosmos desktop app. This is the
> human- and AI-readable companion to the visual report in
> [`design-system.html`](./design-system.html). The **governance source of truth** is
> [`ai.prompt/design-system.md`](../../ai.prompt/design-system.md); the **primitive
> library** doc is [`src/renderer/components/ui/ai.prompt.md`](../../src/renderer/components/ui/ai.prompt.md).
> Every value below is the live token, pulled from
> [`src/renderer/styles/globals.css`](../../src/renderer/styles/globals.css).

## TL;DR

The design system is **not Tailwind** and **not a single component library**. It is:

```
design tokens (source of truth)  ->  components/ui primitives  ->  feature components
                              + a governance engine that ratchets drift down, never up
```

The OpenKosmos design system is shared across app surfaces. Packaging metadata must
not introduce visual token divergence.

---

## 1. Architecture

| Layer | Lives in | Role |
|---|---|---|
| **Design tokens** (SSOT) | `globals.css` `@theme` + `:root` + `[data-theme="dark"]` | Every color, radius, font value. Nothing downstream invents its own. |
| **UI primitives** | `src/renderer/components/ui/` | Hand-rolled, accessible building blocks (Dialog, Badge, Card…). Consume tokens, never raw values. |
| **Feature components** | `src/renderer/components/**` | The app. Composes primitives + token-backed utility classes. |
| **Governance engine** | `scripts/check-design-tokens.js` + CI + lint + hooks | A ratchet gate; drift may only decrease. |

### Two homes for a raw color value

Every hex/oklch in the renderer lives in exactly one of:

1. **The SSOT** — `globals.css`: the `@theme` block (primitives that feed **both** the
   `.tsx` utility classes *and* the `.css` `var()` layer from one declaration) plus the
   `:root` semantic tier.
2. **The syntax registry** — `code-styles.css`: the independent `--syntax-*` registry
   for code/markdown rendering, deliberately decoupled from the brand palette so
   highlighting never drifts on a rebrand.

Everything else references those with `var(--color-*)` or a Tailwind palette utility.
Three small, policy-forced carve-outs (the screenshot window, the fatal-error fallback,
one content-excluded file) are the *only* places a raw hex is allowed in `.tsx`, and they
are bounded by their own ratchet (`sanctionedTsxHexLiterals`) so they can never grow.

---

## 2. Color system

Three tiers: **primitives** (raw ramps, defined once in `@theme`), the **semantic tier**
(intent names in `:root` pointing at primitives), and **component tokens** (`--button-*`,
`--form-control-*`, `--shadow-*`) for shared controls. Dark mode re-points semantic and
component tokens under `[data-theme="dark"]`; primitives stay stable. Prefer semantic
tokens in feature code; reach for a primitive only when no intent token fits.

### 2.1 Primitive ramps

**Primary — sky** (the interactive accent: focus rings, links, active nav, selection — **not** a button color)

| Step | 50 | 100 | 300 | 500 | 600 | 700 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|
| Hex | `#f0f9ff` | `#e0f2fe` | `#7dd3fc` | `#0ea5e9` | `#0284c7` | `#0369a1` | `#0c4a6e` | `#082f49` |

**Warm** (brand warm-neutral ramp; `warm-900` = button black, `warm-50` = app paper bg)

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | accent |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hex | `#fffbf8` | `#f8f4f1` | `#e2ddd9` | `#b3ada8` | `#979593` | `#6b6561` | `#4c4642` | `#3d3935` | `#322d29` | `#272320` | `#ffe6d3` |

**Neutral** (single cool-gray system — Option A; every gray maps here)

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hex | `#fafafa` | `#f5f5f5` | `#e5e5e5` | `#d4d4d4` | `#a3a3a3` | `#737373` | `#525252` | `#404040` | `#262626` | `#171717` | `#0a0a0a` |

**Status** — exact Tailwind v4.2.2 OKLCH ramps. `danger` = red, `success` = green,
`warning` = amber. Stored as OKLCH (not hex) so they are byte-identical to the `.tsx`
side and outside the hex gate. Use them through the semantic `danger` / `success` /
`warning` aliases, never raw `red-*` / `green-*` / `amber-*` / `yellow-*` classes.

**Extended primitives** — far-set decorative / external-identity colors that must never
fold into the ramps above: `orange-*`, `rose-700`, `cyan-500`, `taupe-*`, `sky-soft-*`,
`request-accent(-deep)`, `output-error`, plus the secondary-accent `violet` / `indigo`
families. Each earned a dedicated token because snapping it to a neighbour would be a
visible shift.

### 2.2 Semantic tier (intent names)

| Token | Resolves to | Use |
|---|---|---|
| `--color-text-default` | `#1a1a1a` | body & control text |
| `--color-text-muted` | `neutral-600` | labels, secondary copy |
| `--color-text-subtle` | `neutral-400` | placeholder, hint |
| `--color-accent` | `#0ea5e9` (sky-500) | interactive accent |
| `--color-accent-strong` | `#0284c7` (sky-600) | hover / links |
| `--color-accent-stronger` | `#0369a1` (sky-700) | active |
| `--color-accent-ring` | `rgba(14,165,233,.1)` | the canonical focus ring |
| `--color-accent-secondary` | `indigo-500` | schedule / paste / context chrome |
| `--color-bg-app` / `-muted` / `-sidebar` | translucent whites/slates | app surfaces |
| `--color-surface-*` | themeable surface roles | panels, cards, hover/active rows |
| `--color-danger-surface` / `-text` | danger-100 mix / danger-800 | error banners |
| `--color-success-surface` / `-text` | success-50 / success-700 | success badges and panels |
| `--color-warning-surface` / `-text` | warning-50 / warning-700 | warning badges and panels |
| `--color-info-surface` | `#f0f9ff` | info surfaces |
| `--color-selection-surface` | `#fff6ee` | text selection |

### 2.3 Dark mode contract

Dark mode is token-first and selector-driven:

- The renderer writes `data-theme="light"` or `data-theme="dark"` on `<html>`.
- `globals.css` defines `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`
  so legacy `dark:` classes follow the app theme rather than `prefers-color-scheme`.
- New work should not add `dark:` pairs as the default approach. Add or reuse a semantic/component
  token and define both the `:root` light value and `[data-theme="dark"]` override.
- Button colors remain black/red/white in the design language. In dark mode, primary buttons use
  the white-on-dark token pair; sky remains reserved for non-button affordances.
- Shared settings toggles use `.toolbar-toggle-wrapper` and `.toolbar-toggle-track`; do not copy
  a feature-specific toggle class and treat it as a primitive. The off track has its own tokenized
  inset border so the thumb does not appear as an isolated dot on dark cards.
- Shared accent badges that use the bright primary ramp in Light mode need a stable class hook when
  white text on `primary-500` is below dark-mode contrast requirements. `ExperimentTag` exposes
  `.experiment-tag` for this dark-only remap while preserving the Light utility classes.
- The Light baseline must stay visually equivalent to the pre-dark-mode app unless a PR explicitly
  changes Light UX and updates the dark-mode PRD / Tech Doc. See
  [`docs/dark-mode-governance.md`](../dark-mode-governance.md) for development, audit, CI, and
  PR-review rules.

### 2.4 Border ladder

Five tiers replace the old ad-hoc rgba border zoo — three black tiers for elevation
depth, two slate tiers for forms.

| Token | Value | Use |
|---|---|---|
| `--color-border-subtle` | `rgba(203,213,225,.3)` | faint dividers, tracks |
| `--color-border-panel` | `rgba(0,0,0,.075)` | panels & cards (the default) |
| `--color-border-strong` | `rgba(0,0,0,.12)` | emphasis hairlines |
| `--color-border-strongest` | `rgba(0,0,0,.2)` | hover, blockquote |
| `--color-border-form` | `rgba(203,213,225,.8)` | inputs, secondary buttons |

---

## 3. Component system

### 3.1 Buttons — black / red / white

One button family (`.btn-*`), one box model: `padding: 8px 16px`, `border-radius:
var(--radius-lg)`, `font-weight: 600`, `font-size: 12px`, `min-height: 32px`, centered
flex with `gap: 8px`. The palette is deliberately **black, red, white** — sky is *not* a
button color.

| Class | Background | Use |
|---|---|---|
| `.btn-primary` | `var(--button-primary-bg)` | the one primary / submit action |
| `.btn-secondary` | `var(--button-secondary-bg)` + `--button-secondary-border` | secondary / cancel |
| `.btn-danger` | `var(--color-danger-600)` (red) | destructive |
| `.btn-ghost` | transparent | low-emphasis tertiary |
| `.btn-icon` / `.btn-close` | `var(--button-icon-*)` / transparent | icon-only affordances |

Buttons are **CSS classes, not a React variant component**. The legacy `.btn-dark` and
the old cva `Button` primitive were both consolidated into this family.

### 3.2 Primitive library (`components/ui/`)

~19 hand-rolled primitives. Hand-rolled is deliberate — Radix was removed, so each
primitive owns its own accessibility (focus, escape, stacking).

| Primitive | Notes |
|---|---|
| `Dialog` | The single modal standard. Owns Escape, stacking, focus, close-context. All legacy `.modal-*` shells were retired onto it. |
| `Card` | The elevated-panel recipe (white, `border-panel`, `radius-lg`, panel shadow). |
| `Badge` | The one primitive built with `class-variance-authority`; the reference pattern for any future variant API. |
| `DropdownMenu` | The single menu implementation. |

`class-variance-authority` (cva) is the standard for variant APIs; `Badge` is the live
example.

---

## 4. Visual language

Derived from the two reference surfaces — the **Agent page** and the **Settings page** —
and adopted as the project-wide visual system. The pre-auth Startup / Sign-in /
Data-loading screens were conformed to it.

### 4.1 Type

- `--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif`
- `--font-mono: 'Cascadia Code', 'SF Mono', 'Consolas', 'Monaco', 'Menlo', monospace`
- Body sets `font-variation-settings: 'opsz' 32`. No web fonts ship; the OS UI font keeps
  the app native and instant.

### 4.2 Corner radius — the `--radius-*` scale (SSOT in `@theme`)

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--radius-sm` | `2px` | | `--radius-xl` | `12px` |
| `--radius` (DEFAULT) | `4px` | | `--radius-2xl` | `16px` |
| `--radius-md` | `6px` | | `--radius-3xl` | `24px` |
| `--radius-lg` | `8px` | | `--radius-full` | `9999px` |

`lg` (8px) is the workhorse — panels, buttons, inputs. Off-scale one-offs live in `:root`:
`--radius-scrollbar` 3px, `--radius-bubble` 20px (message bubbles / glass cards),
`--radius-card-xl` 36px (onboarding card). `@theme` generates both the `rounded-*`
utilities and the `var(--radius-*)` references from one definition.

### 4.3 Elevation

Soft, low-spread black shadows; depth grows with blur, not darkness.

| Level | Shadow |
|---|---|
| panel | `0 2px 8px rgba(0,0,0,.06)` |
| glass card | `0 4px 16px rgba(0,0,0,.08)` |
| modal / overlay | `0 8px 32px rgba(0,0,0,.12)` |

### 4.4 The shared skeleton

What makes Agent and Settings feel like one app:

- **Elevated-panel recipe** — `radius-lg` + 1px `border-panel` + panel shadow. The
  Settings content container *is* the Agent sidepane.
- **Unified header** — 64px tall, `surface-default`, `border-panel` bottom, 17px / 650 title; every
  sub-page header reuses it.
- **Left navigation** — `left-panel-bg`, the same class on both pages.
- **Hover / active** — `surface-hover` / `surface-active`; one menu implementation; shared `form-*`
  / tool-card / list-search recipes.

---

## 5. Governance engine

`scripts/check-design-tokens.js` walks the whole renderer tree and counts **ten drift
metrics** against a frozen baseline (`scripts/design-system-baseline.json`). **Counts may
only ratchet down** — a PR that raises any metric fails.

| Metric | Baseline | Meaning |
|---|---|---|
| `hardcodedHexLiterals` | **0** | raw hex in renderer `.ts/.tsx` (hard-zero) |
| `rendererCssFiles` | **67** | legacy `.css` file count (shrink as files are tokenized/retired) |
| `uiDirectoryCssFiles` | **0** | `.css` files under `components/ui/` |
| `rawStatusPaletteClasses` | **0** | raw `red/green/amber/yellow` Tailwind classes |
| `rawBrandColorClasses` | **0** | raw `blue/sky` Tailwind classes |
| `rawBrandRgbColors` | **0** | raw `blue/sky` RGB(A) color functions |
| `cssHexLiterals` | **0** | raw hex in component `.css` |
| `sanctionedTsxHexLiterals` | **92** | bounded hex in the three carve-outs (can't grow) |
| `cssBorderRadiusLiterals` | **0** | raw px/rem `border-radius` in `.css` |
| `undefinedCssVariableRefs` | **0** | fallback-free CSS `var(--token)` refs whose token is not defined |

Canonical baseline string: `0 / 67 / 0 / 0 / 0 / 0 / 0 / 92 / 0 / 0`. Adding a genuinely new token
does **not** raise a drift baseline; token definitions live in the sanctioned `globals.css`
SSOT region. Baselines only change when a drift metric drops, and they may only ratchet down.

### Three enforcement points

1. **CI gate (always on)** — `.github/workflows/pr-design-system.yml` runs `check:design` and
   `check:dark-mode` on
   every PR, appends the report to the job summary, posts a sticky comment for same-repo
   PRs only, and fails the check on any increase, dark-mode governance drift, or PR-added raw status `rgba(...)` state color. Fork PRs skip the sticky comment because
   their tokens may not have PR-comment write permission. Once the
   base branch has a baseline, it also compares the PR's checked-in baseline file
   against that base-branch baseline so a PR cannot raise its own ceiling.
2. **Pre-push hook (local, opt-in)** — wire the same gates as a native git pre-push hook
   so a push that would break the gate is caught before it leaves your machine. One-time
   setup in your checkout:

   ```bash
   printf '#!/bin/sh\nnpm run check:design && npm run check:dark-mode\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push
   ```

   `.git/hooks/` is local-only (the repo restricts committing hook files), so each
   developer opts in; CI is the always-on backstop.
3. **ESLint rule (editor)** — a `no-restricted-syntax` rule in `eslint.config.mjs`
   red-flags a raw hex literal in renderer source the moment you type it. Its `ignores`
   mirror the gate's three sanctioned carve-outs and test files, so it never fires on
   sanctioned code.

---

## 6. Using the system day-to-day

Token-first. Pick the highest row that fits **before** you consider a literal value.

| You need… | Reach for | Example |
|---|---|---|
| a color in `.tsx` | a Tailwind palette utility | `text-primary-600`, `bg-warm-900`, `text-danger-600` |
| a color in `.css` | `var(--color-*)` | `color: var(--color-text-default)` |
| a corner radius | `rounded-*` / `var(--radius-*)` | `rounded-lg`, `border-radius: var(--radius-lg)` |
| a button | a `.btn-*` class | `<button className="btn-primary">` |
| a modal | the `Dialog` primitive | `<Dialog>…</Dialog>` |
| a variant API | `cva` (see `Badge`) | `badgeVariants({ variant })` |
| a brand-new value | add **one** token in `globals.css` | then reference it everywhere; do not raise a drift baseline |

**Do**

- Change a color in *one* place (the token) and let it cascade.
- Use the semantic tier before a primitive.
- Compose existing primitives.

**Don't**

- Write a raw `#hex` in renderer source (the gate, the hook, and ESLint all reject it).
- Hand-roll a button or a modal shell.
- Add a baseline or allowlist entry to silence the gate.

---

## 7. Verifying a PR

Three layers of defense — machine first, human second, docs as the contract.

1. **Machine gate (automatic).** CI runs `check:design` over the whole tree and fails on
   any metric increase; CI also runs `check:dark-mode` to keep the dark-mode development
   guide, PRD, Tech Doc, review prompt, package script, and workflow connected, and to reject PR-added raw status `rgba(...)` literals under `src/renderer`. The optional local pre-push hook catches design-token drift earlier; the ESLint rule catches it in the editor. Run both yourself:

   ```bash
   npm run check:design
   npm run check:dark-mode
   ```

   Expect `Design system check passed` with baseline `0 / 68 / 0 / 0 / 0 / 0 / 0 / 93 / 0`.
   On failure it names the metric that grew and the file.

2. **Human review (the gate's blind spots).** The gate counts drift vectors; a reviewer
   still checks: semantic misuse (e.g. success-green for a destructive action), hand-rolled
   buttons/modals, spacing rhythm, contrast (body text ≥ 4.5:1), accessibility, Light baseline
   preservation, token-first dark adaptation, and real Electron route/state coverage. See the
   Anti-Patterns in [`ai.prompt/design-system.md`](../../ai.prompt/design-system.md) and
   [dark-mode governance](../dark-mode-governance.md).

3. **Docs as contract.** `ai.prompt/design-system.md` and
   [`components/ui/ai.prompt.md`](../../src/renderer/components/ui/ai.prompt.md) describe
   intent. When a change adds a token or shifts a rule, the same PR updates them. Re-freeze
   the baseline only when a measured drift count drops.

---

*Generated reference for the OpenKosmos design system. Keep this in sync with
`globals.css` and `ai.prompt/design-system.md` when tokens change.*
