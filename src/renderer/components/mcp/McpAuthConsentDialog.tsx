import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { APP_NAME } from '../../../shared/constants/branding';
import { useI18n } from '../../lib/i18n/useI18n';

const McpAuthConsentDialog: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<{
    isOpen: boolean;
    requestId: string;
    serverName: string;
    providerLabel: string;
  }>({
    isOpen: false,
    requestId: '',
    serverName: '',
    providerLabel: 'Identity Provider',
  });

  useEffect(() => {
    const cleanup = window.electronAPI?.mcpAuth?.onShowConsent?.((data) => {
      setState({
        isOpen: true,
        requestId: data.requestId,
        serverName: data.serverName,
        providerLabel: data.providerLabel,
      });
    });
    return () => cleanup?.();
  }, []);

  const handleResponse = useCallback(async (decision: 'cancel' | 'allow-this-time') => {
    const requestId = state.requestId;
    setState({ isOpen: false, requestId: '', serverName: '', providerLabel: 'Identity Provider' });
    await window.electronAPI?.mcpAuth?.respondConsent?.(requestId, decision);
  }, [state.requestId]);

  return (
    <Dialog
      className="z-10003"
      open={state.isOpen}
      onOpenChange={(open) => { if (!open) handleResponse('cancel'); }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mcp.auth.allowSignInTitle', { provider: state.providerLabel })}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('mcp.auth.serverWantsSignIn', {
              serverName: state.serverName,
              provider: state.providerLabel,
            })}
          </p>
        </div>
        <DialogFooter>
          <button className="btn-secondary" onClick={() => handleResponse('cancel')}>
            {t('mcp.auth.notNow')}
          </button>
          <button className="btn-primary" onClick={() => handleResponse('allow-this-time')}>
            {t('mcp.auth.allow')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default McpAuthConsentDialog;