<!-- Last verified: 2026-07-13 -->
# Design System Governance

> How OpenKosmos governs its design assets: design tokens, the UI primitive
> library, the styling strategy, and the product visual policy. This is the
> architecture-level governance doc; the primitive library has its own module doc at
> [`components/ui/ai.prompt.md`](../src/renderer/components/ui/ai.prompt.md).

## TL;DR
The design system is **not Tailwind** and **not a single component library**. It is the
combination of: **design tokens (source of truth) -> the `components/ui` primitive
library -> the app's feature components**, plus the **governance engine** that keeps them
consistent (`ai.prompt.md` docs + Co-Change Maps + the `check:design` ratchet gate).
Stack today: **Tailwind v4 + hand-rolled primitives + `cva` for `Badge` variants + `lucide-react`
icons + `cn()` (clsx + tailwind-merge)**, with **buttons styled by designer-owned global `.btn-*`
CSS classes** (not a component). It resembles a shadcn-style layout (a
`components/ui` folder + `cn()` + `cva`). **`class-variance-authority` is the adopted
standard** for the remaining variant-bearing primitive (`Badge`). The other "missing shadcn
piece" — **Radix UI** — was installed but imported **0 times**, so the 7 packages were
**removed (2026-06-20)** as dead dependencies: primitives are built by hand and own their own
accessibility (e.g. `dialog.tsx` implements its own Escape/stacking logic). We govern the stack
we have; we do **not** migrate to a different design system to "get governance" — governance is a
process layer, not a dependency.

**Two-registry color model (the end-state).** All color lives in exactly **two** managed homes and
nowhere else: (1) the **project global token manager** — the `@theme`/`:root` SSOT in `globals.css`,
which owns every brand / semantic / primitive color; and (2) **one independent syntax registry** —
`src/renderer/styles/code-styles.css` (`--syntax-*`), the single sanctioned home for code-format
rendering colors (editor surfaces, code-block/inline-code, gutters, the JSON-viewer theme). The
syntax registry is deliberately **decoupled** from the brand palette (self-contained literals, no
`var(--color-*)` refs) so the highlight scheme never drifts on rebrand. There are **no other
exceptions** — every non-syntax raw hex ultimately merges into home (1).

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `tailwind.config.js` | **Non-color theme settings only** (since Phase A, 2026-06-23): `backdropBlur`, `container`, `animation`/`keyframes`, `content` globs, `prefix`. Activated under Tailwind v4 via `@config`. The color ramps (`primary`/`neutral`/`warm` + status), the `require('tailwindcss/colors')` alias, **and the radius scale (`--radius-*`) all moved to the `@theme` block in `globals.css`** (the SSOT) — this file no longer defines any color or `borderRadius`. | ~57 LOC |
| `src/renderer/styles/globals.css` | Tailwind v4 entry (`@import "tailwindcss"` + `@config` + selector-based `@custom-variant dark`) and the **single source of truth for color primitives** via a native **`@theme` block** (Phase A, 2026-06-23): `white`/`black`, the `primary` (sky) ramp, `warm`, `neutral` (incl. `950`), and the `danger`/`success`/`warning` status ramps as **OKLCH** mirroring Tailwind v4. One `@theme` definition feeds **both** the `.tsx` utility classes (`bg-primary-600`) **and** the `.css` `var(--color-*)` references — replacing the old triple-track (config-inlined utilities + a hand-mirrored `:root` var block). `:root` still hosts the secondary-accent customs (`--color-violet-*`/`--color-indigo-*`, a deferred `.tsx`-vs-`.css` split), **the external-identity palette** (`--color-filetype-*`/`--color-lang-*` — R2, 2026-06-23: fixed file-format / language colors that must never fold into the brand ramps), **the semantic alias tier** (`--color-text-*` / `--color-accent*` / `--color-accent-secondary*` / `--color-bg-*` / `--color-border-*` / `--color-danger-surface`/`-text`), and component tokens (`--button-*`, `--form-control-*`, `--shadow-*`). The live `[data-theme="dark"]` block re-points only semantic/component tokens; primitives remain stable. Every fallback-free `var(--token)` reference must resolve to a token defined in renderer CSS; `check:design` hard-fails unresolved references. It also **`@import`s the independent syntax registry** (`./code-styles.css`) so `--syntax-*` loads app-wide. | ~2100 LOC |
| `src/renderer/styles/code-styles.css` | **The independent syntax / code-rendering token registry** (R1, 2026-06-23) — the *second* sanctioned color home (see Two-registry model in TL;DR). A pure `:root` file of 21 self-contained `--syntax-*` tokens (editor surfaces, code-block bg/text, gutter/line-number, editor accents, inline-code light+dark, file-viewer md inline, the JSON-viewer theme). Values are **literals, independent of `--color-*`**, so the highlight scheme never drifts on rebrand. Definitions only — no component rules. **Exempt from the `.css` drift metrics** (see `SANCTIONED_REGISTRY_CSS`). | ~70 LOC |
| `src/renderer/components/ui/` | The UI primitive library (~40 primitives). See its [ai.prompt.md](../src/renderer/components/ui/ai.prompt.md). | dir |
| `src/renderer/lib/utilities/utils.ts` | `cn()` = `twMerge(clsx(...))`, the class-composition helper every primitive should use. | ~7 LOC |
| `resources/design/figma_design.css` | **RETIRED 2026-06-20.** Was a stale Figma export (Segoe Sans, `#322D29` warm ramp) with bare declarations (no selectors — not importable) and **0 references** since the initial commit. Deleted; git history (`2c8ec3a25`) preserves it. Tokens live in the `@theme` block in `globals.css` (the SSOT). | removed |
| `brands/<brand>/config.json` | Per-brand **packaging metadata only** (appId, productName, userDataName, icons, feedback link). Contains **no visual tokens** today. | small |
| `scripts/check-design-tokens.js` | The ratchet gate: hardcoded `.tsx` hex, `.css` hex, per-component-CSS, raw status-palette-class (`red`/`green`/`amber`/`yellow`), raw brand-color-class (`blue`/`sky`), and raw brand RGB(A) function counts may not exceed frozen baselines. Both class metrics match every Tailwind color-utility prefix via a shared `COLOR_UTILITY_PREFIX` — **including the directional border-color longhands (`border-t/r/b/l/x/y/s/e`) and `ring-offset`** — so e.g. `border-l-red-500` or `ring-offset-blue-100` can no longer evade the ratchet (width-only utilities like `border-l-2` carry no color and are not matched). The `rawBrandRgbColors` metric catches raw Tailwind blue/sky `rgb()`/`rgba()` literals (e.g. `rgba(59,130,246,...)` and `rgba(14,165,233,...)`) so alpha variants must use tokenized channel vars such as `rgb(var(--color-accent-rgb) / .1)`. Two sanctioned definition homes are exempt from the `.css` hex metric: whole-file registries (`SANCTIONED_REGISTRY_CSS`, e.g. `styles/code-styles.css`) **and** the `--token:` definition lines of the SSOT file `globals.css` (`SSOT_DEFINITION_CSS` / `isSsotDefinitionCss` — its `@theme`/`:root` defs ARE the central manager, so a `--color-x: #hex;` def is sanctioned while a raw `color: #hex` usage anywhere still counts). `sanctionedTsxHexLiterals` (`SANCTIONED_TSX_REGIONS` / `isSanctionedTsxRegion`) tracks bounded `.tsx` carve-outs (screenshot asset/user-palette literals, the `index.tsx` fatal-error fallback, content-excluded Memex) as their own count so they can never grow, while the main `hardcodedHexLiterals` metric stays a hard-zero target. `cssBorderRadiusLiterals` (frozen at **0**) is the radius twin of `cssHexLiterals`: it counts raw `px`/`rem` `border-radius` literals (and corner longhands) in renderer `.css`, so corner radius must flow through the `--radius-*` scale (`var(--radius-*)`); geometric `0`/`50%`, `calc(var(--radius-*) / …)`, and the `--radius-*:` token definitions are not counted (CSS comments are stripped first). `undefinedCssVariableRefs` (frozen at **0**) catches fallback-free CSS `var(--token)` references whose token is not defined anywhere in renderer CSS, including unresolved dark-mode aliases that would make the browser drop the whole declaration. When the base branch already has a baseline, CI passes `--reference-baseline` so the PR's checked-in baseline file is also compared to the base-branch baseline; a PR can lower a baseline but cannot raise its own ceiling. | script |
| `scripts/check-dark-mode-governance.js` | Dark-mode process gate (updated 2026-07-11): verifies that `docs/dark-mode-governance.md`, its public PR review guide, the PRD, Tech Doc, design-system README, `package.json`, this doc, and `.github/workflows/pr-design-system.yml` stay connected, and diff-checks PR-added `src/renderer` lines for raw warning/success/danger `rgba(...)` literals. This does **not** replace the real Electron visual audit; it prevents governance assets from drifting, CI wiring from disconnecting, and repeated token-first status-color violations. Run via `npm run check:dark-mode`. | script |
| `scripts/design-system-baseline.json` | Frozen baselines for the ratchet gate. Once present on the base branch, baselines may only stay the same or ratchet down from that base; CI rejects increases. | config |
| `.github/workflows/pr-design-system.yml` | **Enforcement layer 1 — CI gate (always on).** Extracts the base commit's `scripts/design-system-baseline.json` when present, runs `check:design --reference-baseline`, runs `check:dark-mode --base-ref <PR base sha>`, appends both reports to the job summary, posts a sticky comment for same-repo PRs only, and fails the check on either current-count increases, PR baseline increases, dark-mode governance drift, or PR-added raw status `rgba(...)` colors (Node 22). If the base commit has no baseline, the workflow treats the PR as the initial design gate installation and runs the current-count gate only. Fork PRs skip the sticky comment because their tokens may not have PR-comment write permission. | workflow |
| `.git/hooks/pre-push` *(local, not committed)* | **Enforcement layer 2 — optional local pre-push hook (2026-06-25, updated 2026-07-06).** The repo's push-protection ruleset **restricts committing files under `.husky/`** (hook files execute arbitrary code on checkout), so the pre-push gate ships as a documented one-time local opt-in rather than a tracked file: `printf '#!/bin/sh\nnpm run check:design && npm run check:dark-mode\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push`. Runs the same gates before a push leaves the machine. CI remains the always-on backstop. | local |
| `eslint.config.mjs` | **Enforcement layer 3 — editor guard (2026-06-25).** A `no-restricted-syntax` rule (severity `error`, two selectors: `Literal` + `TemplateElement`) forbids raw hex literals in `src/renderer/**/*.{ts,tsx}`, giving an inline red-squiggle the moment a hex is typed. Its `ignores` mirror the gate's `SANCTIONED_TSX_REGIONS` + test files, and the `(?<!&)` lookbehind matches `countHexInText` byte-for-byte, so it never fires on sanctioned code. | config |
| `docs/design-system/` | **The landed, shippable reference for AI + developers (2026-06-25).** `README.md` (greppable English Markdown: token tables, component catalog, visual language, governance, how-to-use, how-to-verify) + `design-system.html` (self-contained English visual report that dogfoods the live tokens). Outside the gate's renderer scope (no metric impact). Keep in sync with `globals.css` when tokens change. | docs |
| `scripts/color-snap.mjs` | **CIEDE2000 nearest-token snapper (Phase B, 2026-06-23).** Parses the `@theme`/`:root` tokens, lifts tokens **and** scanned literals into a shared CIELAB space (hex→sRGB→XYZ; OKLCH→OKLab→XYZ), ranks by ΔE2000, and buckets `auto`(ΔE≤1)/`qa`(≤3)/`review`(>3) with an HSL-hue semantic role guard. Mirrors the hard gate's sanctioned exclusions (whole-file `code-styles.css`, line-level `globals.css` `--token:` defs, and `SANCTIONED_TSX_REGIONS`) so it never re-reports a managed token definition or sanctioned carve-out as drift. Run via `npm run snap:colors` (`--json <path>`, `--bucket <name>`). The measurement engine for the Phase C batch migration. | script |

## Architecture

### Token model (target: three tiers)
- **Primitive / Global** — raw values. The **color** primitives and the **`--radius-*`
  scale** live in the `@theme` block in `globals.css` (one Tailwind v4 definition that
  generates both the `.tsx` utilities — `bg-primary-600`, `rounded-md` — and the `.css`
  `var(--color-*)` / `var(--radius-*)` variables); the remaining non-color settings
  (`blur`, `animation`, `container`, ...) stay in `tailwind.config.js`.
- **Semantic / Alias** — intent-named, references primitives (`--color-text-default`,
  `--color-text-muted`, `--color-accent`, `--color-accent-secondary` (sanctioned violet/indigo second accent), `--color-bg-app`, surfaces, the `--color-border-*` ladder, `--color-danger-*`). Established
  as a **CSS-variable tier in `globals.css`** (2026-06-21, live dark overrides 2026-07-04), each light
  value mapped byte-identically to a primitive or the current exact chrome value. This is the single
  layer that dark mode and any future per-brand theming re-point; grow it only in lockstep with real
  consumers.
- **Component** — component-scoped, references semantic (`--button-*`, `--form-control-*`, `--shadow-*`).
  Add only when a primitive needs a stable themable hook; define both light `:root` and dark
  `[data-theme="dark"]` values in the same change.

Single source of truth for **color primitives** and the **`--radius-*` corner-radius
scale** is the **`@theme` block in `globals.css`** (colors: Phase A, 2026-06-23; radius:
2026-06-25) — one native Tailwind v4 definition that generates both the `.tsx` utility
classes and the `.css` `var(--color-*)` / `var(--radius-*)` variables. `tailwind.config.js`
(via `@config`) remains the source for the remaining **non-color** theme settings (blur,
animation, container). The other `:root` CSS variables in `globals.css` (the semantic alias
tier, fonts, layout dimensions) are a deliberate second home for values Tailwind utilities do not
express well; they are part of the token system and must be documented, not duplicated into
ad-hoc values elsewhere.

