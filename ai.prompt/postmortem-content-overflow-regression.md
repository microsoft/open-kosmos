# Postmortem: content-container overflow regression

**Date:** 2026-04-22 | **Severity:** P2 (right-side content clipped for some users) | **Affected:** All users with narrow windows or expanded right-side panels

## Symptom
The right content panel (Agent Knowledge Files, Deliverables, etc.) was clipped by the window's right edge; content overflowed outside the window and was invisible.

## Root Cause
An inline style `overflow: 'unset'` was added to `ContentContainer.tsx`, overriding the `overflow: hidden` declared on `.content-container` in `globals.css`. The `.chat-sidepane` has a fixed `width: 350px` + `flex-shrink: 0`; once the outer clipping boundary was removed, it overflowed the window directly.

## Timeline
| Date | Event |
|------|-------|
| 04-16 | `912d2001` `style(chat): refine chat view styling and add dev info badge (#507)` — To achieve a rounded-card visual effect, inline styles `overflow: 'unset'`, `border-radius`, `box-shadow`, and other decorative properties were added to the `<main>` element in `ContentContainer.tsx`. `overflow: 'unset'` silently overrode the `overflow: hidden` in CSS. |
| 04-22 | User reports right panel being clipped. |

## Why It Happened
1. **Decorative changes mixed with layout properties**: PR #507 primarily changed visual properties like border/shadow/background. `overflow: 'unset'` was included as a companion change "to make rounded corners visible," and the author did not realize it also removed the layout clipping boundary.
2. **Inline style silently overriding CSS**: `.content-container` in `globals.css` declared `overflow: hidden`, but inline styles have higher specificity and silently overrode it. This override is not visible when reading only the CSS file.

## Why It Wasn't Caught
1. **Not reproducible on a developer's large monitor**: The issue only occurs when the window is too narrow to accommodate the left sidebar + main content + right panel (350px + 24px margin). Developers working full-screen never encounter it.
2. **PR review focused on visuals**: The diff in #507 was about visual polish; reviewers focused on color values, corner radii, and shadows — not the impact of `overflow` on the layout clipping chain.
3. **No visual regression tests**: CI has no layout overflow detection at varying window sizes; CSS overflow problems cannot be caught by typecheck or unit tests.

## Fix
Remove the inline `overflow: 'unset'` from `ContentContainer.tsx`, restoring the effect of `.content-container`'s `overflow: hidden`. `.content-wrapper` already has `overflow: hidden` + `border-radius`, so the rounded-card visual effect is unaffected.

## Lessons
1. **Distinguish decorative properties from layout properties** — `border-radius`, `box-shadow`, and `background` are decorative; `overflow`, `position`, `flex-shrink`, and `min-width` are structural layout properties. Modifying layout properties in a style PR requires extra scrutiny of their effect on the parent/child clipping and overflow chain.
2. **Inline style overriding CSS deserves special attention** — The high specificity of inline styles silently overrides CSS file declarations; the override is not visible when reading only the CSS. Reviewers should pay particular attention to layout properties in inline styles.
3. **UI changes require testing at multiple window sizes** — Always verify that the layout does not overflow at the minimum supported window size, especially in scenarios involving fixed-width + `flex-shrink: 0` elements.
