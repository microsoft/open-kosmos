import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Copy, ExternalLink } from 'lucide-react';
import type { McpAuthClientIdRequestPayload } from '../../../shared/types/mcpAuth';

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
            Connect to {state.payload.providerLabel}
          </DialogTitle>
          <DialogDescription>
            <strong>{state.payload.serverName}</strong> needs an OAuth Client ID.
            Register an OAuth app with {state.payload.providerLabel}, then paste the Client ID below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 text-sm">
          {/* Step list */}
          {renderedSteps.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                How to register
              </div>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                {renderedSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
              {state.payload.instructions.setupUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleOpenSetupUrl}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  Open {state.payload.providerLabel} app registration
                </Button>
              )}
            </div>
          )}

          {/* Redirect URI block */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Redirect URI (paste this into the OAuth app)
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs font-mono break-all">
                {state.payload.redirectUri}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopyRedirectUri}>
                <Copy className="w-3.5 h-3.5 mr-1" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          {/* Client ID input */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1" htmlFor="mcp-oauth-client-id">
              Client ID
            </label>
            <input
              id="mcp-oauth-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Paste the Client ID from your OAuth app"
              autoFocus
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Client Secret input (optional) */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1" htmlFor="mcp-oauth-client-secret">
              Client Secret <span className="lowercase text-gray-400">(optional, only for confidential clients)</span>
            </label>
            <input
              id="mcp-oauth-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Leave empty for PKCE-only public apps"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !clientId.trim()}
          >
            Save & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestOAuthClientIdDialog;
