<!-- Last verified: 2026-07-11 (FileContentRenderer remains the shared localized file-body renderer for overlay, inline, skill, and Memex preview surfaces; shared file-viewer metadata helpers keep oversized preview chrome from growing with duplicate path/size/office-label logic; file-loading effects keep live translation functions in refs so language changes do not reload files or discard dirty edits.) -->
# UI Primitives (`components/ui/`)

> The shared primitive layer of the OpenKosmos design system: low-level, mostly
> presentational building blocks (Badge, Card, Dialog, Toast, overlays, dividers, icons)
> that feature components compose. These are **hand-rolled** Tailwind components glued with
> `cn()` — **not** a wrapper around a headless library. See the system-level doc
> [design-system.md](../../../../ai.prompt/design-system.md) for the token/governance model.
>
> **Buttons are NOT a primitive here.** There is no `Button` component — every button is a
> native `<button>` styled with the designer-owned global `.btn-*` CSS classes
> (`.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-ghost`/`.btn-icon`/
> `.btn-close` in `Common.css`, which is imported globally by `index.tsx`). The old `cva`-based `button.tsx` was **removed**;
> do not reintroduce it. See the Buttons gotcha below.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `FileContentRenderer.tsx` | Shared file-content renderer used by file-preview surfaces. Classifies by MIME/extension and renders Markdown (frontmatter table + GFM/raw HTML, optional Memex `[[wikilink]]` navigation), HTML, JSON/code/text Monaco views, localized loading text, and fallback text behavior using the `OverlayFileViewer` file-content contract. | ~410 LOC |
| `fileViewerMetadata.ts` | Shared file-viewer metadata helpers for path classification, local-path extraction, file-size formatting, and localized Office file labels. | ~40 LOC |
| `OverlayFileViewer.tsx` | Full-screen file preview overlay (allowlisted for length); owns localized overlay chrome, loading/saving, source/render toggle, metadata/error fallbacks, and delegates renderable file bodies to `FileContentRenderer`. | ~886 LOC |
| `ShortcutRecorder.tsx` | Keyboard-shortcut capture control | ~373 LOC |
| `FileTypeIcon.tsx` | Maps file extensions to icons | ~305 LOC |
| `OverlayImageViewer.tsx` | Full-screen image preview overlay | ~303 LOC |
| `Toast.tsx` / `ToastProvider.tsx` | Toast notification primitive + context/provider | ~220 / ~216 LOC |
| `ContextBadge.tsx` | Context/attachment chip | ~203 LOC |
| `dialog.tsx` | **Hand-rolled** modal dialog: own Escape handling, dialog-stacking registry, close-context, ARIA (`role="dialog"`/`aria-modal`/labelled-by/described-by), and **focus management** (initial focus into the content, topmost-only Tab focus trap via the shared registry, focus restored to the opener on close). The **sole** dialog primitive — the legacy `.modal-*` shell (`Modal.css`) was retired and every overlay/modal composes this | ~295 LOC |
| `StatusBadges.tsx` | Status indicator badges | ~179 LOC |
| `ErrorDetailsDialog.tsx` | Error detail modal built on `dialog.tsx` | ~66 LOC |
| `card.tsx` | Card container + header/title/content/footer parts | ~66 LOC |
| `button.tsx` | **REMOVED** — buttons use the global `.btn-*` CSS classes, not a component | — |
| `badge.tsx` | Badge primitive: 6 `cva` variants + global `normal` (exports `badgeVariants`) | ~45 LOC |
| `ListSearchBox.tsx` | Search input for lists | ~39 LOC |
| `ExperimentTag.tsx` | Experiment label — Tailwind utilities plus a global `.experiment-tag` dark override hook, no co-located `.css` | ~46 LOC |
| `Divider.tsx` / `ResizableDivider.tsx` / `RightResizableDivider.tsx` | Layout separators | 11 / 17 / 19 LOC |
| `use-click-out.tsx` | Hook: detect clicks outside an element | ~17 LOC |

