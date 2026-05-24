import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import type { ExecuteCommandInteractiveAuthHint } from '@shared/types/toolCallArgs';
import '../../styles/InteractiveRequestCard.css';

interface InteractiveAuthCardProps {
  hint: ExecuteCommandInteractiveAuthHint;
  command?: string;
  chatSessionId?: string | null;
}

const formatRemainingTime = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const getInteractiveAuthTitle = (commandFamily: ExecuteCommandInteractiveAuthHint['commandFamily']): string => {
  switch (commandFamily) {
    case 'gh-auth-login':
      return 'GitHub device login required';
    case 'gh-auth-refresh':
      return 'GitHub auth refresh required';
    case 'npm-login':
      return 'npm registry login required';
    case 'npm-adduser':
      return 'npm adduser confirmation required';
    case 'pnpm-login':
      return 'pnpm registry login required';
    case 'yarn-npm-login':
      return 'Yarn npm login required';
    default:
      return 'Browser authentication required';
  }
};

const InteractiveAuthCard: React.FC<InteractiveAuthCardProps> = ({ hint, command, chatSessionId }) => {
  const { showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const remainingMs = Math.max(0, hint.startedAt + hint.timeoutMs - now);

  if (dismissed || remainingMs <= 0) {
    return null;
  }

  const handleCopyDeviceCode = async () => {
    if (!hint.deviceCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(hint.deviceCode);
      showToast('Device code copied', 'success');
    } catch {
      showToast('Failed to copy device code', 'error');
    }
  };

  const handleOpenVerificationUri = () => {
    if (!hint.verificationUri) {
      return;
    }

    window.open(hint.verificationUri, '_blank', 'noopener,noreferrer');
  };

  const handleCancel = async () => {
    if (!chatSessionId || !window.electronAPI?.agentChat?.cancelActiveToolExecution) {
      showToast('Failed to cancel authentication', 'error');
      return;
    }

    setDismissed(true);

    try {
      const result = await window.electronAPI.agentChat.cancelActiveToolExecution(chatSessionId);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to cancel authentication');
      }
    } catch {
      setDismissed(false);
      showToast('Failed to cancel authentication', 'error');
    }
  };

  return (
    <div className="interactive-request-card interactive-auth-card">
      <div className="interactive-request-header">
        <div className="interactive-request-title-wrap">
          <ShieldAlert size={18} className="interactive-request-icon" />
          <div>
            <div className="interactive-request-title">{getInteractiveAuthTitle(hint.commandFamily)}</div>
            <div className="interactive-request-description">
              Complete the browser step before the command times out.
            </div>
          </div>
        </div>
        <div className="interactive-auth-timeout">Timeout in {formatRemainingTime(remainingMs)}</div>
      </div>

      <div className="interactive-request-section">
        {command ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Command</div>
            <div className="interactive-request-path">{command}</div>
          </div>
        ) : null}

        {hint.deviceCode ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Device code</div>
            <div className="interactive-auth-code">{hint.deviceCode}</div>
          </div>
        ) : null}

        {hint.verificationUri ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">Verification link</div>
            <div className="interactive-request-path">{hint.verificationUri}</div>
          </div>
        ) : null}
      </div>

      <div className="interactive-request-footer">
        {hint.verificationUri ? (
          <button type="button" className="interactive-primary-button" onClick={handleOpenVerificationUri}>
            Open Link
          </button>
        ) : null}
        {hint.deviceCode ? (
          <button type="button" className="interactive-secondary-button" onClick={handleCopyDeviceCode}>
            Copy Device Code
          </button>
        ) : null}
        <button type="button" className="interactive-secondary-button" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default InteractiveAuthCard;