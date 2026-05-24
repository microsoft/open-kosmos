import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { APP_NAME } from '../../../shared/constants/branding';

const McpAuthConsentDialog: React.FC = () => {
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
          <DialogTitle>Allow sign-in to {state.providerLabel}?</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <strong>{state.serverName}</strong> wants to sign in to {state.providerLabel}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleResponse('cancel')}>
            Not now
          </Button>
          <Button onClick={() => handleResponse('allow-this-time')}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default McpAuthConsentDialog;