**Border tokens (converged ladder).** The renderer's ad-hoc border-opacity ladder
(`rgba(0,0,0,.075|.1|.12|.2)` + slate `rgba(203,213,225,.3|.8)`) drifted across ~38 component CSS
files. It is converged into five semantic tiers in `globals.css` `:root`: a three-step black
intensity ladder `--color-border-panel` (`.075`, elevated-panel / header hairline — the most common
border) < `--color-border-strong` (`.12`, dropdown / modal-container / input outline; the old `.1`
**and** `.12` both map here) < `--color-border-strongest` (`.2`, control `:hover` + blockquote
accent), plus two slate tiers `--color-border-subtle` (`.3`, faint divider) and `--color-border-form`
(`.8`, form-control outline). The canonical focus ring is `--color-accent-ring` (sky-500 @ 10%),
which also de-blued the lone blue (`rgba(37,99,235,.1)`) ring on the New-Task input. These are
`rgba()` values, so the hex gate does **not** track them — keep new borders flowing through these
tokens by convention, never a raw `rgba` ladder value. The sweep is **border-context-only**: the
same `rgba(0,0,0,.1|.2)` literals are also used for box-shadows, which were deliberately left raw.

**Independent syntax registry (the one sanctioned exception).** Colors used to render *code* —
editor surfaces, code-block/inline-code, gutters, line numbers, and the JSON-viewer syntax theme —
live in a **separate** registry, `src/renderer/styles/code-styles.css` (`--syntax-*`), not in the
global manager. These come from external editor themes (VS Code Dark+, One Dark) and a fixed
JSON-viewer scheme; they are intentionally **decoupled** from the brand palette so the highlight
scheme never drifts when the app is rebranded. Every `--syntax-*` value is therefore a self-contained
literal (no `var(--color-*)` reference). The per-token Prism highlight palette itself (keyword/string/
comment/…) is owned by the vendored `react-syntax-highlighter` `oneDark` theme in
`CodeBlockContent.tsx` — the single sanctioned highlight scheme; the registry holds the surrounding
CSS-colored chrome. This is the **only** color that is allowed to live outside the global manager.

### Styling strategy (one recommended path)
1. **Recommended:** Tailwind utility classes composed with `cn()`, with **`cva` as the
   standard for variant APIs** (see `badge.tsx`), driven by tokens. **Buttons are the one
   deliberate exception:** they use the designer-owned global `.btn-*` CSS classes
   (`.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-ghost` in globally imported
   `Common.css`) — never a component or `cva` recipe. **Button palette = black / red / white,
   never sky** (designer decision, 2026-06-24): `primary` = black (`--color-warm-900`,
   hover `warm-800`), `danger` = red (`danger-600`), `secondary` = white outline (neutral hover,
   no sky ring); the primary CTAs (`.new-chat-button`/`.new-agent-button`/`.send-btn`) share the
   same black. Sky/`accent` is reserved for **non-button** affordances (links, focus rings, active
   nav/list selection) and must not return to any button surface.
2. **Legacy debt (frozen):** 68 `.css` files under `src/renderer/` (62 in `styles/`,
   6 co-located) and component-level styles inside the 1749-line `globals.css`.
   New UI must not add to either; migrate opportunistically when touching a component.
   The **color content** of those files is itself frozen by the gate (the `cssHexLiterals`
   metric, now **0** — hard-zero, ratcheted down from 2094), so no new raw hex may be scattered into CSS.
   (The independent syntax registry `code-styles.css` is **exempt** from both `.css` metrics — it
   IS the managed home for those raw editor values.)
3. **Forbidden:** raw hex colors. The gate freezes both layers and has driven each to a
   **hard zero** — **0** raw hex in component `.tsx` (from 729) and **0** in `.css` (from 2094) —
   blocking any new ones. The only raw hex that still exists lives in the two sanctioned registries
   (`globals.css` `@theme`/`:root` defs + `code-styles.css`) and the three bounded `.tsx` carve-out
   regions tracked by `sanctionedTsxHexLiterals` (see R5 below). Reference CSS variables / Tailwind
   tokens (`var(--token)`) instead.

### Primitive boundary (hand-rolled — own it deliberately)
Primitives in `components/ui/` are **built by hand**, not wrapped from a headless library.
`dialog.tsx`, for example, implements its own Escape handling, dialog stacking registry,
and close-context. This means **we own accessibility correctness ourselves** (focus
management, ARIA, keyboard nav) — there is no Radix safety net. Two consequences for
governance:
- Every new/changed interactive primitive must hand-verify keyboard + focus + ARIA.
- `class-variance-authority` has been **deliberately adopted** as the variant standard
  (`badge.tsx`); it is no longer dead. **Buttons do not use `cva`** — they use the global
  `.btn-*` CSS classes (the `cva` `button.tsx` was removed; see Anti-Patterns). The 7
  `@radix-ui/*` packages that were imported **0 times** have been **removed (2026-06-20)** — the
  "adopt vs remove" decision was settled as **remove**, since primitives are hand-rolled and own
  their own a11y. Do not re-add a headless library without deliberately adopting it across the
  primitive layer; do not half-adopt.

### Product visual policy
**Decided policy (2026-06-20, owner-confirmed): OpenKosmos uses ONE design system.** This is a
settled decision, not a provisional default. Brand config (`brands/openkosmos/config.json`) is
**packaging metadata only** (appId, productName, icons, links) and carries **no visual tokens**.
Visual divergence is explicitly out of scope and should not be reopened without a new product
decision. If a future deployment needs a distinct identity, the **only** sanctioned mechanism is
to branch at the **semantic token layer** (for example a deployment-specific token file overriding
semantic tokens at build time), which is itself a reason to keep growing the semantic layer.
**Never** branch visuals with product-conditionals inside components.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add/adjust a **color** primitive token | `globals.css` `@theme` block | This is the color SSOT (feeds both `.tsx` utilities and `.css` vars). Re-run `npm run check:design`. |
| Add/adjust a **code-rendering / syntax** color | `src/renderer/styles/code-styles.css` (`--syntax-*`) | The independent syntax registry — NOT the global manager. Keep values literal (no `var(--color-*)`). Consume via `var(--syntax-*)`. |
| Add/adjust a **corner-radius** token | `globals.css` `@theme` block (`--radius-*`) | Radius SSOT (feeds both `rounded-*` utilities and `.css` `var(--radius-*)`). Off-scale one-offs (e.g. `--radius-scrollbar`/`--radius-bubble`/`--radius-card-xl`) live in `:root`. Never hardcode a raw `px`/`rem` `border-radius` in `.css` — the gate's `cssBorderRadiusLiterals` metric forbids it. |
| Add/adjust a non-color, non-radius token (blur, animation, container) | `tailwind.config.js` | SSOT for the remaining non-color theme settings. Re-run `npm run check:design`. |
| Add a semantic/component token | `globals.css` — `:root` for the light value and `[data-theme="dark"]` for the dark override; `@theme` only for primitive/status ramps | Reference a primitive where possible; prefer this over new primitives in feature code. Before using `var(--token)` without a fallback, define the token in renderer CSS; `undefinedCssVariableRefs` is a hard-zero gate. Re-run `npm run check:design`. |
| Add a font / layout dimension variable | `src/renderer/styles/globals.css` `:root` | Document it here; do not hardcode the value elsewhere. |
| Add/modify a primitive component | `src/renderer/components/ui/*` | Follow [components/ui/ai.prompt.md](../src/renderer/components/ui/ai.prompt.md); no raw hex, no new `.css` in `ui/`. |
| Introduce a per-brand visual difference | (out of scope — brands share one DS) | Not supported today; if ever needed, branch at the semantic token layer, never inline `if (brand)`. |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `globals.css` `@theme` tokens (the colors + radius SSOT) | every `.tsx` utility + `.css` `var(--color-*)`/`var(--radius-*)` consumer, primitives in `components/ui/`, this doc |
| `globals.css` `:root` semantic/alias vars | their `var(--*)` consumers, this doc |
| `globals.css` `[data-theme="dark"]` overrides | matching `:root` semantic/component token definitions, `ThemeProvider`, Settings Appearance, this doc |
| `tailwind.config.js` (non-color settings: blur/animation/container) | the utilities that consume them, this doc |
| `code-styles.css` `--syntax-*` tokens | all `var(--syntax-*)` consumers (`markdown-render.css`, `Message.css`, `OverlayFileViewer.css`, `SkillsContentView.css`, `InlineFilePreviewPanel.css`, `ImportVscodeMcpServerView.css`, `CodeBlockContent.tsx`), this doc |
| A primitive's API/variants | [components/ui/ai.prompt.md](../src/renderer/components/ui/ai.prompt.md) Key Files + all consumers |
| `scripts/design-system-baseline.json` | Only ratchet **down**; growth is forbidden locally by `check:design` and, once the base branch has a baseline, in CI by the base-branch `--reference-baseline` comparison |
| `docs/dark-mode-governance.md` or dark-mode PRD / Tech Doc rules | `scripts/check-dark-mode-governance.js`, `package.json` `check:dark-mode`, `.github/workflows/pr-design-system.yml`, `docs/design-system/README.md`, this doc |

## Anti-Patterns
- Do NOT treat Tailwind as "the design system" — it is the token/utility layer only.
- Do NOT add raw hex colors in `.tsx`; use tokens / utility classes. The gate blocks growth.
- Do NOT add new `.css` files under `src/renderer/` (especially under `components/ui/`).
- Do NOT half-adopt UI deps: `cva` is the adopted variant standard for `Badge` — use it for new
  variant APIs (do not reintroduce inline variant maps). The `@radix-ui/*` packages were removed
  as dead deps; do not re-add a headless library without deliberately adopting it across the
  primitive layer.
- Do NOT build a `Button` component or a `cva` button recipe — buttons use the global `.btn-*`
  CSS classes (designer-owned). The `cva` `button.tsx` was removed; do not resurrect it.
- Do NOT fork visuals per brand inside components; brands share one DS (fork only at the
  semantic token layer if a brand identity is ever introduced).
- Do NOT implement dark mode by scattering new `dark:` utility pairs. The system-level strategy is
  token-first: update semantic/component tokens in `globals.css`, and use `dark:` only for localized
  migration exceptions tied to `[data-theme="dark"]`.
- Do NOT add raw warning/success/danger `rgba(...)` state colors in renderer UI. Add or reuse
  semantic status surface/border tokens in `globals.css`; `check:dark-mode` rejects new raw status
  RGBA lines in PR diffs.
- Do NOT change dark-mode development, audit, CI, or review expectations without updating
  `docs/dark-mode-governance.md` and the `check:dark-mode` wiring in the same PR.
- Do NOT treat page-specific classes as shared primitives. Settings toggles must use
  `.toolbar-toggle-wrapper` + `.toolbar-toggle-track`; retired page-specific toggle copies
  are not a shared control contract.
- Do NOT add entries to `design-system-baseline.json` to raise a baseline — baselines only go down.
- Do NOT migrate to a different component library expecting to "gain governance"; governance is this doc + the gate, independent of the stack.

