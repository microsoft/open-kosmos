# Cross-Platform Sidebar Toggle Evaluation

## Background

A new frontend change is being considered:

- Add a button for collapsing / hiding the left sidebar.
- Support both Windows and macOS.
- The button position may differ between platforms.
- The interaction details may also differ slightly between platforms.
- This document is for evaluation only.
- No code changes are included in this proposal.

The current repository context is important:

- The app is an Electron desktop application with a React renderer.
- Windows currently uses a custom title bar area.
- macOS keeps a more native top window presentation.
- The existing UI already has a visible left sidebar whose width affects the main layout.
- A recent zoom PR established a practical precedent that cross-platform behavior may be shared functionally while still differing visually by platform.

---

## Goal

The desired feature is a global, discoverable control that allows users to:

- collapse or hide the left sidebar,
- reclaim more horizontal space for the main content,
- find the control easily on both Windows and macOS,
- preserve a platform-appropriate user experience.

This is not only a visual change. It affects:

- layout behavior,
- persistent UI state,
- top-area interaction patterns,
- possible keyboard shortcut decisions,
- and platform-specific affordances.

---

## High-Level Assessment

## Difficulty

Overall difficulty: **medium**.

This is not a trivial one-line button addition, but it is also not a high-risk architectural rewrite.

The easy part:

- adding a button,
- toggling a boolean state,
- updating CSS / layout width,
- making the main content expand when the sidebar collapses.

The harder part:

- deciding where the button should live on each platform,
- ensuring the collapsed state works consistently across pages,
- handling responsive layout edge cases,
- deciding whether the state should persist across sessions,
- avoiding conflicts with draggable title-bar regions,
- making sure the UX feels native enough on Windows and macOS.

### Practical conclusion

If the first version is limited to:

- one button,
- one collapsed state,
- one consistent behavior,
- no fancy animation,
- no deep customization,

then implementation complexity should stay moderate and manageable.

If the feature later expands to include:

- animation polish,
- persistent state,
- keyboard shortcuts,
- compact collapsed icon rail,
- page-specific adaptations,
- or top-bar platform-specific visual polish,

then complexity rises from medium to medium-high.

---

## Recommended Product Scope

To keep the feature shippable, the first version should answer these three questions clearly:

1. Is the sidebar **fully hidden** or **collapsed into a narrow rail**?
2. Is the state **temporary for the current session** or **persisted across restarts**?
3. Is this a **mouse-only affordance** initially, or should it also include a shortcut?

### Strong recommendation for v1

For the first version, the safest scope is:

- one visible toggle button,
- full collapse or clear-width reduction,
- content area expands accordingly,
- state optionally persisted if implementation is straightforward,
- no keyboard shortcut unless there is strong product demand.

This keeps the implementation understandable and reduces regression risk.

---

## Branching Strategy Recommendation

A new branch should definitely be created.

### Why a separate branch is needed

This feature is conceptually separate from the previous zoom work.
It should not be mixed into the zoom PR or any other already-reviewed feature.

A separate branch gives:

- cleaner review scope,
- easier rollback if needed,
- better commit clarity,
- less reviewer confusion,
- and simpler future maintenance.

### Best timing

The ideal timing is:

- after the previous PR is merged,
- or at least after it becomes stable and unlikely to change.

That is the cleanest workflow because the new branch can start from the latest `main` and avoid rebasing against moving feature history.

### If work must start before merge

It is still possible to start earlier, but there are tradeoffs.

In that case, the branch can be created from the current feature branch, but this creates potential follow-up work:

- if the previous PR changes before merge,
- or if the previous branch is rebased,
- or if additional fixes are needed,

then the new sidebar-toggle branch may also need rebasing or cleanup.

### Recommendation

Best option:

- wait until the previous PR is stable or merged,
- then create a fresh branch from the latest `origin/main`.

Fallback option:

- if product urgency exists, create the branch earlier,
- but expect that a later rebase may be necessary.

