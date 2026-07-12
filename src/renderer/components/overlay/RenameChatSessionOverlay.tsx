import { atom } from '@/atom';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { translate, type TranslationKey, type TranslationParams } from '../../lib/i18n';
import { useI18n } from '../../lib/i18n/useI18n';

type TFunction = (key: TranslationKey, params?: TranslationParams) => string;
const fallbackT: TFunction = (key, params) => translate('en', key, params);

interface State {
  isOpen: boolean;
  chatId: string | null;
  sessionId: string | null;
  newTitle: string;
}

const zeroState: State = {
  isOpen: false,
  chatId: null,
  sessionId: null,
  newTitle: '',
};

export const RenameChatSessionAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(chatId: string, sessionId: string, title: string) {
    set({ isOpen: true, chatId, sessionId, newTitle: title });
  }

  function setNewTitle(newTitle: string) {
    set({ ...get(), newTitle });
  }

  async function confirm(toast: ToastContextType, t: TFunction = fallbackT) {
    const { chatId, sessionId, newTitle } = get();

    if (!chatId || !sessionId || !newTitle.trim()) return;

    try {
      const profileCache = profileDataManager.getCache();
      const alias = profileCache?.profile?.alias;

      if (!alias) {
        toast.showError(t('overlay.rename.userNotAuthenticated'));
        return;
      }

      const result = await window.electronAPI?.profile?.renameChatSession(
        alias,
        chatId,
        sessionId,
        newTitle.trim(),
      );

      if (result?.success) {
        toast.showSuccess(t('overlay.rename.success'));
      } else {
        toast.showError(result?.error || t('overlay.rename.failed'));
      }
    } catch (error) {
      toast.showError(t('overlay.rename.failed'));
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, show, setNewTitle };
});

export function RenameChatSessionOverlay() {
  const [state, actions] = RenameChatSessionAtom.use();
  const toast = useToast();
  const { t } = useI18n();

  if (!state.isOpen) return null;
  return (
    <Dialog open={state.isOpen} onOpenChange={() => actions.cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('overlay.rename.title')}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <p className="text-sm text-neutral-600">{t('overlay.rename.description')}</p>
          <input
            type="text"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
            value={state.newTitle}
            onChange={(e) => actions.setNewTitle(e.target.value)}
            placeholder={t('overlay.rename.placeholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && state.newTitle.trim()) {
                actions.confirm(toast, t);
              }
            }}
          />
        </div>
        <DialogFooter className="mt-6">
          <button className="btn-secondary" onClick={actions.cancel} type="button">
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={() => actions.confirm(toast, t)}
            disabled={!state.newTitle.trim()}
            type="button"
          >
            {t('common.rename')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