## Roadmap (tracked tasks)
**Done (this governance effort):**
- ✅ **Enforcement broadened to three layers + a landed reference (2026-06-25).** Answered "how do we
  make sure future UI development uses this design system, and how is a PR verified against it?" by
  turning the single CI gate into a three-layer defense and shipping a repo-resident reference for
  humans and AI.
  - **A — ESLint editor guard.** Added a `no-restricted-syntax` rule to `eslint.config.mjs` scoped to
    `src/renderer/**/*.{ts,tsx}` that errors on a raw hex color literal (string **and** template
    forms) the moment it is typed. `ignores` mirror the gate's `SANCTIONED_TSX_REGIONS` + test files;
    the `(?<!&)` lookbehind matches the gate's `countHexInText` regex byte-for-byte, so it reports a
    strict subset of what the gate counts (0 false positives on current code, proven end-to-end:
    a probe hex in a feature file ERRORS, the same hex in `index.tsx` is correctly IGNORED). Note: the
    repo's `npm run lint` is independently noisy/non-gating — A's value is the **per-file editor
    signal**, not `lint` exit 0.
  - **B — pre-push hook (local opt-in).** The repo's push-protection ruleset **restricts
    committing files under `.husky/`** (a tracked hook was rejected by `GH013` "File path is
    restricted"), so the pre-push gate ships as a documented one-time local opt-in instead of a
    tracked file: `printf '#!/bin/sh\nnpm run check:design\n' > .git/hooks/pre-push && chmod +x
    .git/hooks/pre-push`. A native git hook needs no husky and works immediately. **CI is the
    always-on hard gate** regardless — this layer is a developer convenience, not the backstop.
  - **D / landed docs — `docs/design-system/`.** Shipped `README.md` (English Markdown: token tables,
    component catalog, visual language, governance, **how-to-use** token-first table, **how-to-verify**
    three-layer defense) + `design-system.html` (self-contained English visual report dogfooding the
    live tokens). These are the canonical reference both this doc and `components/ui/ai.prompt.md` point
    developers and AI at. Verified gate-neutral (`docs/**` is outside the renderer scope): `0 / 68 /
    0 / 0 / 0 / 0 / 93 / 0` unchanged.
- ✅ **Radius-token governance — `--radius-*` SSOT + `.css` tokenization + ratchet gate (2026-06-25).**
  Closed the user's "why not clean up the radius oddities (3px scrollbar, 10/16/26px) in the frozen
  legacy CSS" question by giving corner radius the same SSOT treatment as color.
  - **r1 — SSOT.** Moved the radius scale out of `tailwind.config.js`'s `borderRadius` block into a
    native Tailwind v4 `@theme` block in `globals.css` (`--radius-sm` 2px / `--radius` 4px DEFAULT /
    `-md` 6px / `-lg` 8px / `-xl` 12px / `-2xl` 16px / `-3xl` 24px / `-full` 9999px). `@theme` generates
    BOTH the `rounded-*` utilities (var-backed, computed-identical) AND the `.css` `var(--radius-*)`
    variables. Off-scale one-offs that earned a token live in `:root`: `--radius-scrollbar` 3px,
    `--radius-bubble` 20px (message bubbles / glass cards), `--radius-card-xl` 36px (onboarding card).
  - **r2 — tokenize `.css`.** Repointed **585** raw `border-radius` literals across **58** `.css` files
    onto `var(--radius-*)`: 539 byte-identical (8→lg, 12→xl, 4→DEFAULT, 999px/9999px→full, multi-corner
    each part, `calc(6px/…)`→`calc(var(--radius-md)/…)`) + 46 off-scale snapped (pills→full; the 20px/36px
    families → the new `:root` tokens; minor drift 10/9→8, 14→12, 5→4, 1→2). Geometric `50%` (circles) and
    `0` are left raw (not gate-countable). `code-styles.css` (the syntax registry) is excluded.
  - **r3 — gate.** Added an 8th ratchet metric `cssBorderRadiusLiterals` (frozen at **0**): counts raw
    `px`/`rem` `border-radius` literals (and corner longhands like `border-bottom-right-radius`) in renderer
    `.css`, excluding `var(--radius-*)`, `0`, `%`, `calc(var() …)`, and `--radius-*:` token definitions (CSS
    comments stripped first). This caught one corner longhand r2 had missed — `buddy.css`
    `border-bottom-right-radius: 4px` → `var(--radius)` (4px, byte-identical). +8 gate unit tests (59 total);
    end-to-end FAIL→green proof. Verified: full vitest **1240 files / 29749 tests** green; `check:design`
    `0/68/0/0/0/0/0/93/0`; `typecheck`; `build:vite`. End-state gate baseline now carries the raw brand RGB(A) `0` and radius `0`.
  visual style is the project-wide SSOT; `StartupPage`, `SignInPage`, and `DataLoadingPage` were
  aligned to it. **Card geometry:** `.signin-card` and `.data-loading-card` `border-radius` `20px` →
  `8px` (the canonical card radius — shadcn `Card` is `rounded-lg`/8px); `.data-loading-card`'s legacy
  modal shadow `0 12px 48px /.15` → the glass-card system elevation `0 4px 16px /.08`. **Tokenization:**
  the 3 raw slate `rgba(203,213,225,.3)` literals (Startup progress track, DataLoading progress track +
  time-section divider) → `var(--color-border-subtle)` — **byte-identical** (the token *is* that rgba),
  zero visual change. **Off-palette purple dropped:** the SignIn status avatar gradient
  `from-primary-500 to-purple-600` → `from-primary-500 to-primary-600`, so both pre-auth avatars share
  the on-system sky/`accent` gradient. **Kept (already on-system):** warm-gradient page backgrounds,
  `accent-gradient` progress bars / DataLoading avatar, `border-strong` card borders, success/warning/
  danger ramps, and all buttons on `.btn-*` (black/red/white). The pages keep their distinct
  full-screen centered-card layout — "unify visual style" means shared tokens/primitives/conventions,
  not making pre-auth look structurally like the Agent shell. Gate unchanged `0/68/0/0/0/0/93`
  (rgba isn't hex-counted; `purple` wasn't gated — the value was off-*system*, not off-*gate*); 102
  page tests, `typecheck`, `build:vite` all green. Verified by rendering the before/after cards.
  ladder into tokens.** Resolves the last two style-audit debts. **(1) Dialogs:** the legacy
  `.modal-*` overlay/container shell (`Modal.css`, 652 LOC) was retired — every former consumer
  (Archive / Delete / Duplicate / Rename overlays, `TaskFormModal`, `UserInputModal`) now renders
  through `components/ui/dialog.tsx`, so there is **one** dialog engine (own Escape / stacking /
  focus). `Modal.css` shrank to the standalone New-Task form fields (47 LOC); `UserInputModal.css`
  shed ~140 lines of dead `.user-input-modal .modal-*` / `.btn-*` rules orphaned by the migration
  (its footer now uses the global `.btn-*`). New overlay coverage tests keep every migrated `.tsx`
  ≥90% on all four metrics. **(2) Borders:** the `.075/.1/.12/.2` + slate `.3/.8` rgba ladder
  (~155 declarations across ~38 CSS files) was converged into the `--color-border-*` tier tokens
  (context-aware sweep — border declarations only, box-shadows left intact), and the canonical
  `--color-accent-ring` replaced the outlier blue focus ring. Byte-identical except two
  imperceptible, intentional deltas: the `.1`→`.12` 1px-hairline merge and the New-Task blue→sky ring.
- ✅ **Unified all buttons onto the designer's `.btn-*` CSS system; removed the `cva` `Button`.**
  Every `<Button variant size>` consumer was migrated to a native `<button className="btn-{role}">`
  (`.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-dark`/`.btn-ghost`), and `button.tsx` +
  its test were deleted. This resolves the "two button systems" debt (`cva` Button radius-6/40px
  vs designer `.btn-*` radius-8/32px): there is now **one** button contract, owned by design. `cva`
  remains the standard for `Badge` only. (`.btn-*` is block-level `display:flex`, so a solo button
  in a block parent that must hug its content uses a `w-fit` utility.)
- ✅ **Repainted the button system to black / red / white — dropped sky (designer decision, 2026-06-24).**
  Per the designer's screenshot (primary = black, destructive = red, secondary = white), every button
  surface was recolored: base `.btn-primary` (was a **sky gradient**) → black `var(--color-warm-900)`
  (hover `warm-800`); `.btn-secondary` hover (was a sky border/text/ring) → near-black + neutral ring;
  `.btn-icon` hover/active (was sky) → `neutral-100` bg + `warm-900` text; `.btn-dark` aligned to the
  same `warm-900` so the app has **one** black. The three prominent primary CTAs — `.new-chat-button`,
  `.new-agent-button`, and the chat composer `.send-btn` (via `--new-chat-btn-bg`) — were likewise
  repainted from sky gradients to black. `.btn-danger` (red, `danger-600`) was already correct.
  **Scope boundary:** sky/`accent` was deliberately **kept** for all **non-button** affordances
  (active nav highlight, focus-visible rings, links, `::selection`, agent-list selection, drag-drop
  zones, checkboxes) — only button rule-blocks changed. All edits were `var()`→`var()` / `rgba()`→
  `rgba()` (no hex literals), so the gate stayed `0/68/0/0/0/0/93`. Verified by compiling `globals.css`
  through the real Tailwind v4 pipeline and screenshotting the repainted buttons. *(`.btn-dark` became a
  semantic twin of `.btn-primary` here; it was consolidated away in the next entry.)*
- ✅ **Consolidated `.btn-dark` into `.btn-primary` — one black button (2026-06-24).** After the repaint
  left `.btn-dark` and `.btn-primary` visually identical (both `warm-900` bg, `warm-800` hover, same box
  model) save for `.btn-primary`'s subtle neutral drop-shadow, the duplicate role was removed: the **4**
  `.btn-dark` consumers — `SignInPage` (MS sign-in), `ReauthDialog` (re-auth sign-in), `DoctorInquiry`
  ("Submit Diagnosis"), `AgentQuestionForm` ("Submit Answer"), all genuine primary/submit actions —
  migrated to `.btn-primary`, and the `.btn-dark` rule blocks were deleted from `Common.css`. The only
  visual delta: those 4 buttons gain the standard primary drop-shadow, aligning them with every other
  primary button. The button role set is now `.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-ghost`/
  `.btn-icon`/`.btn-close` — **`.btn-dark` is retired**. No test referenced `.btn-dark`; `typecheck` +
  `build:vite` green; gate stayed `0/68/0/0/0/0/93`.
- ✅ **Adopted `cva` as the variant standard** — `Badge` uses inline-free `cva` variants with
  **byte-identical class output** (zero visual change), proven by class-equivalence unit tests.
  *(`Button` was also converted to `cva` in this effort, then later removed entirely in favor of
  the designer `.btn-*` CSS system — see the button-unification entry above.)*
- ✅ **Removed `ExperimentTag.css`** — converted to Tailwind utilities (pixel-faithful) with a
  global `.experiment-tag` hook for dark-only contrast remapping; `components/ui/` is now `.css`-free
  (`uiDirectoryCssFiles` baseline ratcheted 1 → 0, `rendererCssFiles` 73 → 72).

**Next (remaining governance work):**
1. **Grow the semantic token layer** in `globals.css` (`:root` semantic tier + `@theme` status ramps) so dark mode / per-brand theming
   become a token switch, not a component rewrite.
   - ✅ **Status colors (first slice, done):** added `danger` / `success` / `warning` semantic
     tokens, **aliased** to the Tailwind `red` / `green` / `amber` ramps
     (`danger: colors.red`, …) so every shade is **byte-identical** to the raw palette (zero
     visual change). Proven by compiling the real `@config` pipeline and asserting the generated
     OKLCH equals the palette, plus a rendered screenshot. The semantic primitives reference
     them: `badge` (`destructive`/`success`) and `Toast` (success/error/warning); buttons get the
     same status colors via the `.btn-danger` CSS class. **Aliasing (not hardcoded hex) is the
     rule** — a hex literal would drift from Tailwind v4's OKLCH palette.
     - ✅ **Adopted across ALL feature code (2026-06-20):** migrated every raw `red` / `green` /
       `amber` Tailwind class to `danger` / `success` / `warning` (byte-identical aliases),
       dropping raw status-class usage **58 → 0**. The first slice migrated 10 already-covered
       components; the final 3 (`AgentMcpServersTab`, `DoctorStatusIndicator`, `ShortcutRecorder`)
       were brought to ≥90% coverage first (added a fake-timer test for `DoctorStatusIndicator`'s
       auto-tooltip `force` path), then migrated. The `rawStatusPaletteClasses` ratchet metric is
       now frozen at **0** — any new raw status class fails the gate.
     - ✅ **`badge.warning` unified onto the `warning` (amber) token (2026-06-20):** changed
       `bg-yellow-600` → `bg-warning-600` so the primitive references the canonical token. **Zero
       visible impact** — the badge `warning` variant is **unused** in feature code (verified by
       grep), so this only removes the last status-token drift in a primitive. (A render confirmed
       yellow-600 is gold vs amber-600 orange — a real delta — so the **live** `text-yellow-600`
       warnings in `SignInPage`/`ReauthDialog` were initially **left as-is** pending a sign-off on the
       gold → orange visual change. **Resolved in Phase 29 (2026-06-22):** with owner sign-off, all 16
       `yellow-*` occurrences migrated to semantic `warning-*` — see the Phase-29 roadmap entry below.)
   - ✅ **Semantic alias tier established — Option A "semantic first, dark later" (2026-06-21):**
     owner chose to build the semantic layer now and defer dark mode. Added a CSS-variable semantic
     tier to `globals.css` (`--color-text-muted`, `--color-accent`/`--color-accent-strong`/
     `--color-accent-gradient`, `--color-bg-app`/`--color-bg-muted`/`--color-bg-sidebar`,
     `--color-border-subtle`, `--color-danger-surface`/`--color-danger-text`), each **byte-identical**
     to the value it replaces (proven by resolving every `var()` chain to its original literal; zero
     visual change). **Adopted, not inert:** the live `--layout-*` / `--nav-item-*` / `--new-chat-btn-*`
     / `--logout-btn-*` ad-hoc vars (all consumed inside `globals.css`) were rebased onto the tier, so
     dark mode later overrides **only this tier**. **Inert drift removed in the same pass:** the
     `surface.*` + `glass.*` Tailwind color groups (0 uses) and 10 dead ad-hoc nav/chat vars (0 uses).
     Ratchet `cssHexLiterals` 1022 → 1020. Why CSS-vars not Tailwind: a `var()`-backed Tailwind color
     breaks the `/<opacity>` modifier (the same reason `warm` is literal hex).
   - ✅ **Semantic taxonomy drafted + chrome adoption Phase 1 (2026-06-21):** authored the full
     **intent vocabulary** (59 tokens / 7 families — Text, Surface, Brand-warm, Border, Accent, Status,
     Overlay; Core 26 / Extended 33), each with a light value → primitive, a planned dark value, and the
     current literal it replaces. Owner-approved decisions: **neutral** is the primary gray + **warm** a
     brand-warm subfamily; **no `info` status family** (defer); dark mode via **same-ramp flip** (reuse
     primitives, re-point only the semantic tier). First execution slice grew the tier with 3 tokens
     (`--color-text-default` = body/control text, `--color-text-subtle` = placeholder/hint,
     `--color-accent-gradient-strong` = CTA hover) and **adopted accent/text/danger tokens across the
     `globals.css` chrome** (`.chat-input`, `.send-btn`, nav/agent-list active states, logout hover,
     attachment-card hover, embedded-browser progress) — **byte-identical** (every rewritten `var()`
     chain resolves to its original literal; full 1172-file suite green). The scoped rewrite **guards
     every `--color-*:` definition line** so a usage swap can never turn a token into a self-reference
     (the historical `--color-accent: var(--color-accent)` trap). Ratchet `cssHexLiterals` 1020 → 1001.
   - ✅ **Accent adoption broadened across feature `.css` — Phase 2 (2026-06-21):** migrated **all 177
     raw `#0ea5e9`/`#0284c7`/`#0369a1` brand-accent literals across 31 renderer `.css` files** to the
     semantic tier (`var(--color-accent)` / `--color-accent-strong` / the new `--color-accent-stronger`
     = sky-700), and collapsed the two exact `135deg` accent gradients onto `--color-accent-gradient` /
     `--color-accent-gradient-strong`. **Byte-identical by definition** — each `var()` is defined in
     `:root` as the exact hex it replaces (verified by resolving every token; `90deg` gradient stops were
     rewritten in place so off-ramp colors like `#06b6d4` are preserved). **Verified non-syntax:** a
     selector sweep confirmed **zero** accent literals live under `hljs`/`token`/`prism`/`cm`/`monaco`
     syntax selectors, so no code-viewer color is wrongly coupled to brand accent — every hit is chrome
     (buttons, focus rings, active nav/list, links, spinners, result-row hovers). Ratchet `cssHexLiterals`
     1001 → **824** (−177). Full 1172-file suite + `typecheck` + `build:vite` green.
   - ✅ **Status colors aligned to Tailwind v4 OKLCH — Option B (2026-06-21):** the owner chose to fix
     the historical split where `.css` used Tailwind **v3 hex** (`#dc2626`, …) while `.tsx`
     `bg-danger-*`/`success-*`/`warning-*` compiled to **v4 OKLCH** — the same semantic rendered as two
     different colors. Added a primitive **status ramp tier** to `globals.css` declared in **OKLCH**
     (`--color-danger-*` 9 shades / `--color-success-*` 8 / `--color-warning-*` 10 = **27 tokens**, only
     the shades in live use — no inert tokens), sourced from the exact `tailwindcss@4.2.2/theme.css`
     values. Migrated **all 275 raw v3 status hexes across the `.css` layer** to these tokens, so `.css`
     now resolves to the **identical** color the components already render (single source of truth, no
     more v3/v4 drift) — proven by rasterizing all 27 tokens in Chromium (`27/27` match the v4 palette
     sRGB). Two correctness wins folded in: (1) **fixed the emerald-as-success bug** — 4 surfaces
     (`.sub-agent-status-badge.success`, `.tool-status-icon.completed`, …) wrongly used Tailwind
     **emerald**; remapped to the canonical **green** `success` ramp (the most visible shift); (2)
     **`#6b3900`** (non-standard warm-brown, 12×) merged to its nearest standard amber by ΔE2000
     (**warning-900**, ΔE 6.85 vs amber-800's 10.73), per the owner's "historical mistake → nearest
     amber" call. Also re-pointed `--color-danger-text`/`--color-danger-surface` onto the new ramp
     (`var(--color-danger-800)` / `color-mix(... danger-100 80%)`). **Safety audit:** 0 status hexes
     live under syntax selectors (`hljs`/`token`/`prism`/`cm`/`monaco`) or in `data-URI`/SVG strings —
     every migrated hex is App chrome. OKLCH is **not** counted by the hex gate, so the 27 new defs cost
     0; ratchet `cssHexLiterals` 824 → **548** (−276). Full 1172-file suite (28288 tests) + `typecheck`
     + `build:vite` + `check:design` 548/548 green. Visual record: `files/status-color-executed.html`.
   - ✅ **Exact-match gray/text token adoption — byte-identical (2026-06-21):** swept the remaining
     `.css` literals that equal a defined token value, so chrome references the token instead of a raw
     hex. (1) **8 `color: #1a1a1a`** body/control-text declarations → `var(--color-text-default)` — a
     **semantic** adoption that seeded the dark-mode tier (text-default is re-pointed by
     `[data-theme="dark"]`); the one `#1a1a1a` gradient **background** stop in `Message.css` was deliberately left
     (a dark decorative surface, not text). (2) **25 exact cool-neutral usages** (`#f5f5f5`×9 → `-100`,
     `#d4d4d4`×8 → `-300`, `#a3a3a3`×4 → `-400`, `#737373`×2 → `-500`, `#404040`/`#262626` → `-700`/`-800`)
     → `var(--color-neutral-N)` **primitive** refs (fixed values, byte-identical). Includes the two
     `@media print` code-block **container backgrounds** in `markdown-render.css` (chrome, not syntax
     token colors — zero `.hljs-*` rules in the file). All 7 mappings proven byte-identical against the
     `:root` definitions; the perl pass guards `--color-*:` definition lines (no self-reference). Ratchet
     `cssHexLiterals` 548 → **515** (−33). Full 1172-file suite (28288 tests) + `typecheck` + `build:vite`
     + `check:design` 515/515 green; no test asserts a migrated hex.
   - ✅ **Sanctioned secondary accent (violet / indigo) token tier — Option C, byte-identical (2026-06-21):**
     App chrome carried a second accent family distinct from the Sky primary — **indigo** for secondary
     interactive surfaces (schedule list, file-viewer chrome, paste-to-workspace dialog, context/reasoning
     badges) and **violet** for decorative gradients and reasoning / agent badges. Per the owner's decision
     (**Option C**: sanction it rather than fold into Sky or neutral), declared it as a real tier instead of
     scattered raw hex. Added a **violet + indigo primitive ramp** to `globals.css` (`--color-violet-500/600`,
     `--color-indigo-50/500/600/700/800` = exact v3 hex) and a **5-token semantic tier**
     (`--color-accent-secondary` → indigo-500, `-strong` → indigo-600, `-deep` → indigo-700, `-surface` →
     indigo-50, `-gradient` → the 135° violet pair). Migrated **35 saturated + 3 tint purple hexes** plus
     **15 `rgba()` washes** across ~10 feature `.css` files (Agent, AgentChatCreation, Header, Message,
     NavItem, OverlayFileViewer, PasteToWorkspaceDialog, ServerCard, retired sub-agent model CSS, VoiceInputButton)
     to these tokens. **Byte-identical:** every semantic `var()` resolves to its original hex (`11/11`
     proven by a resolver), and each `rgba(R,G,B,a)` wash → `color-mix(in srgb, var(...) p%, transparent)`
     renders to the **exact** original RGBA (`4/4` rasterized in Chromium — `color-mix` with `transparent`
     is a non-premultiplied sRGB identity). **Carve-out (owner):** the 3 JSON **syntax-highlight** lines
     (`.json-key` `#4f46e5`, `.json-boolean`/`.json-null` `#7c3aed` in `OverlayFileViewer.css`) stay raw hex
     — a deliberate code-viewer theme, **not** brand chrome — and are intentionally **out of scope** (they
     still count toward the gate). Ratchet `cssHexLiterals` → **484**. _(This also corrected a latent
     baseline bug: the Phase-24→25 ratchets had been writing a **stray top-level `cssHexLiterals` key** the
     gate never reads — it evaluates `metrics.cssHexLiterals`, which had stayed frozen at 548. The stray key
     is removed and `metrics.cssHexLiterals` set to the true current **484**.)_ Full 1172-file suite (28288
     tests) + `typecheck` + `build:vite` + `check:design` 484/484 green; no test asserts a migrated hex
     (the two `#EEF2FF` test assertions target a `.tsx` inline style left untouched this round).
   - **Deferred (same-family follow-up):** the `.tsx` purple — Tailwind `violet`/`purple` utility classes
     (Toast update-type and App/SignInPage `to-purple-600`) and **3
     inline hexes** (`FileTypeIcon.tsx`, `SyncSettingsContentView.tsx`, `SubAgentToolCallView.tsx`,
     — incl. an SVG `stop-color` and an icon `color` prop needing `var()`
     verification) — are an independent slice (different components than the migrated `.css`), coverage-gated
     and not done blind this round.
   - ✅ **Off-ramp gray nearest-tier snap — family-aware, design-gated visual (2026-06-22):** swept the
     `.css` gray hexes that are **close to but not exactly equal** to a neutral/warm ramp tier (the
     "off-ramp" greys that exact-match adoption in the prior round could not touch) and snapped each to
     its nearest ramp token. Unlike the prior byte-identical phases this is an **intentional, slight
     visual change** (authorized by the owner's merge-to-nearest directive, consistent with
     the de-blue governance). **Rule:** a hex is "gray" when its channel spread (max−min) ≤ 18/255;
     achromatic / cool greys snap to the **neutral** family, warm greys to the **warm** family (near-black
     warm greys whose warmth is imperceptible at very low L snap to `neutral-900`), and within a family the
     nearest tier is chosen by Lab ΔE. Migrated **27 hexes / 85 occurrences** across 22 feature `.css`
     files (heaviest: `Message.css`, `SkillsContentView.css`, `Agent.css`); max ΔE **5.85** (`#333333` →
     `neutral-700`). **Carve-outs (13 hexes / 39 occ, kept raw):** editor code-surface theme (`#1e1e1e`,
     `#252526`, `#282c34`, `#21252b`, `#1d1d1f` — same rationale as the JSON-syntax carve-out), sky/info
     tints (`#f0f9ff`/`#f8faff`/`#f0f5ff` — separate accent workstream), status tints (`#fef3f2` danger,
     `#fff6ee` selection), pure black (`#000000` — context-dependent: SVG fill / `accent-color` / `@media
     print` text), and the **cinema decorative gradient pair** (`#1a1a1a` + `#0a0a0a` in `Message.css`'s
     `linear-gradient(145deg,…)` — snapping both to `neutral-900` would **collapse** the gradient to a flat
     color, so both stops stay raw). A dedicated collapse-risk scan confirmed that gradient was the only
     multi-stop line at risk; the other 84 lines are safe 1:1 swaps. Ratchet `cssHexLiterals` 484 → **399**
     (−85). Full 1172-file suite (28288 tests) + `typecheck` + `build:vite` + `check:design` 399/399 green;
     no test asserts a migrated hex. Visual record: `files/offramp-gray-executed.html` (before/after swatch
     table with per-snap ΔE, light + dark).
   - ✅ **Carve-out resolution — the 13 Phase-27 carve-outs, fully tokenized (2026-06-22):** resolved every
     gray-adjacent hex that the off-ramp snap deliberately left raw, each with the *right* governance action
     rather than a blind ramp-snap (owner approved the per-group proposal). **39 occurrences / 13 hexes → tokens;
     +9 new token defs.** (A) **Code-surface tier** — a new theme-independent fixed-dark group
     `--color-code-surface` (`#1e1e1e`, also absorbs the near-identical `#1d1d1f`), `-raised` (`#252526`),
     `-onedark` (`#282c34`) + `-onedark-raised` (`#21252b`) for the One Dark file viewer; these stay dark in
     light mode by design (editor-theme chrome, same rationale as the JSON-syntax carve-out), so they are NOT
     folded into the neutral ramp. *(Superseded by R1, 2026-06-23: these moved into the independent syntax
     registry as `--syntax-surface*` and the `--color-code-surface*` defs were removed from `globals.css`.)*
     (B) **Info surface** — `--color-info-surface` (`#f0f9ff` = sky-50, 7 occ) +
     `--color-info-surface-subtle` (`#f8faff`, the paler SayHi `:hover` step, kept distinct so hover≠active);
     `#f0f5ff` folds into info-surface (ΔE 2.70, the one intentional shift). (C) **Danger** — `#fef3f2` →
     existing `--color-danger-50` (red-50, ΔE 0.67); deliberately NOT the translucent `--color-danger-surface`.
     (D) **Selection** — `#fff6ee` → new `--color-selection-surface` (a dedicated role: neither neutral nor
     status; warm-50 was too pink at ΔE 3.5). (E) **Pure black** — new `--color-black` primitive (mirror of
     `--color-white`); all 9 `#000000` (icon `fill` / native `accent-color` / print text / Header title) →
     `var(--color-black)`, byte-identical; `rgba(0,0,0,…)` left untouched. (F) **Cinema gradient** — added
     `--color-neutral-950` (`#0a0a0a` = exact Tailwind neutral-950), extending the ramp one tier so the
     previously-collapsing `image-gallery` gradient is now
     `linear-gradient(145deg, var(--color-neutral-900), var(--color-neutral-950))` — two **distinct** tiers,
     tokenized without collapse. **Bonus fix:** defining `--color-neutral-950` also repaired
     `CompanionCard.tsx`, which already referenced the (previously undefined) token — its dark-card background
     was silently failing. **Gate note:** new token *def* hexes count toward `cssHexLiterals` (the gate counts
     hex anywhere, not just usages), so keep hex OUT of token comments. Net `cssHexLiterals` 399 → **369**
     (−39 migrated usages, +9 new token defs = net −30). Full 1172-file suite (28288 tests) +
     `typecheck` + `build:vite` + `check:design` 369/369 green; no test asserts a migrated hex. Visual record:
     `files/carveout-merge-executed.html`.
   - ✅ **Status `yellow` → `warning` (amber) — drift cleanup (2026-06-22):** the off-ramp/status work
     governed `red→danger`, `green→success`, `amber→warning`, but raw Tailwind **`yellow-*`** classes had
     slipped through unnoticed (the `rawStatusPaletteClasses` regex matches `red|green|amber`, NOT `yellow`,
     so they were never counted). Migrated all **16 occurrences across 2 files** — `SignInPage.tsx` (the
     "Token refresh needed" expired-profile card: title dot, card bg/border/hover, avatar bg, sub-copy,
     "⚠ Expired"; plus the sign-in countdown's *warning* state where `timeLeft > 60s`, since `≤ 60s` is
     already `danger`) and `ReauthDialog.tsx` (the footer hint strip) — from `*-yellow-N` to the **semantic
     `*-warning-N`** (same scale step). Because the `warning` token aliases **amber**,
     this *is* "yellow→amber", but expressed via the sanctioned semantic name — using raw `amber-*` would
     have raised `rawStatusPaletteClasses` above its 0 baseline. It is a small, intended visual shift
     (Tailwind yellow hue ~66–103 → amber hue ~46–95, warmer/more orange), consistent with the Decision-3
     "yellow → warning" call. **className-only** (no logic/branch change), and both files were already in the
     PR diff, so coverage is unaffected; `check:design` stays 6/6 green with `rawStatusPaletteClasses` 0/0
     (no baseline change — neither `yellow` nor `warning` is matched by that regex *at the time*). typecheck +
     build:vite + full 1172-file / 28288-test vitest all green. (`task item`'s "yellow bullet" test is only
     a comment — the component has no `yellow-*` class.) Visual record: `files/yellow-amber-executed.html`.
   - ✅ **Gate hardening — `yellow` folded into the status-palette ratchet (Phase 30, 2026-06-22):** the
     follow-up the Phase-29 entry flagged. Extended `countRawStatusClassesInText`'s regex from
     `(?:red|green|amber)` to `(?:red|green|amber|yellow)` so raw `yellow-*` can no longer slip past the
     `rawStatusPaletteClasses` gate the way it did before Phase 29 (the gate only tracked the three hues that
     had been migrated, leaving `yellow` invisible). `yellow` has no dedicated token — it routes to `warning`
     (which aliases amber), per the Phase-29 decision. Because Phase 29 already cleared every renderer
     `yellow-*`, the live count stays **0/0** and the `rawStatusPaletteClasses` baseline is unchanged — this
     is purely a *future-drift* guard, not a new migration. Updated the metric label/hint + both doc comments,
     and the gate's own unit tests: added a positive `yellow` assertion and narrowed the "ignored hues" case
     to `emerald/rose/blue`. Scope is `scripts/` only (gate + its `.ts` test, both already in the PR diff and
     outside the `src/**` coverage gate); no app code touched. `check:design` 6/6 green; the 43-test gate suite
     + full vitest green.
   - ✅ **`@theme` single source of truth — the centralized color manager (Phase A, 2026-06-23):**
    the structural step the "centralize all color, zero raw hex" directive asked for. Before this,
    color was **triple-track**: `tailwind.config.js` inlined each color *value* into the `.tsx`
    utilities (`.bg-primary-600 { background-color: #0284c7 }`, **not** var-backed), while a
    hand-mirrored `:root --color-*` block independently fed the `.css` layer's `var()` refs — two
    definitions of every brand color, kept in sync by hand (the exact setup that caused historical
    v3-hex↔v4-OKLCH splits). Migrated the 8 families whose two tracks **already agreed** (white,
    black, `primary`, `warm`, `neutral`, `danger`, `success`, `warning`) into a native Tailwind v4
    **`@theme` block in `globals.css`**, which generates **both** the utility classes **and** the
    `--color-*` vars from **one** definition; removed `theme.extend.colors` + the
    `require('tailwindcss/colors')` from the config. **Provably zero visual change:** a resolver
    loaded the real compiled CSS in Chromium and resolved every `--color-*` to its final computed
    color before/after — **0 changed, 0 dropped, 12 correct new exposures** (the full `primary`
    50–900 ramp now reaches `.css` for the first time, plus `danger-400`/`success-300` OKLCH), and
    **0 utility selectors dropped**. Gate accounting: relocating `primary`'s 10 def-hexes from the
    (uncounted) config into the (counted) `@theme` block legitimately added +10 to `cssHexLiterals`,
    **offset** by adopting the 16 now-exposable raw `primary` hexes across 8 feature `.css` files →
    `var(--color-primary-N)` (byte-identical), netting `cssHexLiterals` **369 → 363** (tightened).
    **Deferred on purpose:** `violet`/`indigo` (the secondary-accent customs) stay `:root`-only —
    they are default Tailwind colors whose `.tsx` utilities render the v4 OKLCH default while `.css`
    references a v3 hex (a pre-existing split); unifying them is a small *visual* change, tracked for
    the dark-mode slice. Verified: full vitest 1172 files / 28289 tests green; typecheck exit 0;
    `build:vite` ✓; `check:design` 6/6 green.
   - ✅ **Dark-mode foundation — token-first, selector-driven (2026-07-04):** added app-level
     appearance persistence (`light` / `dark` / `system`), a renderer `ThemeProvider` that writes
     `data-theme`, Electron `nativeTheme.themeSource` sync, selector-driven Tailwind `dark:` via
     `@custom-variant dark`, and the first `[data-theme="dark"]` semantic/component-token override
     block. The first adoption slice covers app chrome, shared settings/header/content surfaces,
     global `.btn-*`, form controls, glass surfaces, and the Settings Appearance page. **Still
     design-gated follow-up:** broader `.tsx` utility-class migration, feature-specific primitive
     surface utilities, and reconciliation of old incidental `dark:` variants. Continue to avoid
     inert semantic tokens ahead of real consumers.
   - ✅ **CIEDE2000 color-snap tool — the nearest-token measurement engine (Phase B, 2026-06-23):**
     `scripts/color-snap.mjs` (run via `npm run snap:colors`) implements the "snap a raw hex to the
     nearest *managed* token" half of the zero-raw-hex directive as a **measurable** operation, so the
     Phase C batch migration has an objective, perceptually-calibrated basis. It parses the
     `@theme`/`:root` token set, lifts every token **and** every scanned literal into a shared
     **CIELAB** space (hex → linear sRGB → XYZ; OKLCH → OKLab → XYZ — so v3-hex and v4-OKLCH tokens
     compare fairly), and ranks candidates by **CIEDE2000 (ΔE2000)**, validated to <1e-4 against all 10
     Sharma, Wu &amp; Dalal (2005) reference vectors. Results bucket by JND: **auto ΔE≤1** (byte/
     sub-perceptual — safe codemod), **qa 1<ΔE≤3** (rewrite + glance), **review ΔE>3** (human). A
     **semantic role guard** classifies the color family by **HSL hue** (not CIELAB hue, where pure red
     sits at ~40° and would mislabel it) + grayness by CIELAB chroma <15, and **forces any cross-role
     nearest match to `review`** so a status color can never silently snap onto a brand ramp. Real-repo
     run: **820 literals (210 distinct) → auto 463 / qa 64 / review 293**; the large `review` count is
     *correct* — it is dominated by genuinely-external colors (VS Code syntax themes and
     file-format identity colors) that Phase C routes to a `--filetype-*` asset namespace rather than mis-snapping onto
     a status ramp. The scanner mirrors the hard gate's two sanctioned-definition exclusions
     (`scripts/check-design-tokens.js`), so it never re-reports a managed token *definition* as drift:
     `styles/code-styles.css` (the `--syntax-*` registry) is skipped whole-file, and the `--token: <value>;`
     definition lines of `styles/globals.css` (the SSOT) are skipped line-level while raw usages (e.g.
     inside an `@layer` rule) still count. Tested by `scripts/__tests__/color-snap.test.ts` (**64 cases**,
     ≥96% on all four metrics — only the conventional CLI-entry guard line uncovered).
     This is the tool Phase C drives for the batch migration.
    - ✅ **Phase C batch migration — slices 1–3 (2026-06-23): 283 `auto`-bucket raw hex → `var(--color-*)`
     tokens.** Drove `color-snap.mjs`'s `auto` bucket (ΔE≤1 + role-match) through aligned codemods that
     reuse the tool's own `HEX_RE` + `snapHex`, so only `auto` literals are touched and token names are
     sourced from `globals.css` (zero dangling refs). **Slice 1** (`dd05634da`): 206 hex across 47
     component `.css` files → tokens; `cssHexLiterals` 363→157. **Slice 2** (`99bc86eee`): 9 `@layer`
     *usage* hexes in `globals.css` (gradient stops, terminal-prompt, `::selection`, high-contrast
     borders, nested `var()` fallback) → tokens, with a skip-definition guard so the `@theme`/`:root`
     SSOT *definitions* stay raw; `cssHexLiterals` 157→148. **Slice 3** (`8db47eca9`): 68 hex across 18
     `.tsx` files (64 inline-`style` values + 4 paired hover handlers) → tokens; `hardcodedHexLiterals`
     457→389. Every slice kept all 6 gate metrics green (ratchet down), passed the full vitest suite, and
     cleared the diff-aware ≥90% coverage gate (68 changed source files). **Remaining Phase C work**
     (future slices): ~89 SVG-attribute hexes (need `style={{ fill: 'var(…)' }}` restructuring — `var()`
     does **not** resolve in SVG presentation attributes), ~29 inline-`style` hexes in under-covered
     `.tsx` (test-then-migrate), the `qa` bucket (64, rewrite + visual glance), and the `review` bucket
     (293, `--filetype-*` asset namespace + human sign-off).
     - ✅ **R1 — independent syntax token registry (2026-06-23, `c56c9ac63`).** Stood up the *second*
     sanctioned color home from the two-registry model: `src/renderer/styles/code-styles.css`, a pure
     `:root` file of 21 self-contained `--syntax-*` tokens for all code-format rendering (editor
     surfaces, code-block bg/text, gutter/line-number, editor accents, inline-code light+dark,
     file-viewer md inline, JSON-viewer theme). Wired via `globals.css` `@import` (loads app-wide + in
     the screenshot window). Repointed **every** consumer to `var(--syntax-*)`: `markdown-render.css`,
     `Message.css`, `OverlayFileViewer.css` (incl. 6 `.json-*` rules), `SkillsContentView.css`,
     `InlineFilePreviewPanel.css`, `ImportVscodeMcpServerView.css`, and `CodeBlockContent.tsx`
     (block bg/text). Deleted the **6 dead** `--code-keyword/string/comment/…` palette vars (no
     consumers; real highlighting is the vendored `oneDark` Prism theme). Gate: exempted the registry
     from the `.css` metrics (`SANCTIONED_REGISTRY_CSS` + `isSanctionedRegistryCss` + a unit test);
     ratcheted `hardcodedHexLiterals` 389→388 and `cssHexLiterals` 148→133. All migrations are
     **value-preserving** (byte-identical render), proven by a Chromium computed-style check against the
     **compiled** CSS (16/16 `--syntax-*` tokens resolve to their original colors). Full vitest
     1179/28481 green; coverage gate ✓; check:design 388/68/0/0/0/133; typecheck + build:vite clean.
     - ✅ **R2 — external-identity tokens (brand / file-type / language) (2026-06-23).** Added the
     sanctioned external colors to the `globals.css` `:root` SSOT — fixed identity colors owned
     by file-format / language convention, which must **never** fold into the
     `primary`/status/neutral ramps: `--color-filetype-{pdf,word,excel,ppt,archive,video,audio,code,data}` (literal hex) +
     `--color-filetype-image` **aliased** to the existing `--color-violet-500` (exact ΔE0 — reused, not
     duplicated), and `--color-lang-{markdown,javascript,typescript,python,css,html}`. Migrated
     icon `.tsx` consumers hex→`var()`, including `FileTypeIcon` `getCategoryColor` (10 returns) and
     `SkillFileViewer` `getFileIconColor` (6 language hexes; the 2 `#9c9c9c` fallbacks **snapped** to
     `var(--color-neutral-400)`, ΔE2.15 — the one intentional shift, unifying the unsupported-file
     fallback gray). **Gate change:** exempted the `globals.css`
     `--token:` DEFINITION lines from `cssHexLiterals` (`SSOT_DEFINITION_CSS` / `isSsotDefinitionCss` /
     `countCssHexLiterals` + 4 unit tests) — the `:root`/`@theme` defs ARE the central manager, so a
     `--color-x: #hex;` def is sanctioned while a raw `color: #hex` usage (incl. `@layer` rules /
     comments) still counts; this mirrors the whole-file `code-styles.css` exemption and ratchets
     `cssHexLiterals` **133 → 85** (the R2 defs land in the now-exempt region with zero gate cost).
     `hardcodedHexLiterals` **388 → 361**. **Byte-identical** (except the documented `#9c9c9c` snap),
     proven by a Chromium check: 27/27 tokens resolve to their exact original colors via SVG `fill`,
     the `filetype-image` alias, and lucide `stroke`/`color`. Full vitest 1189/28679 green; diff-aware
     coverage gate ✓ (71 changed files); check:design 361/68/0/0/0/85; typecheck clean.
     - ✅ **R3 slice-1 — component `.css` near-miss drain (2026-06-23).** Snapped **37 raw hexes across
     15 component `.css` files** to their within-role canonical tokens by CIEDE2000 (ΔE≤5), executing the
     owner's standing policy (snap to nearest managed color; accept the OKLCH-ramp alignment shift;
     only add a new token when the difference is too large). Targets: status reds → `danger-500/600/700`
     (the ~3–4 ΔE legacy-hex↔OKLCH offset the owner's "Option B" chose to eliminate), ambers →
     `warning-100/300`, warm grays (`#333`/`#888`/`#999`/`#4c4137`) → `warm-700/600/400`, neutral
     `#ddd` → `neutral-200`, beiges (`#f6e8dd`/`#ebdbce`) → `warm-accent`, brand `#0067b8` →
     `primary-700`. Two were `var(--x, #hex)` fallbacks → nested `var(--x, var(--color-*))` (valid CSS).
     **Chosen `.css`-first because the coverage gate is `src/**/*.{ts,tsx}` only — `.css` migration has
     zero test burden** — and these 37 ARE the gate-counted `cssHexLiterals` drift, so the metric
     ratchets **85 → 48**. The remaining **48** component-`.css` hexes are genuinely far (ΔE 6–23 — e.g.
     saturated teals, oranges, and a brand cyan) and are deferred to a new-token / explicit-sign-off
     decision. git diff is exactly 37 ins / 37 del (all `#hex`→`var()`); full vitest 1189/28679 green;
     gate 47 tests green; check:design 361/68/0/0/0/**48**.
     - ✅ **R3 slice-2 — in-PR `.tsx` near-miss drain (2026-06-23).** Snapped **78 raw hexes across 23
     already-in-PR `.tsx` files** to within-role tokens by CIEDE2000 (ΔE≤5), same standing policy.
     **Scoped to files already in the PR diff** (already coverage-clean) so the per-file ≥90% gate carries
     **zero new test-writing burden** — the 73 *new* files holding the other ~205 `.tsx` near-misses are
     deferred to test-then-migrate sub-slices. Targets: `#272320`→`warm-900`, `#242424`→`neutral-800`,
     `#ffffff`→`white`, status `#b91c1c`/`#dc2626`/`#ef4444`/`#b42318`→`danger-700/600/500/700`,
     `#f59e0b`/`#92400e`→`warning-500/800`, `#0b6fa4`→`primary-700`, `#8b5cf6`→`violet-500`,
     `#6b5ce7`→`indigo-500`, warm tints→`warm-100/200`, grays→`neutral-400`/`warm-400/500`.
     **Two role corrections** over the raw snap output: (a) pale-red `#fef2f2` (a danger **surface**) was
     mis-classified "neutral" by the grayness heuristic and would have folded into `warm-100` (ΔE4.25) —
     overridden to `--color-danger-50` (ΔE **0.00**, semantically correct); (b) `screenshot/core/**`
     **excluded** entirely (separate BrowserWindow, no `globals.css` → `var()` undefined there).
     **happy-dom border-shorthand trap**: the `.border` getter strips `var()` from a shorthand (returns
     `'1px solid'`), but `.borderColor` longhand exposes it — so affected style tests assert
     `.borderColor` (no weakening; the real browser resolves the shorthand fine). 10 hex assertions
     across 8 test files updated to the `var()` form. `hardcodedHexLiterals` ratchets **361 → 283**.
     Full vitest **1189/28679** green; coverage gate PASS (73 files ≥90%); typecheck exit 0;
     check:design **283**/68/0/0/0/48.
     - ✅ **R3 slice-3 — new-file `.tsx` near-miss drain via test-then-migrate (2026-06-24).** Continuing
     the slice-3 family (earlier committed sub-batches `b44716164` slice-3a + `a3dae68cb`/`14c2a8ca1`/
     `19eb72746` had already drained the in-PR + covered-new-file set **283 → 176**), this batch drained the
     remaining migratable raw `.tsx` hex from **176 → 102** (**~74 hexes across ~17 component files**) by
     **writing real ≥90%-all-four-metrics coverage tests first, then swapping each hex to `var(--color-*)`**
     — the only correct way to clear under-covered files past the per-file diff gate. Parallelised via
     background agents (one self-contained file cluster each); **every** agent diff was personally audited
     (color-string-only, no logic edits, 0 residual hex, re-run coverage, no unexpected `v8 ignore`). Snap
     targets followed the standing policy: `#272320`→`warm-900`, `#FFFBF8`→`warm-50`/`bg-warm-50`,
     `#E2DDD9`→`warm-200`, `#0078d4`→`brand-microsoft-fluent` (byte-identical), achromatic `#888`/`#ddd`→
     `neutral-500/200`, status `#ff4444`/`#e74c3c`/`#dc2626`→`danger-500/600`, `#6b5ce7`→`indigo-500`.
     Components migrated incl. ExternalAgentConnectionConfig, AboutAppContentView,
     Voice settings, McpToolDetailView, NavigationSection, SkillFolderExplorer,
     CreateCustomAgentViewContent, the four agent-editor tabs, MarkdownEditor, and the legacy sub-agent/misc cluster
     (retired sub-agent and catalog forms, ContextMenu, TaskFormModal, SettingsPage). **One legit
     `v8 ignore` kept** (McpToolDetailView's 3 copy handlers are genuinely dead — defined, never wired to a
     control). **`hardcodedHexLiterals` ratchets 176 → 102; baseline frozen at 102.**
       - **Gate false-positive fixed in the same batch:** `countHexInText` was matching the HTML numeric
         entity `&#039;` (in `MentionHighlight.tsx`) as a `#039` color. Added a `(?<!&)` negative lookbehind
         (+2 gate unit tests) so `&#...;` / `&#x...;` entities are excluded — real color hexes are never
         `&`-prefixed. The real gate now correctly counts `MentionHighlight` as **0**.
       - **Typecheck-vs-vitest gap (lesson):** two agent-authored test files passed vitest + coverage but
         had **TypeScript** errors (`vitest`/esbuild strips types, so coverage-green ≠ typecheck-green):
         incomplete `WhisperModelInfo` mocks, a bogus `DownloadProgress` shape, and mock return/param types
         that broke `.mockReturnValue` / `.mock.calls[0][0]`. Fixed with honest, type-correct mocks. **Always
         run `npm run typecheck` on agent-written tests, not just vitest.**
       - **The remaining 102 are a documented carve-out / debt set, not un-migrated drift:** **87**
         `screenshot/core/**` (separate `screenshot.html` BrowserWindow — no `globals.css`, so `var()` is
         undefined; the literal IS the canonical value — needs a screenshot-scoped token layer, R5) + **9**
         a retired MCP catalog view (1752 lines @ ~76% — disproportionate to lift for 8 migratable
         hexes; 1 documented `#3b82f6` debt) + **5** `index.tsx` (entry point @ ~72%, top-level `createRoot`
         side effects) + **1** `MemexMemorySidepaneParts.tsx` (content-policy-excluded, cannot edit).
       - Verified: full vitest **green (exit 0, Phase-18 integrity — NOT scoped)**; diff-aware coverage gate
         PASS (**105 changed source files** ≥90% all four metrics); typecheck exit 0; check:design
         **102**/68/0/0/0/0.
      - ✅ **R5 — governance capstone: hard-zero `.tsx` + bounded carve-out metric (2026-06-24).** The
      two-registry end-state is now **fully enforced**. Two moves:
       - **Retired MCP catalog view drained to zero (coverage-lifted, then migrated).** The catalog view
         (1752 lines) was the last migratable `.tsx` raw-hex holder (9 hexes) but sat at ~76–82% coverage, so
         it could not enter the diff without failing the per-file ≥90% gate. Wrote real integration-style
         coverage tests (drive the real component through mocked external boundaries — router / toast /
         userData / mcpOps) lifting it to **94.28 / 90.78 / 93.42 / 94.38** (stmts/branch/funcs/lines, all
         four ≥90%), **then** migrated all 9 hexes to tokens by the standing nearest-managed-color policy
         (CIEDE2000 via `scripts/color-snap.mjs`): `#272320`→`warm-900` (×5 SVG `stroke`, ΔE0 exact),
         `#16a34a`→`success-600` (ΔE2.45), `#dc2626`→`danger-600` (ΔE3.62), `#ff4444`→`danger-500` (ΔE3.35,
         the "new" badge), and the stray blue `#3b82f6` + `rgba(59,130,246,.1)` skill-tag chip →
         `var(--color-accent)` + `color-mix(… 10%, transparent)` (ΔE9.25 — **not** a new exception but the
         decided Option-B blue→sky de-blue at the hex level). `var()` resolves in SVG `stroke` attrs + React
         inline `style` in Chromium, so all are value-correct. Coverage held **identically** after the swap
         (hex→`var()` adds no branches). **`hardcodedHexLiterals` ratchets 102 → 9 → 0** — a true hard-zero
         across the entire non-sanctioned renderer `.tsx` surface.
       - **7th metric `sanctionedTsxHexLiterals` (bounded at 93).** The remaining raw `.tsx` hex lives in
         three regions that **physically/policy cannot** reference the central `globals.css` token registry
         via `var()`, so a raw literal is the only option — these are forced carve-outs, not discretionary:
         (1) `src/renderer/screenshot/**` (**87**) renders in a **separate Electron BrowserWindow**
         (`screenshot.html`) that never loads `globals.css`, so `var(--color-*)` is undefined there; its
         colors are also predominantly multi-color illustration SVG assets + the user-facing drawing-color
         palette (user content, not chrome); (2) `src/renderer/index.tsx` (**5**) is the React fatal-error
         fallback, whose inline styles must render even when the app (and all its CSS) fails to mount;
         (3) `MemexMemorySidepaneParts.tsx` (**1**) is excluded by the org content-exclusion policy
         (uneditable). Added `SANCTIONED_TSX_REGIONS` / `isSanctionedTsxRegion` (mirroring
         `SANCTIONED_REGISTRY_CSS`): these regions are split out of `hardcodedHexLiterals` into their own
         **bounded** metric, frozen at **93** — they can **never grow** (a probe hex there trips the gate),
         yet aren't mislabeled as migratable drift under the hard-zero metric. +2 gate unit tests (positive:
         a hex in each region is routed to the bounded metric; negative: a normal feature `.tsx` / a non-entry
         `index.tsx` still counts toward hard-zero). Proven end-to-end: a probe hex in a normal `.tsx` trips
         `hardcodedHexLiterals` (0→1, exit 1); a probe hex in `screenshot/` trips `sanctionedTsxHexLiterals`
         (93→94, exit 1); both restore to green.
       - **End-state.** Every raw color in the renderer now lives in exactly one of: the `globals.css`
         `@theme`/`:root` **SSOT** (the central manager — every governed color), the `code-styles.css`
         **syntax registry** (`--syntax-*`, code rendering only), or the **three bounded carve-out regions**
         above. The gate reads **0 / 68 / 0 / 0 / 0 / 0 / 93** (hardcodedHex / rendererCss / uiCss /
         rawStatus / rawBrand / cssHex / sanctionedTsx). No exceptions exist outside these — exactly the
         "no exceptions except syntax highlighting + the physically-forced regions" invariant.
       - Verified: full vitest **green (exit 0, Phase-18 integrity — NOT scoped)**; diff-aware coverage gate
         PASS (AddFromMcp + all changed source files ≥90% all four metrics); typecheck exit 0; gate **51**
         unit tests green; check:design **0**/68/0/0/0/0/**93**.
2. **Brand-color unification — DECIDED: Option B (unify on Sky).** Accepted by the repo owner
   (2026-06-20). A full color audit established that the app's brand chrome is **sky**, not blue:
   - **SKY ≈ 113 spots** = 5 Tailwind `primary-*` + **97 hardcoded `#0ea5e9`/`#0284c7` hexes
     across 16 CSS files** + 11 in tsx. Sky colors the **brand-defining chrome**: the **logo**
     (`LogoSection`), the **active nav highlight** (`--nav-item-color-active: #0ea5e9`,
     globals.css:69), the **primary "New Chat" CTA** (`--new-chat-btn-bg` sky gradient,
     globals.css:72), plus sign-in / startup / loading screens and chat-input focus.
   - **BLUE ≈ 180 spots** = ~88 Tailwind `blue-*` + 76 hex (20 CSS files) + 16 in tsx — mostly the
     React primitives + scattered focus rings, link colors, and modal/message borders. Higher raw
     count, but it does **not** color the identity surfaces. So the logo is consistent with the
     dominant sky chrome; **the blue primitives are the drift to fix.**
   - **Execution = phased, file-by-file, with per-file rendering verification — never big-bang.**
     The `.tsx` migration is gated by the per-file 90% coverage rule, so it lands only in
     already-covered files; `.css` (and `tailwind.config.js`) are coverage-exempt. A token-only
     swap (`primary = blue`) was explicitly rejected: it would recolor only the logo + 2 spinners
     and de-sync them from the still-sky chrome.
   - **Target = the `primary` token (sky), not raw `sky-*`** — migrate `blue-*` → `primary-*` so
     the token becomes the single source of truth (this also retires the documented
     primitive-bypass drift).
   - **Progress:**
     - ✅ **Phase 1 — `components/ui` primitives:** `button.tsx`, `badge.tsx`, `ExperimentTag.tsx`,
       `Toast.tsx` migrated `blue-*` → `primary-*`; equivalence tests updated; 100% covered;
       rendered + verified (sky `#0284c7`). Commit `eefcad18f`.
     - ✅ **Phase 2 — CSS accents:** all **98 Tailwind blue-ramp hexes** (`#eff6ff`…`#1e40af`) →
       sky ramp across **24** renderer `.css` files (coverage-exempt). Diff is exactly 98 value
       swaps by ramp step; rendered before/after + verified. Deliberately **NOT** recolored
       (out of scope, kept): Microsoft Fluent brand (`#0078d4`, `#0067b8`), the Tailwind **indigo**
       accent ramp (`#4f46e5`/`#6366f1`/…), VS Code syntax blue (`#569cd6`), and dark-slate text
       (`#0f172a`/`#111827`). The ad-hoc azure/iOS/Bootstrap/Ant blues
       (`#0066cc`/`#007aff`/`#007bff`/`#1890ff`) were initially deferred here, then consolidated in
       **Phase 5** below. Commit `91d47cc89`.
     - ✅ **Phase 3 — covered feature `.tsx`:** migrated `blue-*` → `primary-*` in the **7** feature
       components that meet the ≥90% per-file gate: `App.tsx`, `ChatInput.tsx`,
       `agentHooks/ApplyHookToAgentsDialog.tsx`,
       `plugin/ApplyPluginToAgentsDialog.tsx` (later removed with the plugin feature), `streaming/MarkdownLink.tsx`,
       `streaming/StreamingV2Message.tsx`. Verified via `check-coverage --staged-only` (7/7),
       163 related tests pass, rendered + verified sky. Commit `b879148d8`.
     - ✅ **Phase 4 — remaining feature `.tsx` debt:** added coverage first, then migrated the
       final **14** previously under-covered files `blue-*` → `primary-*`: `pages/SignInPage.tsx`,
       `auth/ReauthDialog.tsx`,
       `chat/agent-area/AgentList.tsx`, `chat/toolCallViews/SubAgentToolCallView.tsx`,
       `mcp/{ApplyMcpToAgentsDialog,RequestOAuthClientIdDialog}.tsx`,
       `skills/ApplySkillToAgentsDialog.tsx`, `subAgents/ApplySubAgentToAgentsDialog.tsx`,
       `retired-task/{task content,task detail panel,task item}.tsx`. All changed source files
       meet the ≥90% diff-aware coverage gate.
      - ✅ **Phase 5 — ad-hoc secondary-blue consolidation (2026-06-20):** the four ad-hoc framework
       blues that crept into CSS — iOS `#007aff`, azure `#0066cc`, Bootstrap `#007bff`, Ant `#1890ff`
       (**15 occurrences across 8 `.css` files**, coverage-exempt) — were unified onto the brand
       action color **`#0284c7`** (sky-600 / `primary-600`). A render confirmed all four are generic,
       brand-meaningless blues in the same hue family as sky, so the swap is a clean consistency win
       (links / focus borders / selection / fills now read as brand sky). Diff is exactly 15 value
       swaps. **Still deliberately kept** (NOT drift): Microsoft Fluent (`#0078d4`/`#0067b8`), indigo,
       VS Code syntax blue (`#569cd6`), dark-slate text, and the lone `SkillFileViewer.tsx` `#0066cc`
       which is a *file-type category* color, not a brand accent.
      - ✅ **Phase 6 — lock-in via the gate (2026-06-20):** with `blue-*` **and** raw `sky-*` both at
       **0** in renderer `.ts/.tsx`, added a fifth ratchet metric `rawBrandColorClasses` (frozen at
       **0**) that counts raw `blue-*`/`sky-*` utility classes. Brand color must now flow through the
       `primary` token — reintroducing `blue-*` drift or bypassing the token with raw `sky-*` fails the
       gate. Proven end-to-end (a probe `bg-blue-600` trips the gate to exit 1); 7 new gate unit tests
       (35 → 42). This freezes the Phase 1–5 work so it cannot silently regress.
3. ✅ **Retired `resources/design/figma_design.css` (2026-06-20).** Decision: **retire**, not
   integrate — it was a stale Figma export (Segoe Sans / `#322D29` warm ramp) of bare CSS
   declarations with no selectors (not importable) and **0 references** since the repo's first
   commit. Deleted; git history preserves it if the design language is ever revisited (the SSOT
   is the `@theme` block in `globals.css`).
4. **Ratchet `styles/*.css` and the 729 hex literals down.**
   - ✅ **Dead-CSS sweep (2026-06-20):** removed 4 unimported (zombie) `.css` files —
     `ContextMenu.css`, `Form.css`, `StreamingMessage.css` (orphaned v1; superseded by
     `StreamingV2Message.css`), and `leftNavi_design.css` (a bare-declaration Figma fragment
     superseded by `NavItem.css`). Each had **0 imports** repo-wide, so removal is bundler-inert.
     `rendererCssFiles` baseline ratcheted **72 → 68**.
   - ✅ **Lock-in via the gate — CSS hex (2026-06-20):** added a sixth ratchet metric
     `cssHexLiterals` (frozen at **2094**) that counts raw hex colors in renderer `.css`
     files — the `.css` twin of `hardcodedHexLiterals` (729 in `.tsx`). This was the single
     biggest *ungated* color surface (≈3× the `.tsx` count) and the home of the Phase 5
     secondary-blue consolidation, so freezing it stops that work from silently regressing and
     blocks new raw CSS color. Proven end-to-end (a probe `#abcdef` trips the gate to exit 1).
     A legitimate new token bumps the baseline deliberately in-PR (same convention as `.tsx`).
   - **DECIDED — gray consolidation (Option A, owner-approved 2026-06-20):** the cool gray
     families (`gray-*` / `slate-* `/ `zinc-*` classes **and** raw `#111827`/`#1f2937`/… hexes)
     are mapped onto the config's `neutral` ramp (same numeric step: `gray-700` → `neutral-700`).
     This is a deliberate visual change (drops the cool blue tint, biggest at 700–900) — executed
     file-by-file and re-rendered, not blind. Each `.tsx` touch is coverage-gated (≥90%), so it
     stages onto already-covered files exactly like the blue→sky migration. **First slice done:**
     the covered `ui` primitives `button.tsx` / `badge.tsx` / `ShortcutRecorder.tsx` (33 `gray`/`zinc`
     classes → `neutral`; their exact-class equivalence tests updated in lockstep; rendered
     before/after to confirm the subtle de-blue). `slate-*` is already **0**. ⏭️ Remaining: 26
     under-covered feature files (`retired task files`, dialogs, …) — migrate as each reaches ≥90% coverage.
     **More slices done (covered, rendered-equivalent mechanism):** the `retired task` trio
     (`task item`/`task content`/`task detail panel`, 113 classes) and 4 `Apply*ToAgentsDialog`
     siblings (`Mcp`/`Plugin`/`Hook`/`SubAgent`, 48 classes; the `Plugin` dialog was later removed with the plugin feature), plus `UpdateDialog`, `ChatInput`,
     `ProgressIndicator` and `ErrorDetailsDialog` (44 classes), and the
     `card` / `dialog` ui primitives (4 classes, test assertions updated in lockstep),
     `RequestOAuthClientIdDialog` (21 classes), `SubAgentToolCallView` (12) and `ReauthDialog` (7).
     **Tracked debt (reverted, <90% per-file):**
     `ApplySkillToAgentsDialog` (funcs 86.4%), retired agent/MCP catalog views,
     `ModifyMsgConfimOverlay` (76%), `AddScheduleOverlay`
     (81%), and `TaskBoardFilterBar` (branch 77%) — migrate once
     each reaches ≥90%. `McpAuthConsentDialog` (2 classes) has no test at all (untestable as-is).
     **Gray *class* migration is now complete across every covered file** (333 → 35 remaining, the
     35 being the under-covered debt above + the 2 untestable). **Raw gray *hex* — `.css` layer DONE
     (2026-06-21):** all **735** cool-gray-ramp hexes (gray + slate + zinc families) across **43**
     `.css` files repointed by lightness tier → `var(--color-neutral-N)` (added `--color-neutral-50…900`
     to `globals.css :root`, exact config ramp, mirroring the warm playbook). Audited first: **0** were
     inside SVG/data-URI strings (so `var()` is always valid) and only the exact ramp values were
     touched (achromatic shorthands like `#333`/`#ddd` carry no blue tint and are out of scope). This
     is the deliberate Option A de-blue (slate shifts most). Verified: Playwright confirms
     `var(--color-neutral-700)` → `rgb(64,64,64)`, no malformed replacements, `build:vite` + typecheck
     green; **`cssHexLiterals` ratcheted 1807 → 1082**. Before/after render: `phase-css-gray-hex.html`.
     **Raw gray *hex* — `.tsx` covered subset DONE (2026-06-21):** the inline-style gray hexes
     (`style={{ color:'#6b7280' }}`, SVG `fill=`, etc.) DO take CSS vars — Playwright confirms
     `var(--color-neutral-700)` resolves to `rgb(64,64,64)` in inline `style`, `background`, **and**
     SVG `fill` — so they were swapped to `var(--color-neutral-N)` too, which both de-blues AND drops
     `hardcodedHexLiterals` (the `#`-counter ignores `var(...)`). Migrated **29** hexes across the **10**
     files that pass the per-file 90% gate (FileTypeIcon, ArchivedAgentsView, SettingsNavigation,
     CodingAgentToolCallView, SubAgentToolCallView, MemexMemorySidepane, SchedulesSidepane,
     BuddyFloatingWidget, FreSettingUpView, FreWelcomeView); **`hardcodedHexLiterals` 716 → 687**.
     **Raw gray *hex* — under-covered `.tsx` batch DONE (2026-06-21):** the ~198 inline-style gray
     hexes previously tracked as coverage-gated debt were cleared by *first* writing coverage tests
     (≥90% on all four metrics — lines/functions/branches/statements) for each under-covered
     component, *then* swapping its inline cool-gray hexes to `var(--color-neutral-N)`. Migrated
     **150** hexes across **19** files (SchedulesContentView 53, AddScheduleOverlay 26,
     AgentSchedulesTab 8, SubAgentTasksSidepane 8, SyncSettingsContentView 7,
     a retired settings view 10, CompanionCard 4, ScreenshotSettingsContentView 4, content.tsx 4,
     SyncSettingsView 4, HatchingCeremony 3, AgentChatEditingLayout 2, retired sub-agent editor tab 2,
     GetScheduleToolCallView 2, SkillFileViewer 1, SubAgentDropdownMenu 1, BuddyMainPanel 1,
     InstallUpdateOnStartupView 1). Component logic was **untouched** (hex-only swaps); the existing
     SubAgentTasksSidepane test had 3 color-literal assertions updated to the new `var()` form (no
     weakening). **`hardcodedHexLiterals` 687 → 500** (the gate ratchet went 650 → 500 in this batch,
     after a prior intra-session 687 → 650). Each file verified ≥90% via `check-coverage.js --staged-only`.
     **✅ RESOLVED — gray *hex* fully cleared (2026-06-20):** `BuddyXPBar.tsx`'s last `#94a3b8`
     was migrated to `var(--color-neutral-400)` **together with** the latent timer bug it was
     blocked on. Root cause: `lastGain` was in the effect deps, so `setLastGain(...)` triggered an
     immediate effect re-run whose cleanup `clearTimeout`ed the pending hide timer before it could
     fire — the `setTimeout(() => setShowDelta(false), 1500)` callback was **dead code**, capping
     functions at 83.33% and so blocking the 90% gate. Fix: hold the last shown gain in a `useRef`
     (`lastGainRef`) and drop it from the effect deps, so the effect only re-runs when
     `xpData.lastXPGain` changes and the hide timer survives to fire. The float now actually
     auto-dismisses (a real behavior fix, not just coverage). Added `BuddyXPBar.test.tsx` (5 cases:
     pre-milestone Hatchling, provided rarity color + interpolated progress, capped top milestone,
     gain-float show→1500ms auto-dismiss, dedup of an already-seen gain) → **100% on all four
     metrics**. **`hardcodedHexLiterals` 500 → 499.** Renderer `.tsx` cool-gray hex is now **zero**
     in production component code.
   - **Test-suite integrity fix (full-suite audit):** running the *entire* vitest suite (not scoped
     runs) surfaced latent breakage from the earlier `f2e0df059` "resolve blue color debt"
     coverage-padding commit, plus one stale color assertion. All fixed (suite now **1164/1164**
     files green): (1) `MemexMemorySidepane.test.tsx` asserted the old `#F9FAFB` after the chip
     mouseLeave was migrated to `var(--color-neutral-50)` (828b3f525) — it was a **stale failing
     assertion, not a fixture** — updated to the shipped token; (2) `AgentList.debt.test.tsx` had 3
     illegal nested `it()` blocks whose throw leaked `mockResolvedValueOnce` responses across tests
     — de-nested the 3 valid tests and removed 5 never-passing speculative tests that only duplicated
     sibling coverage (AgentList.tsx stays ≥90% all four metrics); (3) `SubAgentToolCallView.test.tsx`
     double-advanced fake time (saw "2.5s" not "1.5s") and leaked fake timers on throw — fixed the
     advance and made `afterEach` restore real timers (funcs 86.66% → 95.55%).
   - **DECIDED — warm palette is its OWN token, never `neutral` (2026-06-20):** the
     designer-provided **warm** colors (`#272320` darkest, `#322d29`, `#3d3935`, `#e2ddd9`,
     `#f8f4f1`, `#fffbf8` lightest — ≈420 uses across `.tsx` + `.css`, **R>G>B** warm bias) are an
     intentional brand ramp and are **excluded** from the gray→neutral remap. They are promoted to
     a dedicated `warm` token ramp (`warm-50/100/200/700/800/900`) holding
     the **exact** designer hex (literal, so opacity utilities like `bg-warm-900/5` keep working) —
     **zero visual change**.      The `warm` token **foundation has landed** in the `@theme` block in
     `globals.css` — one definition generates both the `warm-*` utilities and the `--color-warm-*`
     vars. (Originally added to `tailwind.config.js` with hand-mirrored `:root` vars; unified into
     `@theme` in Phase A, 2026-06-23.) **Progress:**
     ✅ the **`.css` layer is fully repointed** — all **293** raw warm hex occurrences across **37**
     `.css` files (mixed casing) swapped to `var(--color-warm-*)`; proven byte-identical by render
     (`var(--color-warm-900)` computes to `rgb(39,35,32)` = `#272320`). `cssHexLiterals` ratcheted
     **2094 → 1807**. ⏭️ Remaining: repoint the `.tsx` warm arbitrary values (`bg-[#272320]` →
     `bg-warm-900`) on already-covered files (coverage-gated, staged like blue→sky). **First `.tsx`
     slice done:** `ShortcutRecorder.tsx` (a covered `components/ui` primitive) — 13 warm arbitrary
     classes → `warm-*` (incl. opacity `bg-warm-900/5`, `ring-warm-900/20`); `hardcodedHexLiterals`
     ratcheted **729 → 716**. **Do NOT fold
     warm hex into `neutral`** and **do NOT hardcode these hexes** in new code — use the `warm`
     token (`.tsx`) / `var(--color-warm-*)` (`.css`/SVG).
    - **DECIDED & executed — gray simplification (owner-approved 2026-06-21):** after a full
     "how many grays / can we merge" audit (98 distinct gray hexes / 761 occ / 137 files), the
     owner made two calls, both now executed to the safely-shippable boundary:
     - **① Protect the 4 designer-given standard colors as DS tokens.** `#fffbf8` / `#f8f4f1`
       already exist as `warm-50` / `warm-100`. `#ffffff` formalized as `--color-white` (its
       `.tsx` counterpart is Tailwind's built-in `bg-white`). `#FFE6D3` (brand warm-orange:
       avatar bg/outline, title bar, FRE gradient) formalized as `warm.accent` /
       `--color-warm-accent`; all **8** raw `.css` usages repointed (byte-identical). The
       **warm 300–600 mid-ramp** was completed using the real designer warm-grays already in
       the code (`#b3ada8`/`#979593`/`#6b6561`/`#4c4642`), so mapping mid warm-grays is
       byte-identical. These live in the same `globals.css` `@theme` SSOT (warm 300–600 + `accent`).
     - **② De-blue the iOS/macOS cool system grays into `neutral`.** `#6C6C70`→`neutral-500`,
       `#C7C7CC`→`neutral-300`, `#8E8E93`→`neutral-400`, `#F2F2F7`→`neutral-100`,
       `#636366`→`neutral-500` across 16 `.css` files + 2 covered components — the only intended
       visual change (removes the slight blue cast; max Δ +21 on secondary text). Warm mid-grays
       `#B3ADA8`→`warm-300`, `#6B6561`→`warm-500` (byte-identical). `.css` ratcheted
       **`cssHexLiterals` 1082 → 1022**.
     - **Covered `.tsx` done:** `AgentList.tsx` + `ScheduleSessionListItem.tsx` inline-style /
       SVG / lucide hexes repointed (cool grays → `neutral`, `#272320`→`warm-900`,
       `#FFFBF8`→`warm-50`, `#E2DDD9`→`warm-200`), hex-only, both ≥90% all four metrics; 185
       tests pass. **`hardcodedHexLiterals` 499 → 467.**
     - **Tracked debt — remaining `.tsx` occurrences, all hard-blocked (NOT skipped):**
       (a) **screenshot window, 4 occ at the time of this phase** — the screenshot overlay is a
       separate `screenshot.html` BrowserWindow, but current app chrome loads `globals.css` through
       `screenshot.tsx` and should use `var(--color-*)`. The remaining sanctioned screenshot
       literals are bounded asset/user-palette colors, not ordinary app-chrome drift.

## Verification Steps
1. `npm run check:design` — passes at baseline; fails if hex (`.tsx` or `.css`) / css-file / raw-status-class / raw-brand-class / raw-brand-RGB(A) / `.css` `border-radius`-literal counts grow, or if any fallback-free CSS `var(--token)` reference is unresolved. Same gate is wired into the enforcement layers: CI (`pr-design-system.yml`, always on and passing `--reference-baseline` so PR baselines cannot be raised), an optional local `.git/hooks/pre-push` opt-in, and the `eslint.config.mjs` editor rule (raw hex in renderer source).
2. `npm run typecheck` — unaffected by docs/gate.
3. `npx vitest run scripts/__tests__/check-design-tokens.test.ts` — gate unit tests pass.
4. `npx vitest run scripts/__tests__/color-snap.test.ts` — color-snap (CIEDE2000) unit tests pass.
5. `npm run snap:colors` — prints the current nearest-token classification (auto/qa/review buckets) for the raw hex still in the renderer; use before a batch migration.
6. Developer / AI reference: [`docs/design-system/README.md`](../docs/design-system/README.md) (Markdown) + [`docs/design-system/design-system.html`](../docs/design-system/design-system.html) (visual) — the shippable how-to-use / how-to-verify guide.

## Gotchas
- Tailwind here is **v4** (`@import "tailwindcss"`), bridged to the v3-style JS config via
  `@config "../../../tailwind.config.js"` for the remaining **non-color** settings (blur, animation,
  container). **Color primitives AND the `--radius-*` corner-radius scale now live in a native
  `@theme` block at the top of `globals.css`** (colors: Phase A 2026-06-23; radius: 2026-06-25) —
  editing a color or a radius step means editing `@theme`, not the JS config; the config no longer
  defines any color or `borderRadius`.
- A CSS declaration that uses `var(--token)` without a fallback is invalid when that token is
  unresolved; Chromium drops the whole declaration. Do not invent alias names in feature CSS
  (`--color-border-default`, `--color-surface-primary`, etc.) unless the token is defined in
  renderer CSS. Prefer existing semantic tokens (`--color-surface-default`, `--color-border-strong`,
  `--form-control-focus-border`) or add the new token in `globals.css` in the same change.
- **Migrating a family from `@config` into `@theme`: extract the FULL live-shade set, variants
  included.** Tailwind v4's `@theme` is JIT — it only emits a `--color-*` var / utility for shades
  actually referenced in the content globs, so you must seed it with the complete *used* shade union
  or you silently drop one. A naive `grep '\.(bg|text)-primary-[0-9]+'` **misses variant-prefixed
  utilities** like `.dark\:hover\:text-primary-300` — that is how `primary-300`, `danger-400`, and
  `success-300` were nearly lost. Extract `{family}-{shade}` substrings from **all** selectors
  (utility ∪ `.css` `var()` refs), then prove zero change by resolving every `--color-*` to its
  computed color before/after (the Phase A resolver: 0 changed / 0 dropped). Plain `@theme` (not
  `@theme static`) is correct here because every css-referenced shade also backs a used utility, so
  nothing gets pruned.
- **Status ramps (`--color-danger/success/warning-*`) are declared in OKLCH on purpose — do NOT
  "normalize" them back to hex.** They mirror the **Tailwind v4** palette (the exact values
  `bg-danger-*`/`success-*`/`warning-*` render in `.tsx`), so `.css` token usage stays color-identical
  to the components. The old `.css` v3 hexes (`#dc2626`, `#10b981`, …) were the *drift*; they were
  intentionally aligned up to v4 (2026-06-21, Option B). New status shades must be sourced from
  `node_modules/tailwindcss/theme.css` (the pinned v4.2.2 OKLCH), not hand-written hex — a hex literal
  would both re-introduce v3/v4 drift and add to the `cssHexLiterals` gate count. Only add a shade when
  a real consumer uses it (no inert tokens). Note `success` = **green**, never `emerald` (emerald-as-
  success was a fixed bug).
- **`sky`-vs-`blue` brand drift — DECIDED: unify on Sky (Option B), migrating incrementally.** A
  full audit (2026-06-20) showed the app's **brand chrome is `sky`**, not blue: the **logo**
  (`LogoSection`, `text-primary-600`), the **active nav highlight** (`--nav-item-color-active:
  #0ea5e9`), and the **primary "New Chat" CTA** (`--new-chat-btn-bg` sky gradient) are all sky
  (~113 sky total). Primitives used hardcoded `blue-*` (~180 blue total, mostly primitives +
  focus/link/border accents) — the drift. **Resolution:** migrate `blue-*`/blue hexes →
  `primary`(sky) so the logo/nav/CTA stay and the primitives match. Done: **Phase 1**
  (`components/ui` primitives), **Phase 2** (98 blue-ramp hexes across 24 CSS files → sky),
  **Phase 3** (7 covered feature `.tsx`), **Phase 4** (final 14 feature `.tsx` after adding
  coverage), and **Phase 5** (15 ad-hoc azure/iOS/Bootstrap/Ant CSS blues → `#0284c7`). The only
  blues intentionally kept are non-drift ones — Microsoft Fluent (`#0078d4`/`#0067b8`), indigo, VS
  Code syntax blue, dark-slate text — see Roadmap #2. **Do NOT add new `blue-*`; do NOT swap
  `primary`'s values to blue** (that only recolors the logo + 2 spinners and de-syncs the chrome).
- `class-variance-authority` is now adopted (variant standard); the `@radix-ui/*` packages were
  **removed (2026-06-20)** as dead deps, so the headless-primitive part of the shadcn-style stack
  is intentionally not used — primitives stay hand-rolled and own their own a11y.
- **A `.tsx` raw-hex migration is context-dependent — classify each occurrence first.** `var(--color-*)`
  resolves in **all CSS-aware contexts in real Chromium/Electron**: React `style={{ prop: '#hex' }}`,
  `el.style.prop = '#hex'` assignments, emotion ``css`prop: #hex` `` templates, **SVG presentation
  attributes** (`fill="var(--x)"`, `stroke=`, `stopColor=`), **and `lucide-react` `color=` props** (they
  render to an SVG `stroke`). R2 (2026-06-23) **proved this empirically** — a Chromium check resolved
  27/27 R2 tokens to their exact colors via SVG `fill`, an alias token, and lucide `stroke`/`color`; the
  shipped `FileTypeIcon` and `SkillFileViewer` icons
  consume tokens this way and render correctly. The **only** context where `var()` does **not** resolve is
  a **canvas 2D context** (`ctx.fillStyle`, e.g. the `screenshot/**` `NumberColor` drawing palette) — canvas
  is not CSS-aware, so those must stay literal (or read the computed var via JS first).
  ⚠️ **happy-dom caveat (test env, NOT real rendering):** the vitest happy-dom env does not *compute* `var()`
  inside SVG-attribute computed styles, so a test must assert the **attribute / style STRING**
  (`el.getAttribute('fill') === 'var(--color-filetype-pdf)'`, or `el.style.color === 'var(--color-neutral-400)'`),
  never a resolved `rgb()`. (The earlier Phase C slice-3 codemod excluded SVG/lucide occurrences out of an
  over-cautious reading of this happy-dom behavior; R2 corrected it — SVG-attr/lucide hexes **are** safe to
  migrate, you just assert the string.)
- **happy-dom cannot replace a `var()` background shorthand with a hex (verified empirically).** Setting
  `el.style.background = '#hex'` does **not** override an existing `el.style.background = 'var(--x)'` (the
  value stays the var); but `el.style.background = 'var(--y)'` **does** override either. Real Chromium is
  unaffected — this is a happy-dom quirk. Consequence: when you migrate a base inline-`style` to a token,
  any **paired** interaction handler (`onMouseEnter`/`onMouseLeave` doing `el.style.background = '#hex'`)
  must **also** migrate to `var()`, or its happy-dom hover test breaks (e.g. `InstallUpdateOnStartupView`
  /`FreSettingUpView` in Phase C slice 3). Always migrate base+hover together and update any test that
  asserts the raw hex to the token value (`*.hexcov.test.tsx`).
- **Status tokens are OKLCH primitives in the `@theme` block, not hardcoded hex.** Since Phase A
  (2026-06-23) `danger`/`success`/`warning` are defined in `globals.css` `@theme` as the **exact
  Tailwind v4.2.2 OKLCH** values (`--color-danger-600: oklch(57.7% 0.245 27.325)`, …) — one
  definition that backs both `bg-danger-600` in `.tsx` and `var(--color-danger-600)` in `.css`, so
  they stay color-identical to the Tailwind `red`/`green`/`amber` palette. (Before Phase A they were
  `colors.red`/`colors.green`/`colors.amber` aliases via `require('tailwindcss/colors')` in
  `tailwind.config.js`; that config alias was removed when the colors moved to `@theme`.) Do NOT
  hardcode hex for these — a hex literal would drift from v4's OKLCH **and** add to the
  `cssHexLiterals` gate. New status shades come from `node_modules/tailwindcss/theme.css`. `success`
  = **green**, never `emerald`. As of Phase 29 every raw `yellow-*` was migrated to the `warning`
  (amber) token and Phase 30 folded `yellow` into the `rawStatusPaletteClasses` gate, so raw
  `yellow` can no longer slip past it (live count 0/0).
- **Snapping greys to a ramp tier can *collapse a gradient*.** When you map "off-ramp" hexes to their
  nearest token (Phase 27 / merge-to-nearest), watch for a `linear-gradient(...)` whose **two adjacent stops
  both round to the same tier** — the gradient then renders as a flat color (a visible regression). The
  known case is `Message.css`'s cinema-mode `linear-gradient(145deg, #1a1a1a 0%, #0a0a0a 100%)`: both
  near-blacks would snap to `neutral-900`. Phase 27 carved both stops out (kept raw); **Phase 28 resolved
  it the right way** by adding `--color-neutral-950` (`#0a0a0a`, exact Tailwind tier) so the two stops map
  to two **distinct** tokens (`neutral-900` → `neutral-950`) and tokenize without collapsing. Lesson: a
  gradient that wants to collapse usually means the ramp is *missing a tier*, not that the stops must stay
  raw — extend the ramp before you carve out. Before any bulk hex→token snap, still scan for multi-stop
  lines where every stop maps to one token. Code-viewer editor themes now live in the **independent
  syntax registry** (`--syntax-*` in `code-styles.css`, R1 2026-06-23) — they stay dark in light mode
  and are NOT ramp greys; the old `--color-code-surface*`/`--code-*` vars were migrated there and deleted.
- **New token *definition* hexes count toward the `cssHexLiterals` gate — and so do hexes in comments.**
  `countHexInText` runs over the whole file, with no exemption for `--color-*:` def lines or comments. So
  adding N new hex token defs raises the count by N (net math: −migrated usages + new defs), and writing
  `/* was #1e1e1e */` silently adds 1 to the gate. Define new tokens, then keep hex literals OUT of token
  comments (describe the role in words). OKLCH values are not hex, so an OKLCH token def costs 0. One
  exclusion exists: `countHexInText` has a `(?<!&)` negative lookbehind so HTML numeric entities
  (`&#039;`, `&#x...;`) are **not** miscounted as `#039`-style colors — real color hexes are never
  `&`-prefixed (added 2026-06-24 after `MentionHighlight.tsx`'s `&#039;` was the only such false positive).
- **The syntax registry (`code-styles.css`) is self-contained on purpose — keep `--syntax-*` literal.**
  Every `--syntax-*` value is an inlined literal (e.g. `--syntax-inline-text: #322d29; /* was warm-800 */`),
  **not** a `var(--color-*)` reference, so the highlight scheme stays fixed when the brand palette is
  re-pointed (rebrand / dark mode). Do **not** "DRY it up" by pointing a `--syntax-*` token at a
  `--color-*` token — that re-couples them and is the exact drift the registry exists to prevent. New
  code-rendering colors go **here** (then `var(--syntax-*)` from the consumer), never into the global manager.
- **Verifying a CSS-var migration: Vite emits `.css` to SEPARATE asset files, not inlined in `.js`.**
  A grep of `dist-vite/renderer/assets/*.js` will **not** find `--syntax-*` defs or `var(--syntax-*)`
  consumers (only React inline-`style` strings from `.tsx` end up in JS). The compiled CSS lives in
  `assets/*.css`: token **definitions** land in the `globals-*.css` chunk (from the `@import`), and the
  `.css`-file **consumers** land in the per-entry `index-*.css` / `screenshot-*.css` chunk — both are
  `<link>`-ed by the same HTML, so cross-file `:root` resolution is standard CSS. To prove a value-
  preserving migration end-to-end, load the compiled `globals-*.css` + `index-*.css` into Chromium
  (Playwright) and `getComputedStyle` each `var(--syntax-*)` against its original color (R1 did this:
  16/16 byte-identical) — do **not** conclude from a `.js` grep alone.

## Related
- **Shippable reference (AI + developers): [`docs/design-system/README.md`](../docs/design-system/README.md) + [`docs/design-system/design-system.html`](../docs/design-system/design-system.html)** — token tables, component catalog, visual language, how-to-use, how-to-verify.
- Module doc: [components/ui primitive library](../src/renderer/components/ui/ai.prompt.md)
- Renderer architecture: [arch-render.md](arch-render.md) (§8 state management is mandatory reading before renderer changes)
- Enforcement (layered): `scripts/check-design-tokens.js` + `scripts/design-system-baseline.json`; CI `.github/workflows/pr-design-system.yml` (always on); optional local `.git/hooks/pre-push` opt-in; editor `eslint.config.mjs` (raw-hex rule).
