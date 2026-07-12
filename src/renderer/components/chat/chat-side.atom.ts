import { atom } from '@/atom';
import { InlineFileDescriptor } from './InlineFilePreviewPanel';
import { translate } from '../../lib/i18n';
import { UiLanguageAtom } from '../../states/i18n.atom';

// ─── Sub-Agent Tasks Sidepane ───

interface SubAgentTasksSidepaneState {
  visible: boolean;
  selectedTaskId: string | null;
}

export const SubAgentTasksSidepaneAtom = atom(
  { visible: false, selectedTaskId: null } as SubAgentTasksSidepaneState,
  (get, set, use) => ({
    // Opening this singleton sidepane closes the other three (four-singleton
    // mutual exclusion), matching effectiveToggle's full-exclusion set.
    show: () => {
      use(WorkspaceExplorerAtom)[1].setVisible(false);
      use(ScheduleSidepaneAtom)[1].hide();
      use(MemexMemorySidepaneAtom)[1].hide();
      set({ ...get(), visible: true });
    },
    hide: () => set({ visible: false, selectedTaskId: null }),
    effectiveToggle: () => {
      use(WorkspaceExplorerAtom)[1].setVisible(false);
      use(ScheduleSidepaneAtom)[1].hide();
      use(MemexMemorySidepaneAtom)[1].hide();
      const cur = get();
      set({ visible: !cur.visible, selectedTaskId: cur.visible ? null : cur.selectedTaskId });
    },
    selectTask: (taskId: string) => set({ ...get(), selectedTaskId: taskId }),
    backToList: () => set({ ...get(), selectedTaskId: null }),
  })
);

// ─── Memex Memory Sidepane ───
// Per-agent Zettelkasten memory inspector. `selectedSlug` drives the
// list ↔ detail navigation, mirroring the Sub-Agent Tasks sidepane shape.
// It is a fourth singleton sidepane: opening it closes Workspace Explorer
// (which also tears down any file preview), Schedules, and Sub-Agent Tasks.

interface MemexMemorySidepaneState {
  visible: boolean;
  selectedSlug: string | null;
}

export const MemexMemorySidepaneAtom = atom(
  { visible: false, selectedSlug: null } as MemexMemorySidepaneState,
  (get, set, use) => ({
    show: () => {
      use(WorkspaceExplorerAtom)[1].setVisible(false);
      use(ScheduleSidepaneAtom)[1].hide();
      use(SubAgentTasksSidepaneAtom)[1].hide();
      set({ ...get(), visible: true });
    },
    hide: () => set({ visible: false, selectedSlug: null }),
    effectiveToggle: () => {
      use(WorkspaceExplorerAtom)[1].setVisible(false);
      use(ScheduleSidepaneAtom)[1].hide();
      use(SubAgentTasksSidepaneAtom)[1].hide();
      const cur = get();
      set({ visible: !cur.visible, selectedSlug: cur.visible ? null : cur.selectedSlug });
    },
    selectCard: (slug: string) => set({ ...get(), selectedSlug: slug }),
    backToList: () => set({ ...get(), selectedSlug: null }),
  })
);

// ─── Workspace Explorer ───
//
// Two view modes share one sidepane:
//   - 'explorer': the file tree (Agent Knowledge Files + Chat Session Deliverables)
//   - 'preview':  a single file rendered by InlineFilePreviewPanel
//
// A preview's `origin` decides its header affordances and session-switch behavior:
//   - 'tree' (opened from the file tree): header shows a back arrow → returns to
//     explorer; switching chat sessions falls back to explorer.
//   - 'chat' (opened from a chat file chip / tool result / attachment): no back
//     arrow; switching chat sessions closes the whole sidepane.
// The X (close) button always destroys the sidepane regardless of origin.

export type WorkspaceMode = 'explorer' | 'preview';

export interface WorkspacePreview {
  file: InlineFileDescriptor;
  origin: 'tree' | 'chat';
  isDirty: boolean;
  width?: number;
}

interface WorkspaceExplorerState {
  visible: boolean;
  mode: WorkspaceMode;
  preview?: WorkspacePreview;
  reveal?: { path: string; nonce: number };
}

const zeroWorkspaceExplorerState: WorkspaceExplorerState = {
  visible: false,
  mode: 'explorer',
};