---

## Cross-Platform UX Recommendation

The feature should be functionally cross-platform but not necessarily visually identical.

That distinction matters.

### What should be consistent across platforms

The following should stay consistent:

- the existence of a sidebar toggle,
- the semantic behavior of collapse / expand,
- the effect on available content width,
- state naming and persistence rules,
- and the user's mental model.

### What can differ by platform

These can differ:

- the exact button position,
- surrounding spacing,
- hover styling,
- title-bar adjacency,
- and whether the control appears inside a title-bar region or inside a page-level top area.

This is the right kind of platform difference.

---

## Placement Recommendation

## Windows

Recommended placement: **inside the existing custom title bar area**.

### Why this is preferred

Windows already uses a custom title bar pattern in this app.
That means a top-level control in that area is both technically natural and visually consistent with the current design approach.

Windows users also generally accept controls like:

- navigation shortcuts,
- menus,
- window state controls,
- and global layout toggles,

in the custom title area.

### Best location on Windows

Preferred options, in order:

1. Near the existing top-left application/title area.
2. Near the existing menu / hamburger area if that cluster already functions as the main top utility zone.
3. In the same top horizontal band as existing global controls, but separated enough to avoid confusion with window controls.

### What to avoid on Windows

Avoid placing the sidebar toggle:

- too close to minimize / maximize / close controls,
- in a way that visually competes with the menu button,
- or deep inside page content where it becomes hard to discover.

### Windows summary

Windows is the easier platform for this feature from a placement standpoint.
A title-bar-adjacent button is reasonable and likely the best choice.

---

## macOS

Recommended placement: **top-left of the content/header region, visually near the window's upper-left area, but not forced into the native traffic-light region**.

### Why not place it inside the native traffic-light zone

Although many macOS apps visually align sidebar toggles near the traffic lights, doing so in Electron can be more delicate.

Potential issues include:

- overlap with draggable regions,
- click-target conflicts,
- visual inconsistency with the native title area,
- and a result that feels like a Windows title-bar control transplanted into macOS.

### Better macOS approach

A safer and more native-feeling approach is:

- place the toggle in the top-left of the content area,
- keep it visually close to the upper-left corner,
- align it so users mentally associate it with the sidebar,
- but keep it structurally inside the app content/header layout rather than inside the native title-bar control region.

### Why this works

It achieves three goals:

1. The control remains easy to find.
2. It feels compatible with macOS window layout conventions.
3. It avoids fragile title-bar hit testing and layout conflicts.

### macOS summary

For macOS, the best practical compromise is:

- top-left,
- visually near the traffic-light area,
- but implemented as part of the app's content/header area.

---

## Should the button be in the exact same location on both platforms?

No.

That is not necessary and probably not desirable.

### Better principle

Use **platform-consistent semantics**, not **pixel-identical placement**.

That means:

- both platforms should have a clearly visible sidebar toggle,
- both should collapse and expand the same sidebar,
- both should preserve the same state behavior,
- but the button may sit in different top regions.

This is the most realistic way to deliver a cross-platform feature without harming native feel.

---

## Collapse Behavior Recommendation

There are two main patterns:

### Option A — Fully hide the sidebar

Behavior:

- sidebar disappears,
- main content expands to use full width,
- toggle is the only way to bring it back.

Pros:

- maximum space gain,
- simple visual model,
- useful for focused work.

Cons:

- can feel abrupt,
- may reduce discoverability of sidebar content,
- requires careful thought about how to restore it if the button itself visually shifts.

### Option B — Collapse to a narrow rail

Behavior:

- sidebar shrinks,
- icons or minimal affordances remain,
- full width is not completely reclaimed.

Pros:

- better discoverability,
- users retain navigation anchor points,
- common in productivity apps.

Cons:

- more layout work,
- more design decisions,
- less total space recovered.

### Recommendation

