import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useI18n } from '../../lib/i18n/useI18n';

interface QueuedMessageStartDialogProps {
  onCancel: () => void;
  onKeepQueue: () => void;
  onClearQueue: () => void;
}

/**
 * Confirmation shown when the user sends a fresh prompt while the current chat
 * still has queued prompts. Lets them cancel, start while keeping the queue, or
 * clear the queue first. Composes the shared Dialog primitive so it inherits
 * Escape-to-close, focus trapping, and focus restoration. Presentation-only;
 * ChatInput owns the decision state by mounting this only when a decision is
 * pending, so the dialog is always open while rendered. Dismissing it (Escape or
 * overlay click) is treated as Cancel.
 */
const QueuedMessageStartDialog: React.FC<QueuedMessageStartDialogProps> = ({
  onCancel,
  onKeepQueue,
  onClearQueue,
}) => {
  const { t } = useI18n();

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader hideCloseButton>
          <DialogTitle>{t('chat.queue.startTitle')}</DialogTitle>
          <DialogDescription>
            {t('chat.queue.startDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-secondary" onClick={onKeepQueue}>
            {t('chat.queue.keep')}
          </button>
          <button type="button" className="btn-primary" onClick={onClearQueue}>
            {t('chat.queue.clear')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QueuedMessageStartDialog;