## Architecture
- **Hand-rolled, not headless-wrapped.** Primitives are plain React + Tailwind. `dialog.tsx`
  implements its own keyboard/stacking/close logic. `class-variance-authority` IS used (for
  `Badge` variants), while `@radix-ui/*` (7 packages) was **removed from `package.json` (2026-06-20)** —
  it had been installed but imported **0 times** anywhere in `src` (dead deps).
  Accessibility is therefore **owned by us**, primitive by primitive.
- **One dialog engine.** `dialog.tsx` is the single dialog/modal primitive. The legacy
  `.modal-*` overlay+container CSS shell (`Modal.css`) was **retired**, and every former consumer
  (Archive / Delete / Duplicate / Rename overlays, `TaskFormModal`, `UserInputModal`,
  `ErrorDetailsDialog`, `EvalCaseSubmitModal`) now composes `dialog.tsx`. Do not roll a second dialog/overlay shell —
  reuse this one so Escape, stacking, and focus stay consistent.
- **Variants via `cva` (the standard).** `badge.tsx` defines its variant class map with
  `class-variance-authority` and merges the result with `cn()` (`clsx` + `tailwind-merge`),
  exporting `badgeVariants` for reuse. Adding a variant = adding a key to the `cva` config.
  `Badge`'s `normal` is the one exception (an early return to a global class, not a `cva`
  variant). **Buttons are the deliberate exception to `cva`:** they are styled by the global
  `.btn-*` CSS classes (designer-owned), never a component or `cva` recipe.
- **Mixed naming convention.** Two cohabiting styles: lowercase shadcn-ish files
  (`badge.tsx`, `card.tsx`, `dialog.tsx`) and PascalCase app primitives
  (`Toast.tsx`, `ContextBadge.tsx`, `OverlayFileViewer.tsx`, ...). New files should follow
  the closest existing sibling; do not rename existing ones casually (import churn).
- **Icons.** `lucide-react` is the icon source (used ~166× across the renderer), pulled in by
  several of these primitives.
- **Shared file-content rendering.** `FileContentRenderer.tsx` is the renderer for file bodies,
  separate from any specific chrome (inline preview, overlay, sidepane, detail panel). It uses the
  same file-content classes and Monaco contract as `OverlayFileViewer`, so `OverlayFileViewer`,
  `InlineFilePreviewPanel`, Skill file viewer, and Memex detail surfaces share one rendering path.
  Reuse it when a feature needs to preview file contents by format instead of reimplementing
  Markdown/frontmatter/code rendering locally. Memex-specific card navigation is exposed only through
  the optional `markdownWikilinks` prop; ordinary file viewers must not hard-code Memex behavior.
  Skill file previews are the exception for HTML: they pass `viewMode="source"` so installed skill
  HTML is shown as inert source instead of executing scripts in the preview iframe.
- **Shared file metadata helpers.** `fileViewerMetadata.ts` owns reusable path/size/Office-label
  helpers for file-preview chrome. Prefer extending it over duplicating helper logic in overlay,
  inline, skill, or settings preview components.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Style/add a button | use the global `.btn-*` classes | `<button className="btn-primary">` etc. — designer-owned in `Common.css`; colors are **black** (`primary`/`dark`), **red** (`danger`), **white** (`secondary`) — **never sky**; never build a `Button` component or a `cva` recipe for buttons |