If the existing sidebar is text-heavy and not already icon-structured, then **full hide** is the safer v1.

If the product already has a strong icon language and expects frequent toggling, then a narrow rail could become a later improvement.

For v1, full hide is likely simpler and less risky.

---

## State Persistence Recommendation

This is an important product decision.

### Option 1 — Session-only state

Pros:

- simplest implementation,
- fewer persistence concerns,
- lower risk.

Cons:

- users who always prefer collapsed mode must repeat the action every launch.

### Option 2 — Persist across restarts

Pros:

- better user respect for preference,
- more polished experience.

Cons:

- requires deciding whether the state is app-level or profile-level,
- requires migration/default behavior consideration,
- slightly more implementation and testing overhead.

### Recommendation

If this is intended as a real product-level layout preference, persistence is worth considering.

However, for a first version, persistence should only be included if:

- the storage scope is clear,
- the layout remains stable across startup scenarios,
- and there is confidence the state will not create hidden navigation confusion.

If uncertainty exists, session-only is acceptable for v1.

---

## Keyboard Shortcut Recommendation

This is optional.

A sidebar toggle often maps naturally to something like:

- Windows: `Ctrl+B`
- macOS: `Cmd+B`

But there are tradeoffs:

- shortcut conflicts may exist,
- chat/editor inputs may already use related combinations,
- and shortcut scope should be carefully defined.

### Recommendation

Do not make shortcut support mandatory for the first version unless there is explicit product demand.
Focus first on:

- visible toggle button,
- reliable collapse behavior,
- layout correctness.

Shortcut support can be a second-step enhancement.

---

## Technical Risk Areas

The biggest risks are not the button component itself. They are the surrounding layout and platform details.

### 1. Layout ripple effects

When the sidebar hides, other regions may need to resize correctly:

- main content width,
- internal scroll containers,
- empty states,
- chat panels,
- settings pages,
- responsive breakpoints.

### 2. Top-area hit testing

Especially on macOS, if the button is placed too close to native title-bar conventions, draggable regions and click interactions can become fragile.

### 3. Visual consistency across routes

If different pages already have different top spacing or header treatments, the button may look aligned on one page and awkward on another.

### 4. Sidebar restoration discoverability

If the sidebar fully disappears, the restore control must remain obvious and stable.

### 5. Persistence edge cases

If the app launches in collapsed mode, the initial layout must still be correct before the first paint or very soon after it.

---

## Suggested Minimum Viable Version

A good MVP would be:

- one sidebar toggle button,
- visible on both Windows and macOS,
- Windows placement in custom title bar,
- macOS placement at top-left of the content/header region,
- full collapse behavior,
- no shortcut initially,
- persistence only if easy and safe,
- no advanced animation required.

This version would validate:

- discoverability,
- utility,
- cross-platform acceptance,
- and layout stability.

---

## Suggested Better-Polish Version

After MVP proves stable, a more polished version could add:

- smooth collapse/expand animation,
- persisted preference,
- optional shortcut,
- better compact-mode styling,
- or a future narrow-rail mode.

These should be considered follow-up enhancements, not first-iteration requirements.

---

## Recommendation Summary

### Difficulty

- Medium.
- Not hard conceptually.
- Main complexity comes from layout integration and platform-specific top-area placement.

### Branch timing

- Use a new branch.
- Best time: after the previous PR is merged or clearly stable.
- Starting earlier is possible, but raises the chance of needing a later rebase.

### Placement

- Windows: place the toggle in the custom title bar region.
- macOS: place it in the top-left content/header region, visually near the upper-left corner but not forced into the native traffic-light zone.

### Product scope

- Prefer a smaller first version.
- Start with full collapse/hide.
- Keep persistence optional.
- Treat shortcut support as optional, not mandatory.

### Overall judgment

This feature is worth doing and is technically feasible without unusual risk.
The most important design decision is not whether a button can be added, but where each platform should own that button so the result feels intentional rather than improvised.

