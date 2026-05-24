import { atom } from '@/atom';
import { InlineFileDescriptor } from './InlineFilePreviewPanel';

// ─── Sub-Agent Tasks Sidepane ───

interface SubAgentTasksSidepaneState {
  visible: boolean;
  selectedTaskId: string | null;
}

export const SubAgentTasksSidepaneAtom = atom(
  { visible: false, selectedTaskId: null } as SubAgentTasksSidepaneState,
  (get, set, use) => ({
    show: () => set({ ...get(), visible: true }),
    hide: () => set({ visible: false, selectedTaskId: null }),
    effectiveToggle: () => {
      use(InlinePreviewAtom)[1].cancel();
      use(WorkspaceExplorerAtom)[1].setVisible(false);
      use(ScheduleSidepaneAtom)[1].hide();
      const cur = get();
      set({ visible: !cur.visible, selectedTaskId: cur.visible ? null : cur.selectedTaskId });
    },
    selectTask: (taskId: string) => set({ ...get(), selectedTaskId: taskId }),
    backToList: () => set({ ...get(), selectedTaskId: null }),
  })
);

// ─── Workspace Explorer ───

const zeroWorkspaceExplorerState: {
  visible: boolean;
  reveal?: { path: string; nonce: number };
} = { visible: false };

export const WorkspaceExplorerAtom = atom(zeroWorkspaceExplorerState, (get, set, use) => {
  function setReveal(path: string) {
    set({ ...get(), reveal: { path, nonce: Date.now() } });
  }
  function cancelReveal() {
    set({ ...get(), reveal: undefined });
  }
  function setVisible(visible: boolean) {
    set({ ...get(), visible });
  }

  function effectiveToggle() {
    const inlinePreviewActions = use(InlinePreviewAtom)[1];
    const scheduleActions = use(ScheduleSidepaneAtom)[1];
    const subAgentTasksActions = use(SubAgentTasksSidepaneAtom)[1];
    inlinePreviewActions.cancel();
    scheduleActions.hide();
    subAgentTasksActions.hide();
    const current = get();
    set({ ...current, visible: !current.visible });
  }

  function effectiveReveal(path: string) {
    const scheduleActions = use(ScheduleSidepaneAtom)[1];
    scheduleActions.hide();
    set({ visible: true, reveal: { path, nonce: Date.now() } });
  }

  return { setReveal, cancelReveal, setVisible, effectiveToggle, effectiveReveal };
});


export const ScheduleSidepaneAtom = atom(false, (get, set, use) => ({
  show: () => set(true),
  hide: () => set(false),
  effectiveShow: () => {
    const workspaceExplorerActions = use(WorkspaceExplorerAtom)[1];
    workspaceExplorerActions.setVisible(false);
    set(true);
  },
  effectiveToggle: () => {
    const inlinePreviewActions = use(InlinePreviewAtom)[1];
    inlinePreviewActions.cancel();
    const workspaceExplorerActions = use(WorkspaceExplorerAtom)[1];
    workspaceExplorerActions.setVisible(false);
    const subAgentTasksActions = use(SubAgentTasksSidepaneAtom)[1];
    subAgentTasksActions.hide();
    set(!get());
  },
}));

interface InlinePreviewState {
  isDirty: boolean;
  file: InlineFileDescriptor;
  width?: number;
};

export const InlinePreviewAtom = atom(null as InlinePreviewState | null, (get, set, use) => {
  function cancel() {
    set(null);
  }

  function open(file: InlineFileDescriptor) {
    const current = get();
    if (!current) {
      return set({ file, isDirty: false });
    }

    const prevKey = `${current.file.name}|${current.file.url}`;
    const nextKey = `${file.name}|${file.url}`;

    // behave as toggle
    if (prevKey === nextKey) {
      if (current.isDirty) {
        const discard = window.confirm('You have unsaved changes in the current preview. Do you want to discard them and open another file?');
        if (discard) set(null);
        return;
      }
      return set(null);
    }

    if (current.isDirty) {
      const discard = window.confirm('You have unsaved changes in the current preview. Do you want to discard them and open another file?');
      if (!discard) return;
    }
    set({ file, isDirty: false, width: current.width });
  }

  function markDirty(isDirty: boolean) {
    const current = get();
    if (current && current.isDirty !== isDirty) {
      set({ ...current, isDirty });
    }
  }

  function resize(e: React.MouseEvent ) {
    const current = get();
    if (!current) return;

    e.preventDefault();
    const wrapperEl = (e.currentTarget as HTMLElement).parentElement;
    if (!wrapperEl) return;
    const wrapperWidth = wrapperEl.getBoundingClientRect().width;
    const startX = e.clientX;
    const startPreviewWidth = current.width ?? wrapperWidth / 2;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const minWidth = wrapperWidth * 0.3;
      const maxWidth = wrapperWidth * 0.6;
      const next = Math.min(Math.max(startPreviewWidth + delta, minWidth), maxWidth);
      set({ ...current, width: next });
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

  return { cancel, open, markDirty, resize };
});
