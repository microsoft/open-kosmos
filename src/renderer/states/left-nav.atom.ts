import { atom } from '@/atom';
import { appDataManager } from '@/lib/userData/appDataManager';
import { handleDrag } from '@/lib/utils/drag';

const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 288;
const MAX_WIDTH = 400;

interface LeftNaveSizeState {
  width: number;
  resizing?: boolean;
}

const defaultLeftNavSizeState: LeftNaveSizeState = {
  width: DEFAULT_WIDTH,
};

export const LeftNavSizeAtom = atom(defaultLeftNavSizeState, (get, set) => {
  appDataManager.subscribe((config) => {
    const width = config.leftSidebarWidth;
    if (width !== undefined) set({ width });
  });

  function startResize(event: React.MouseEvent | MouseEvent) {
    const { width } = get();
    handleDrag(event, {
      onMove({ offset, first }) {
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width + offset.x));
        set({ width: next, resizing: true });
      },
      onEnd({ offset }) {
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width + offset.x));
        set({ width: next, resizing: false });
        if (next !== width) {
          appDataManager.updateConfig({ leftSidebarWidth: next });
        }
      },
    });
  }

  return { startResize };
});

export const LeftNavCollapsedAtom = atom(false, (get, set) => {
  appDataManager.subscribe((config) => {
    const collapsed = config.leftSidebarCollapsed;
    if (collapsed !== undefined) set(collapsed);
  });

  function toggle() {
    const next = !get();
    set(next);
    appDataManager.updateConfig({ leftSidebarCollapsed: next });
  }

  function change(next: boolean) {
    if (next === get()) return;
    set(next);
    appDataManager.updateConfig({ leftSidebarCollapsed: next });
  }

  return { toggle, change };
});