| Add a Badge variant | `badge.tsx` | Add a key to the `cva` variants config; use **semantic tokens** (`primary` brand, `danger`/`success`/`warning` status) — never raw `bg-blue-600`/`bg-red-600` |
| Build a new primitive | new file in `components/ui/` | Tailwind + `cn()`; no new `.css` file; hand-verify a11y |
| Add a modal/overlay | compose `dialog.tsx` | The **only** dialog engine — the legacy `.modal-*` shell (`Modal.css`) was retired and all overlays/modals (Archive/Delete/Duplicate/Rename, `TaskFormModal`, `UserInputModal`, `EvalCaseSubmitModal`) migrated onto it. Reuse its Escape/stacking; never roll a second dialog |
| Add an icon | import from `lucide-react` | Do not add SVG files or a second icon lib |
| Restyle for tokens | the primitive's classes | Replace default-palette utilities with semantic token classes (see roadmap) |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `.btn-*` classes in `Common.css` | Every `<button className="btn-*">` consumer (`grep "btn-primary\|btn-secondary\|btn-danger\|btn-ghost"`); these classes are the single button contract |
| `badge.tsx` variant API (or `badgeVariants`) | All consumers (`grep "components/ui/badge"`), and [design-system.md](../../../../ai.prompt/design-system.md) if the token contract changes |
| `dialog.tsx` behavior | Every modal/overlay built on it — `ErrorDetailsDialog.tsx`, the Archive/Delete/Duplicate/Rename overlays, `TaskFormModal`, `UserInputModal`, `EvalCaseSubmitModal` (the legacy `.modal-*` shell is retired, so they all route here); verify stacking still works |
| `FileContentRenderer.tsx` format behavior | `InlineFilePreviewPanel.tsx`, `OverlayFileViewer.tsx`, Skill file viewer, Memex sidepane/detail viewers, and any workspace/knowledge file-preview surface |
| `fileViewerMetadata.ts` path, size, or Office-label behavior | `InlineFilePreviewPanel.tsx`, `OverlayFileViewer.tsx`, Skill file viewer, and any file-preview chrome showing local-path or file metadata |
| Token names in `globals.css` (`@theme` colors/radius, `:root` semantics) | Primitive class strings here that reference them |
| `badge.tsx` `normal` variant | The global `unified-badge-normal` class in `globals.css` (escape hatch) |
| Any color literal added here | `scripts/design-system-baseline.json` ratchet (gate will fail on growth) |

## Anti-Patterns
- Do NOT add a new `.css` file in this folder. It is now `.css`-free (`ExperimentTag.css` was
  migrated to utilities); keep it that way.
- Do NOT build a `Button` component or a `cva` button recipe. Buttons are styled exclusively
  with the global `.btn-*` classes; the `cva` `button.tsx` was removed on purpose. `cva` remains
  the standard for **`Badge`** variants only; `@radix-ui/*` was removed (dead deps) — do not
  re-add it without a deliberate decision, and never sprinkle one-off usage.
- Do NOT hardcode new hex colors in `.tsx`. The `check:design` ratchet blocks growth
  (renderer `.tsx` is at hard-zero raw hex outside sanctioned regions).
- Do NOT reach past primitives: feature code should compose these (and use `.btn-*` for
  buttons), not re-implement a badge/dialog inline.
- Do NOT silently rename primitive files; imports across the renderer depend on the paths.

## Verification Steps
1. `npm run typecheck` — primitives are widely imported; type breaks cascade.
2. `npm run check:design` — confirm no new hex literals / `.css` files / raw `border-radius` literals were introduced.
3. For an interactive primitive (dialog/toast): manually verify keyboard focus, Escape, and
   screen-reader labels — there is no Radix to do this for you.
4. OpenKosmos primitives are brand-agnostic; any future product divergence belongs at the semantic token layer, never here.

## Gotchas
- **Buttons = global `.btn-*` CSS, no component.** Every button is `<button className="btn-{role} …">`.
  Roles: `.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-ghost`/
  `.btn-icon`/`.btn-close` (`Common.css`, globally imported by `index.tsx`). The box model is shared (padding 8px 16px, radius
  `var(--radius-lg)` 8px, font-weight 600, font-size 12px, min-height 32px, `display:flex` centered,
  gap 8px). Because
  `.btn-*` is **block-level `display:flex`** (not the old `cva` `inline-flex`), a solo button inside a
  block parent that must hug its content needs a width utility (e.g. `w-fit`). The removed `cva`
  `button.tsx` used `inline-flex`/radius 6/sizes 40px·14px — do **not** resurrect it; the `.btn-*`
  system is the single source of button styling and is owned by design.
