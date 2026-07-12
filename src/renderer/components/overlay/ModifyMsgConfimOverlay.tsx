
import { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useProfileData } from '../userData/userDataProvider';
import { useI18n } from '../../lib/i18n/useI18n';

function Overlay() {
  const [inlineEditConfirmState, setInlineEditConfirmState] = useState<{
    open: boolean;
    requestId: string | null;
    title: string;
    description: string;
    dontAskAgain: boolean;
  }>({
    open: false,
    requestId: null,
    title: '',
    description: '',
    dontAskAgain: false,
  });
  const profileData = useProfileData();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const currentAlias = profileData?.data.profile?.alias || null;
  const skipInlineEditRegenerateConfirm =
    profileData?.data.profile?.confirmationSettings?.inlineEditRegenerate?.skipConfirmation === true;
  const skipInlineEditRegenerateConfirmRef = useRef(skipInlineEditRegenerateConfirm);
  skipInlineEditRegenerateConfirmRef.current = skipInlineEditRegenerateConfirm;

  const resolveInlineEditConfirm = useCallback((confirmed: boolean) => {
    setInlineEditConfirmState((prev) => {
      if (prev.requestId) {
        window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
          detail: {
            requestId: prev.requestId,
            confirmed,
          },
        }));
      }

      if (confirmed && prev.dontAskAgain && currentAlias) {
        void window.electronAPI.profile.updateConfirmationSettings(currentAlias, {
          inlineEditRegenerate: {
            skipConfirmation: true,
          },
        });
      }

      return {
        open: false,
        requestId: null,
        title: '',
        description: '',
        dontAskAgain: false,
      };
    });
  }, [currentAlias]);

  useEffect(() => {
    const handleInlineEditConfirmRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{
        requestId?: string;
        title?: string;
        description?: string;
      }>;

      if (!customEvent.detail?.requestId) {
        return;
      }

      if (skipInlineEditRegenerateConfirmRef.current) {
        window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditResult', {
          detail: {
            requestId: customEvent.detail.requestId,
            confirmed: true,
          },
        }));
        return;
      }

      setInlineEditConfirmState({
        open: true,
        requestId: customEvent.detail.requestId,
        title: customEvent.detail.title || tRef.current('overlay.inlineEdit.confirmAction'),
        description: customEvent.detail.description || '',
        dontAskAgain: false,
      });
    };

    window.addEventListener(
      'chatInput:confirmInlineEditRequest',
      handleInlineEditConfirmRequest as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatInput:confirmInlineEditRequest',
        handleInlineEditConfirmRequest as EventListener,
      );
    };
  }, []);

  return (
    <Dialog
      open={inlineEditConfirmState.open}
      onOpenChange={(open) => {
        if (!open && inlineEditConfirmState.open) {
          resolveInlineEditConfirm(false);
        }
      }}
    >
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-left">{inlineEditConfirmState.title}</DialogTitle>
          <DialogDescription className="text-left leading-6">
            {inlineEditConfirmState.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex items-center justify-between gap-3 sm:flex-row sm:space-x-0">
          <label className="flex items-center gap-2.5 text-sm text-gray-600 select-none">
            <input
              type="checkbox"
              checked={inlineEditConfirmState.dontAskAgain}
              onChange={(event) => {
                const checked = event.target.checked;
                setInlineEditConfirmState((prev) => ({
                  ...prev,
                  dontAskAgain: checked,
                }));
              }}
            />
            <span>{t('common.doNotShowAgain')}</span>
          </label>
          <div className="flex items-center gap-2.5">
            <button
              className="btn-secondary px-4 py-2 text-sm"
              onClick={() => resolveInlineEditConfirm(false)}
              type="button"
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={() => resolveInlineEditConfirm(true)}
              type="button"
            >
              {t('common.confirm')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(Overlay);
