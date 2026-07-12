import { atom } from '@/atom';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  agentName: string | null;
  isSubmitting: boolean;
}

const zeroState: State = {
  isOpen: false,
  chatId: null,
  agentName: null,
  isSubmitting: false,
};

export const ArchiveConfirmAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function show(chatId: string, agentName: string) {
    set({ isOpen: true, chatId, agentName, isSubmitting: false });
  }

  async function confirm(toast: ToastContextType, t: TFunction = fallbackT) {
    const { chatId, agentName, isSubmitting } = get();
    if (!chatId || isSubmitting) return;

    set({ isOpen: true, chatId, agentName, isSubmitting: true });

    const { showSuccess, showError } = toast;
    try {
      if (!window.electronAPI?.profile?.archiveChatConfig) {
        showError(t('overlay.archive.apiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.archiveChatConfig(chatId);

      if (result.success) {
        showSuccess(t('overlay.archive.success', { name: agentName ?? '' }));
        await profileDataManager.refresh();
      } else {
        showError(t('overlay.archive.failed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('overlay.archive.failed', { error: errorMessage }));
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, show };
});

export function ArchiveOverlay() {
  const [state, actions] = ArchiveConfirmAtom.use();
  const toast = useToast();
  const { t } = useI18n();

  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={() => actions.cancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('overlay.archive.title')}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2 text-sm text-neutral-600">
          <p>
            {t('overlay.archive.confirm')}{' '}
            <strong className="font-semibold text-neutral-900">{state.agentName}</strong>?
          </p>
          <DialogDescription>
            {t('overlay.archive.restoreHint')}
          </DialogDescription>
        </div>
        <DialogFooter className="mt-6">
          <button className="btn-secondary" onClick={actions.cancel} type="button">
            {t('common.cancel')}
          </button>
          <button
            className="btn-danger"
            disabled={state.isSubmitting}
            onClick={() => actions.confirm(toast, t)}
            type="button"
          >
            {state.isSubmitting ? t('overlay.archive.archiving') : t('overlay.archive.title')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
