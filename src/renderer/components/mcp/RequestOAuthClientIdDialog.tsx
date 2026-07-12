import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Copy, ExternalLink } from 'lucide-react';
import type { McpAuthClientIdRequestPayload } from '../../../shared/types/mcpAuth';
import { useI18n } from '../../lib/i18n/useI18n';

const EMPTY_PAYLOAD: McpAuthClientIdRequestPayload = {
  requestId: '',
  serverName: '',
  providerLabel: 'Identity Provider',
  redirectUri: '',
  instructions: { steps: [] },
};

/**
 * DCR-fallback dialog: shown when an MCP server's auth server doesn't
 * support Dynamic Client Registration. Walks the user through registering
 * an OAuth app and collects the resulting clientId/secret. Mount once at
 * app root.
 *
 * Concurrent prompts (multiple OAuth-MCP servers all needing DCR fallback
 * at startup) are queued in arrival order — without queueing the second
 * IPC would overwrite the first mid-typing.
 */
const RequestOAuthClientIdDialog: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<{
    isOpen: boolean;
    payload: McpAuthClientIdRequestPayload;
  }>({ isOpen: false, payload: EMPTY_PAYLOAD });

  // Ref instead of state to avoid re-render-on-push.
  const queueRef = React.useRef<McpAuthClientIdRequestPayload[]>([]);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const showPayload = useCallback((data: McpAuthClientIdRequestPayload) => {
    setState({ isOpen: true, payload: data });
    setClientId('');
    setClientSecret('');
    setCopied(false);
    setSubmitting(false);
  }, []);

  // Subscribe to incoming payloads. If a dialog is already open, queue
  // the new payload; otherwise show it immediately.
  useEffect(() => {
    const cleanup = window.electronAPI?.mcpAuth?.onRequestClientId?.((data) => {
      setState((prev) => {
        if (prev.isOpen) {
          // Avoid duplicate-requestId enqueues (the same request being
          // re-sent due to renderer hot-reload, fire-twice IPC quirks, …).
          if (
            prev.payload.requestId === data.requestId ||
            queueRef.current.some((p) => p.requestId === data.requestId)
          ) {
            return prev;
          }
          queueRef.current.push(data);
          return prev;
        }
        // Fast path — nothing showing, render immediately.
        setClientId('');
        setClientSecret('');
        setCopied(false);
        setSubmitting(false);
        return { isOpen: true, payload: data };
      });
    });
    return () => cleanup?.();
  }, []);

  const close = useCallback((response: { cancelled: true } | { clientId: string; clientSecret?: string }) => {
    const requestId = state.payload.requestId;
    if (requestId) {
      void window.electronAPI?.mcpAuth?.respondClientId?.(requestId, response);
    }
    // Drain the queue: if anything else is pending, render it next.
    const next = queueRef.current.shift();
    if (next) {
      showPayload(next);
    } else {
      setState({ isOpen: false, payload: EMPTY_PAYLOAD });
    }
  }, [state.payload.requestId, showPayload]);

  const handleCancel = useCallback(() => {
    close({ cancelled: true });
  }, [close]);

  const handleSubmit = useCallback(() => {
    const trimmedId = clientId.trim();
    /* v8 ignore next -- guard is unreachable from the UI: the submit button is disabled whenever clientId.trim() is empty */
    if (!trimmedId) return;
    setSubmitting(true);
    const trimmedSecret = clientSecret.trim();
    close({ clientId: trimmedId, clientSecret: trimmedSecret || undefined });
  }, [clientId, clientSecret, close]);

  const handleCopyRedirectUri = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(state.payload.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort
    }
  }, [state.payload.redirectUri]);

  const handleOpenSetupUrl = useCallback(() => {
    if (state.payload.instructions.setupUrl) {
      // The main process opens external URLs via shell; renderer can use a
      // standard <a target="_blank"> click via window.open which Electron
      // routes through `setWindowOpenHandler` to the system browser.
      window.open(state.payload.instructions.setupUrl, '_blank', 'noopener,noreferrer');
    }
  }, [state.payload.instructions.setupUrl]);

  const renderedSteps = useMemo(() => {
    return state.payload.instructions.steps.map((step) =>
      step
        .replace(/\{redirectUri\}/g, state.payload.redirectUri)
        .replace(/\{serverName\}/g, state.payload.serverName),
    );
  }, [state.payload.instructions.steps, state.payload.redirectUri, state.payload.serverName]);

  return (
    <Dialog
      className="z-10003"
      open={state.isOpen}
      onOpenChange={(open) => { if (!open) handleCancel(); }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('mcp.oauth.connectTo', { provider: state.payload.providerLabel })}
          </DialogTitle>
          <DialogDescription>
            {t('mcp.oauth.clientIdDescription', {
              serverName: state.payload.serverName,
              provider: state.payload.providerLabel,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 text-sm">
          {/* Step list */}
          {renderedSteps.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">
                {t('mcp.oauth.howToRegister')}
              </div>
              <ol className="list-decimal list-inside space-y-1 text-neutral-700 dark:text-neutral-300">
                {renderedSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
              {state.payload.instructions.setupUrl && (
                <button
                  className="btn-secondary w-fit mt-2"
                  onClick={handleOpenSetupUrl}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  {t('mcp.oauth.openAppRegistration', { provider: state.payload.providerLabel })}
                </button>
              )}
            </div>
          )}

          {/* Redirect URI block */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">
              {t('mcp.oauth.redirectUriLabel')}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2 py-1.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-xs font-mono break-all">
                {state.payload.redirectUri}
              </code>
              <button className="btn-secondary" onClick={handleCopyRedirectUri}>
                <Copy className="w-3.5 h-3.5 mr-1" />
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          </div>

          {/* Client ID input */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1" htmlFor="mcp-oauth-client-id">
              {t('mcp.oauth.clientId')}
            </label>
            <input
              id="mcp-oauth-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={t('mcp.oauth.clientIdPlaceholder')}
              autoFocus
              className="w-full px-3 py-2 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Client Secret input (optional) */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1" htmlFor="mcp-oauth-client-secret">
              {t('mcp.oauth.clientSecret')} <span className="lowercase text-neutral-400">{t('mcp.oauth.clientSecretOptional')}</span>
            </label>
            <input
              id="mcp-oauth-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={t('mcp.oauth.clientSecretPlaceholder')}
              className="w-full px-3 py-2 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <DialogFooter>
          <button className="btn-secondary" onClick={handleCancel} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !clientId.trim()}
          >
            {t('mcp.oauth.saveAndContinue')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestOAuthClientIdDialog;