---

## Final Recommendation

Proceed with a dedicated sidebar-toggle feature branch once the current zoom work is stable enough.

Use a platform-aware placement strategy:

- Windows: custom title bar button.
- macOS: top-left content/header button.

Keep the first version focused and avoid over-designing the initial implementation.

The feature is feasible, reviewable, and likely to provide meaningful UX value if the placement and collapse behavior are chosen carefully.

---

## Confirmed v1 Plan

Based on the current discussion, the v1 sidebar toggle plan is essentially finalized and can serve as a direct basis for subsequent implementation.

### 1. Interaction Goals

- Provide a collapse / expand button for the left sidebar.
- v1 adopts a "fully hidden" approach, not a narrow rail collapse.
- After hiding, the main content area expands directly without any extra blank placeholder space.
- The button maintains a consistent position before and after the sidebar is hidden; the current state is reflected only through icon color or active state.

### 2. Platform Placement Plan

#### Windows

- Place in the existing custom title bar area.
- Recommended button order: sidebar button, search button, hamburger button.
- If the search button is not displayed, do not leave an empty slot; subsequent buttons naturally shift forward.

#### macOS

- The goal is to have the button visually adjacent to the right of the traffic lights.
- But implementation should not forcefully depend on the actual native title bar / traffic light control region.
- The safer approach is: place it in the top-left of the content area so the visual effect is as close to the right of the traffic lights as possible.

### 3. Animation and Keyboard Shortcuts

- v1 retains simple animation; no complex transitions needed.
- v1 does not implement keyboard shortcuts.

### 4. State Scope

- The current discussion outcome has been updated: this state should be designed as an app-level preference.
- The reason is that showing/hiding the left sidebar is more like an application-level layout preference rather than a temporary UI state in a single session.
- Users typically expect "I collapsed the sidebar last time; it should stay that way the next time I open the app."
- Therefore, this state should persist across restarts, not just within the current session.

### 5. Persistence Conclusion

- The current inclination is now clear: design v1 with app-level persistence from the start.
- No longer treat it as a purely temporary renderer-internal state.
- During implementation, prefer using the `app.json` / `AppCacheManager` / `AppDataManager` app-level data flow.

---

## Supplementary Notes on userDataADO/README Walkthrough Requirements

After further discussion, the current conclusion has changed:

- This sidebar toggle requirement should be designed as an **app-level feature**.
- It is no longer treated as a purely temporary UI state with "persistence TBD."
- It is also no longer preferred to bypass the standard process in `src/main/lib/userDataADO/README.md`.

The reasoning is:

- Showing/hiding the left sidebar is an application-level layout preference;
- It is not attached to a specific session's short-lived interaction;
- Users are more likely to expect "I collapsed the sidebar last time; the next time I open the app it should remain in that state";
- Therefore its semantics are closer to `app-level` than `profile-level` or a single-use renderer state.

### Current Definitive Conclusion

- During subsequent implementation, follow the app-level config requirements in `src/main/lib/userDataADO/README.md`.
- That means if this requirement enters implementation, it should in principle cover:
	- `resources/examples/app.json`
	- `src/main/lib/userDataADO/types/app.ts`
	- `AppCacheManager.integrityEnsure()`
	- `AppCacheManager.appConfigSanitize()`
	- The `updateConfig()` merge logic if necessary
	- Renderer reads via `AppDataManager`
	- Renderer writes via `appDataManager.updateConfig()`

### Additional Notes

- Although earlier discussions considered whether this was more like a temporary UI state, based on the current product semantics, that path is no longer the priority.
- The more reasonable approach now is: treat it as a proper app-level layout preference from the beginning.
- This avoids the additional refactoring cost of migrating from a temporary state to a formal configuration later.

### Documentation Constraint Conclusion

> The current sidebar toggle requirement should be treated as an app-level feature and designed and implemented following the standard process in `src/main/lib/userDataADO/README.md`.