const PREVIEW_MIN_WIDTH_RATIO = 0.3;
const PREVIEW_MAX_WIDTH_RATIO = 0.6;
export const WorkspaceExplorerAtom = atom(zeroWorkspaceExplorerState, (get, set, use) => {
  function getDiscardPrompt(): string {
    const language = use(UiLanguageAtom)[0];
    return translate(language, 'workspace.preview.discardSwitchConfirm');
  }

  function setReveal(path: string) {
    set({ ...get(), reveal: { path, nonce: Date.now() } });
  }
  function cancelReveal() {
    set({ ...get(), reveal: undefined });
  }

  // Hiding the sidepane fully resets it: drop back to explorer mode and destroy
  // any preview. Showing it leaves the current mode untouched.
  function setVisible(visible: boolean) {
    if (!visible) {
      set({ ...get(), visible: false, mode: 'explorer', preview: undefined });
    } else {
      set({ ...get(), visible: true });
    }
  }

  // Header folder icon: toggle the sidepane, always landing in explorer mode.
  function effectiveToggle() {
    use(ScheduleSidepaneAtom)[1].hide();
    use(SubAgentTasksSidepaneAtom)[1].hide();
    use(MemexMemorySidepaneAtom)[1].hide();
    const current = get();
    set({ ...current, visible: !current.visible, mode: 'explorer', preview: undefined });
  }

  // Reveal-and-highlight a path in the tree (e.g. from KB say-hi cards).
  function effectiveReveal(path: string) {
    use(ScheduleSidepaneAtom)[1].hide();
    use(SubAgentTasksSidepaneAtom)[1].hide();
    use(MemexMemorySidepaneAtom)[1].hide();
    set({ visible: true, mode: 'explorer', preview: undefined, reveal: { path, nonce: Date.now() } });
  }

  // Open a file in Preview mode. `origin` is the entry point (see header note).
  function openPreview(file: InlineFileDescriptor, origin: 'tree' | 'chat') {
    use(ScheduleSidepaneAtom)[1].hide();
    use(SubAgentTasksSidepaneAtom)[1].hide();
    use(MemexMemorySidepaneAtom)[1].hide();

    const current = get();
    const prev = current.preview;

    if (prev && current.mode === 'preview') {
      const prevKey = `${prev.file.name}|${prev.file.url}`;
      const nextKey = `${file.name}|${file.url}`;

      // Re-opening the currently previewed file toggles it off, respecting the
      // CURRENT preview's origin: tree → back to explorer, chat → close sidepane.
      if (prevKey === nextKey) {
        if (prev.isDirty && !window.confirm(getDiscardPrompt())) return;
        if (prev.origin === 'tree') {
          set({ ...current, mode: 'explorer', preview: undefined });
        } else {
          set({ visible: false, mode: 'explorer', preview: undefined });
        }
        return;
      }

      // Switching to a different file while the current one is dirty needs a guard.
      if (prev.isDirty && !window.confirm(getDiscardPrompt())) return;
      set({
        ...current,
        visible: true,
        mode: 'preview',
        preview: { file, origin, isDirty: false, width: prev.width },
      });
      return;
    }

    set({
      ...current,
      visible: true,
      mode: 'preview',
      preview: { file, origin, isDirty: false, width: prev?.width },
    });
  }

  // The back arrow (tree-origin previews only): return to the file tree.
  function backToExplorer() {
    set({ ...get(), mode: 'explorer', preview: undefined });
  }

  // Mirror the preview panel's dirty state so file-switch guards work.
  function markPreviewDirty(isDirty: boolean) {
    const current = get();
    if (current.preview && current.preview.isDirty !== isDirty) {
      set({ ...current, preview: { ...current.preview, isDirty } });
    }
  }

  // Drag the left-edge divider to resize the preview (30–60% of the wrapper).
  // Mirrors the former InlinePreviewAtom.resize, writing preview.width.
  function resizePreview(e: React.MouseEvent) {
    const current = get();
    if (!current.preview) return;

    e.preventDefault();
    const wrapperEl = (e.currentTarget as HTMLElement).parentElement;
    if (!wrapperEl) return;
    const wrapperWidth = wrapperEl.getBoundingClientRect().width;
    const startX = e.clientX;
    const startPreviewWidth = current.preview.width ?? wrapperWidth / 2;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const minWidth = wrapperWidth * PREVIEW_MIN_WIDTH_RATIO;
      const maxWidth = wrapperWidth * PREVIEW_MAX_WIDTH_RATIO;
      const next = Math.min(Math.max(startPreviewWidth + delta, minWidth), maxWidth);
      const cur = get();
      if (!cur.preview) return;
      set({ ...cur, preview: { ...cur.preview, width: next } });
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
  }

  // Chat session switched: tree-origin previews fall back to explorer, chat-origin
  // previews close the sidepane (matches the legacy "switch closes preview").
  function onSessionSwitch() {
    const current = get();
    if (current.mode !== 'preview' || !current.preview) return;
    if (current.preview.origin === 'tree') {
      set({ ...current, mode: 'explorer', preview: undefined });
    } else {
      set({ visible: false, mode: 'explorer', preview: undefined });
    }
  }

  return {
    setReveal,
    cancelReveal,
    setVisible,
    effectiveToggle,
    effectiveReveal,
    openPreview,
    backToExplorer,
    markPreviewDirty,
    resizePreview,
    onSessionSwitch,
  };
});


export const ScheduleSidepaneAtom = atom(false, (get, set, use) => ({
  show: () => set(true),
  hide: () => set(false),
  effectiveShow: () => {
    const workspaceExplorerActions = use(WorkspaceExplorerAtom)[1];
    workspaceExplorerActions.setVisible(false);
    use(SubAgentTasksSidepaneAtom)[1].hide();
    use(MemexMemorySidepaneAtom)[1].hide();
    set(true);
  },
  effectiveToggle: () => {
    const workspaceExplorerActions = use(WorkspaceExplorerAtom)[1];
    workspaceExplorerActions.setVisible(false);
    const subAgentTasksActions = use(SubAgentTasksSidepaneAtom)[1];
    subAgentTasksActions.hide();
    use(MemexMemorySidepaneAtom)[1].hide();
    set(!get());
  },
}));