- **Button colors = black / red / white — NEVER sky (designer decision, 2026-06-24).** `.btn-primary`
  = **black** (`var(--color-warm-900)` #272320, hover `warm-800`);
  `.btn-danger` = **red** (`danger-600`); `.btn-secondary` = **white** outline (slate `border-form`,
  neutral text, near-black hover border/text — **no sky ring**); `.btn-ghost`/`.btn-icon`/`.btn-close`
  = transparent/white with neutral hover. The same black extends to the primary CTAs
  `.new-chat-button`/`.new-agent-button`/`.send-btn` (via `--new-chat-btn-bg` in `globals.css`).
  Buttons formerly used a **sky gradient** for primary — that was removed; sky now appears **only on
  non-button affordances** (links, focus rings, active nav/list selection). Do **not** reintroduce
  `accent`/sky on any `.btn-*` surface or primary CTA.
- **React primitives use the `primary` (sky) token — brand accent unified on Sky (decision "Option B").**
  `badge.tsx`, `ExperimentTag.tsx`, and `Toast.tsx` use `primary-*`
  (`bg-primary-600`, `focus:ring-primary-500`, …) — the canonical brand ramp, which maps to
  Tailwind's `sky` values. They previously used raw `blue-*`; the brand-color drift was resolved
  by **unifying on Sky**, because the app's brand chrome (logo, active nav highlight) was already
  sky (see `ai.prompt/design-system.md`). **Do NOT add new `blue-*` — use `primary-*`.** Note: the
  `primary` token is the brand **accent** (badges, links, focus rings, nav/list selection); it is
  **not** a button color — buttons are black/red/white (see the button-colors gotcha above).
  `ExperimentTag` keeps the light-mode `bg-primary-500` utility for visual compatibility, but exposes
  `.experiment-tag` so `[data-theme="dark"]` can remap it to a darker primary step with white text
  contrast. Toast primary actions similarly expose `toast-action-primary` so dark mode can remap the
  action to the high-contrast semantic button tokens in `globals.css`.
- **Status colors use semantic tokens (`danger`/`success`/`warning`) that alias the Tailwind
  `red`/`green`/`amber` ramps** (defined in `globals.css` `@theme` as `--color-danger-*` /
  `--color-success-*` / `--color-warning-*`). `badge`
  (`destructive`/`success`) and `Toast` reference them — e.g. `bg-danger-600`, `bg-success-50`.
  They are **byte-identical** to the raw palette (zero visual change). Use these, not raw
  `bg-red-600`/hex. `badge.tsx`'s `warning` variant uses `bg-warning-600` (the canonical amber
  `warning` token); the former raw `yellow-600` was migrated 2026-06-20 (see `design-system.md`).
- `badge.tsx`'s `normal` variant renders a global `unified-badge-normal` class instead of
  inline utilities — a CSS escape hatch coupling this primitive to `globals.css`.
- `OverlayFileViewer.tsx` is in the file-length allowlist; do not treat that as license to
  grow it — extract when you touch it.
- Dark mode is token-first: primitives should consume semantic/component tokens from
  `globals.css`, which are re-pointed by `[data-theme="dark"]`. Do not add new `dark:`
  utility pairs here unless a localized migration cannot be expressed with existing tokens.
- `OverlayFileViewer` file-loading effects must not depend directly on `t`/`useI18n()`; language
  switches should update chrome/errors through a ref without reloading the file or resetting dirty
  edit state.
- **Corner radius = the `--radius-*` scale.** The `rounded-*` utilities (e.g. `Card` is `rounded-lg`
  = 8px) and the `.btn-*` radius are var-backed by the `@theme` `--radius-*` SSOT in `globals.css`
  (2026-06-25), not the old `tailwind.config.js` `borderRadius` block. Use a `rounded-*` utility or
  `var(--radius-*)`; never hardcode a raw `px`/`rem` `border-radius` (the gate's `cssBorderRadiusLiterals`
  metric blocks it in `.css`).

## Related
- System model & governance: [design-system.md](../../../../ai.prompt/design-system.md)
- Renderer architecture index: [arch-render.md](../../../../ai.prompt/arch-render.md)
- Token source of truth: `src/renderer/styles/globals.css` (`@theme` colors + radius, `:root` semantic tier); `tailwind.config.js` holds only the remaining non-color settings (blur/animation/container)
- `cn()` helper: `src/renderer/lib/utilities/utils.ts`
- Enforcement: `scripts/check-design-tokens.js`, `scripts/design-system-baseline.json`
