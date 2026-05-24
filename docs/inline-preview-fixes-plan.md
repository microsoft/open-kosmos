# InlineFilePreviewPanel Fixes and Enhancements Plan

## Involved Files

| File | Role |
|------|------|
| `src/renderer/components/chat/InlineFilePreviewPanel.tsx` | Preview panel main component |
| `src/renderer/styles/InlineFilePreviewPanel.css` | Preview panel styles |
| `src/renderer/components/chat/ChatViewContent.tsx` | Parent component, manages preview state, renders resizer |
| `src/renderer/styles/ChatContainer.css` | chat-content-wrapper layout styles |

---

## Issue 1: Confirmed Button Positions (No Changes Needed)

6 buttons on the header right side have been confirmed:
- Toggle render/source (Code/Eye) — HTML/Markdown exclusive
- Edit (Pencil) — locally editable files
- Open externally (ExternalLink)
- Show in folder (Download)
- Fullscreen (Monitor/Minimize)
- Close (X)

**Conclusion: No code changes.**

---

## Issue 2: Markdown Bullet Points Not Rendering (Bug Fix)

### Root Cause
TailwindCSS preflight globally resets `list-style` to `none` for `ul, ol`.
The CSS for `.inline-preview-markdown` only restored `padding-left` and `margin`, without restoring `list-style-type`.

### Fix Plan
Add to `InlineFilePreviewPanel.css`:

```css
/* Existing rules */
.inline-preview-markdown ul,
.inline-preview-markdown ol { padding-left: 1.5em; margin: 0.5em 0; }

/* New addition */
.inline-preview-markdown ul { list-style-type: disc; }
.inline-preview-markdown ol { list-style-type: decimal; }
```

### Impact Scope
- Only affects list rendering within `.inline-preview-markdown`
- Does not affect the chat message area (which has its own independent CSS)
- No difference between Win/Mac

---

## Issue 3: Font Size Too Small

### Current State

| Content Type | Current Size | Controlled By |
|---------|---------|---------|
| Markdown body | 14px, line-height: 1.7 | CSS `.inline-preview-markdown` |
| Markdown h1 | 1.6em (≈22.4px) | CSS |
| Markdown h2 | 1.35em (≈18.9px) | CSS |
| Markdown h3 | 1.15em (≈16.1px) | CSS |
| Markdown code block | 13px | CSS `pre` |
| Markdown inline code | 0.88em (≈12.3px) | CSS `code` |
| Markdown table | 13px | CSS `table` |
| Monaco (code/text/JSON) | fontSize: 13, lineHeight: 21 | TSX hardcoded |

### Modification Plan
Increase overall, maintaining proportional relationships between elements:

| Content Type | Current → Adjusted |
|---------|-------------|
| Markdown body | 14px → 15px, line-height 1.7 → 1.75 |
| Markdown h1 | 1.6em → 1.7em |
| Markdown h2 | 1.35em → 1.4em |
| Markdown h3 | 1.15em → 1.2em |
| Markdown code block | 13px → 14px |
| Markdown inline code | 0.88em → 0.9em |
| Markdown table | 13px → 13.5px |
| Monaco fontSize | 13 → 14 |
| Monaco lineHeight | 21 → 22 |

### Change Locations
1. `InlineFilePreviewPanel.css` — All `.inline-preview-markdown` related font sizes
2. `InlineFilePreviewPanel.tsx` — `ReadonlyMonacoViewer` component's `fontSize` and `lineHeight` (L199-200)
3. `InlineFilePreviewPanel.tsx` — Edit mode Monaco's `fontSize` and `lineHeight` (L395-396)

### Impact Scope
- Only affects rendering within the inline preview panel
- No difference between Win/Mac

---

## Issue 4: Drag-to-Resize Width

### Current Layout
```
.chat-content-wrapper (display: flex; flex-direction: row)
  ├─ .chat-content (flex: 1)
  └─ InlineFilePreviewPanel (flex: 1)
```
Fixed 50/50 split, no user adjustment capability.

### Modification Plan

#### 4.1 Add Resizer Divider
In `ChatViewContent.tsx`, insert a draggable divider before `InlineFilePreviewPanel`:

```tsx
{isInlinePreviewOpen && (
  <>
    <div
      className="inline-preview-resizer"
      onMouseDown={handleResizeStart}
    />
    <InlineFilePreviewPanel ... />
  </>
)}
```

#### 4.2 State Management
Add to `ChatViewContent.tsx`:

```typescript
const [previewWidth, setPreviewWidth] = useState<number | null>(null);
// null = default 50/50; number = preview panel pixel width
```

#### 4.3 Drag Logic
```typescript
const handleResizeStart = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  const startX = e.clientX;
  const wrapperEl = e.currentTarget.parentElement;
  if (!wrapperEl) return;
  const wrapperWidth = wrapperEl.getBoundingClientRect().width;
  const startPreviewWidth = previewWidth ?? wrapperWidth / 2;

  const onMouseMove = (ev: MouseEvent) => {
    const delta = startX - ev.clientX; // drag left = preview gets wider
    const newWidth = Math.min(
      Math.max(startPreviewWidth + delta, 300),        // min 300px
      wrapperWidth * 0.7                                // max 70%
    );
    setPreviewWidth(newWidth);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, [previewWidth]);
```

#### 4.4 Width Application
- When `previewWidth` has a value, preview panel uses `style={{ flex: '0 0 ${previewWidth}px' }}`
- When `previewWidth` is null, keep default `flex: 1` (50/50)
- Reset `previewWidth = null` when preview is closed

#### 4.5 Constraints
- Preview panel minimum width: 300px
- Preview panel maximum width: 70% of container
- Chat area minimum width: guaranteed by flex: 1 + min-width (no less than 30%)
- Width resets after closing preview, not persisted

#### 4.6 Resizer Styles
```css
.inline-preview-resizer {
  flex-shrink: 0;
  width: 6px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 10;
  transition: background 0.15s ease;
}

.inline-preview-resizer:hover,
.inline-preview-resizer:active {
  background: rgba(14, 165, 233, 0.3);
}
```

#### 4.7 Cross-platform
- `cursor: col-resize` — supported on both Win/Mac
- `user-select: none` — prevents text selection during dragging, consistent behavior on both platforms
- `mousedown/mousemove/mouseup` — standard DOM events, no platform differences
- Mac titlebar drag area is not affected (resizer is inside the content area)

---

## Change Checklist Overview

| Step | File | Change Description |
|------|------|---------|
| 1 | `InlineFilePreviewPanel.css` | Add `list-style-type` to fix bullet points |
| 2 | `InlineFilePreviewPanel.css` | Increase markdown heading sizes |
| 3 | `InlineFilePreviewPanel.tsx` | Increase Monaco fontSize/lineHeight (both readonly + edit) |
| 4 | `ChatViewContent.tsx` | Add resizer divider + drag logic + previewWidth state |
| 5 | `InlineFilePreviewPanel.css` | Add `.inline-preview-resizer` styles |
| 6 | `InlineFilePreviewPanel.tsx` | Accept optional `style` prop for dynamic width |

## Branch Naming Suggestion
`user/<alias>/inline-preview-enhancements`
