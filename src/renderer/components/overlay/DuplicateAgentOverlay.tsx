import { atom } from '@/atom';
import { UiLanguageAtom } from '@/states/i18n.atom';
import { chatOps } from '@renderer/lib/chat/chatOps';
import { profileDataManager } from '@renderer/lib/userData/profileDataManager';
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import { useProfileData } from '../userData/userDataProvider';
import { useChatAgentMap } from '../../lib/agent';
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
  agentName: string | null;
  newName: string;
}

const zeroState: State = {
  isOpen: false,
  chatId: null,
  agentName: null,
  newName: '',
};

export const DuplicateAgentAtom = atom(zeroState, (get, set, use) => {
  function cancel() {
    set(zeroState);
  }

  function show(chatId: string, agentName: string, defaultName?: string) {
    const [language] = use(UiLanguageAtom);
    const resolvedDefaultName = defaultName ?? translate(language, 'overlay.duplicate.defaultSuffix', { name: agentName });
    set({ isOpen: true, chatId, agentName, newName: resolvedDefaultName });
  }

  function setNewName(newName: string) {
    set({ ...get(), newName });
  }

  async function confirm(toast: ToastContextType, t: TFunction = fallbackT) {
    const { chatId, newName } = get();

    if (!chatId || !newName.trim()) {
      toast.showError(t('overlay.duplicate.invalidData'));
      set(zeroState);
      return;
    }

    try {
      const result = await chatOps.duplicateChatConfig(chatId, newName.trim());

      if (result.success) {
        const warnings: string[] = [];
        if (result.data?.knowledgeCopyFailed) warnings.push(t('overlay.duplicate.knowledgeFiles'));
        if (result.data?.scheduleCopyFailed) warnings.push(t('overlay.duplicate.scheduledTasks'));

        if (warnings.length > 0) {
          toast.showWarning(t('overlay.duplicate.partialSuccess', {
            name: newName.trim(),
            warnings: warnings.join(` ${t('common.and')} `),
          }));
        } else {
          toast.showSuccess(t('overlay.duplicate.success', { name: newName.trim() }));
        }
        set(zeroState);
        await profileDataManager.refresh();
      } else {
        toast.showError(result.error || t('overlay.duplicate.failedWithoutReason'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      toast.showError(t('overlay.duplicate.failed', { error: errorMessage }));
    }
  }

  return { cancel, confirm, show, setNewName };
});

export function DuplicateAgentOverlay() {
  const [state, actions] = DuplicateAgentAtom.use();
  const toast = useToast();
  const { t } = useI18n();
  const { chats } = useProfileData();
  const chatAgentMap = useChatAgentMap(chats);

  if (!state.isOpen) return null;

  const isDuplicateNameExists = state.newName.trim()
    ? chats.some(chat => chatAgentMap.get(chat.chat_id)?.name?.toLowerCase() === state.newName.trim().toLowerCase())
    : false;

  return (
    <Dialog open={state.isOpen} onOpenChange={() => actions.cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('overlay.duplicate.title')}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <p className="text-sm text-neutral-600">
            {t('overlay.duplicate.description')}{' '}
            <strong className="font-semibold text-neutral-900">{state.agentName}</strong>
          </p>
          <input
            type="text"
            className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:ring-2 ${
              isDuplicateNameExists
                ? 'border-danger-400 focus:border-danger-500 focus:ring-danger-500/30'
                : 'border-neutral-300 focus:border-primary-500 focus:ring-primary-500/30'
            }`}
            value={state.newName}
            onChange={(e) => actions.setNewName(e.target.value)}
            placeholder={t('overlay.duplicate.placeholder')}
            autoFocus
          />
          {isDuplicateNameExists && (
            <p className="text-sm text-danger-600">{t('overlay.duplicate.nameExists')}</p>
          )}
        </div>
        <DialogFooter className="mt-6">
          <button className="btn-secondary" onClick={actions.cancel} type="button">
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={() => actions.confirm(toast, t)}
            disabled={!state.newName.trim() || isDuplicateNameExists}
            type="button"
          >
            {t('common.duplicate')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
