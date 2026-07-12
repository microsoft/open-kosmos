import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { useI18n } from '../../lib/i18n/useI18n';

interface ErrorDetailsDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  details: string;
  onOpenChange: (open: boolean) => void;
}

const ErrorDetailsDialog: React.FC<ErrorDetailsDialogProps> = ({
  open,
  title,
  subtitle,
  details,
  onOpenChange,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-neutral-200">
          <DialogTitle className="text-left">{title}</DialogTitle>
          {subtitle ? <DialogDescription className="text-left">{subtitle}</DialogDescription> : null}
        </DialogHeader>

        <div className="px-6 py-4 overflow-y-auto min-h-0 flex-1">
          <pre className="text-xs leading-5 whitespace-pre-wrap break-all text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-md p-4">
            {details}
          </pre>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-200 gap-2">
          <button type="button" className="btn-secondary" onClick={handleCopy}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button type="button" className="btn-primary" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ErrorDetailsDialog;