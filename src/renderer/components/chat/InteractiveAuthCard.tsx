import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import type { ExecuteCommandInteractiveAuthHint } from '@shared/types/toolCallArgs';
import '../../styles/InteractiveRequestCard.css';
import { useI18n } from '../../lib/i18n/useI18n';
import type { TranslationKey } from '../../lib/i18n';

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

const getInteractiveAuthTitleKey = (commandFamily: ExecuteCommandInteractiveAuthHint['commandFamily']): TranslationKey => {
  switch (commandFamily) {
    case 'gh-auth-login':
      return 'auth.interactive.githubDeviceLoginRequired';
    case 'gh-auth-refresh':
      return 'auth.interactive.githubAuthRefreshRequired';
    case 'npm-login':
      return 'auth.interactive.npmLoginRequired';
    case 'npm-adduser':
      return 'auth.interactive.npmAdduserRequired';
    case 'pnpm-login':
      return 'auth.interactive.pnpmLoginRequired';
    case 'yarn-npm-login':
      return 'auth.interactive.yarnNpmLoginRequired';
    default:
      return 'auth.interactive.browserAuthRequired';
  }
};

const InteractiveAuthCard: React.FC<InteractiveAuthCardProps> = ({ hint, command, chatSessionId }) => {
  const { t } = useI18n();
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
      showToast(t('auth.interactive.deviceCodeCopied'), 'success');
    } catch {
      showToast(t('auth.interactive.deviceCodeCopyFailed'), 'error');
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
      showToast(t('auth.interactive.cancelFailed'), 'error');
      return;
    }

    setDismissed(true);

    try {
      const result = await window.electronAPI.agentChat.cancelActiveToolExecution(chatSessionId);
      if (!result?.success) {
        throw new Error(result?.error || t('auth.interactive.cancelFailed'));
      }
    } catch {
      setDismissed(false);
      showToast(t('auth.interactive.cancelFailed'), 'error');
    }
  };

  return (
    <div className="interactive-request-card interactive-auth-card">
      <div className="interactive-request-header">
        <div className="interactive-request-title-wrap">
          <ShieldAlert size={18} className="interactive-request-icon" />
          <div>
            <div className="interactive-request-title">{t(getInteractiveAuthTitleKey(hint.commandFamily))}</div>
            <div className="interactive-request-description">
              {t('auth.interactive.completeBrowserStep')}
            </div>
          </div>
        </div>
        <div className="interactive-auth-timeout">{t('auth.interactive.timeoutIn', { time: formatRemainingTime(remainingMs) })}</div>
      </div>

      <div className="interactive-request-section">
        {command ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">{t('auth.interactive.command')}</div>
            <div className="interactive-request-path">{command}</div>
          </div>
        ) : null}

        {hint.deviceCode ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">{t('auth.interactive.deviceCode')}</div>
            <div className="interactive-auth-code">{hint.deviceCode}</div>
          </div>
        ) : null}

        {hint.verificationUri ? (
          <div className="interactive-request-item">
            <div className="interactive-request-item-title">{t('auth.interactive.verificationLink')}</div>
            <div className="interactive-request-path">{hint.verificationUri}</div>
          </div>
        ) : null}
      </div>

      <div className="interactive-request-footer">
        {hint.verificationUri ? (
          <button type="button" className="interactive-primary-button" onClick={handleOpenVerificationUri}>
            {t('common.openLink')}
          </button>
        ) : null}
        {hint.deviceCode ? (
          <button type="button" className="interactive-secondary-button" onClick={handleCopyDeviceCode}>
            {t('auth.interactive.copyDeviceCode')}
          </button>
        ) : null}
        <button type="button" className="interactive-secondary-button" onClick={handleCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
};

export default InteractiveAuthCard;