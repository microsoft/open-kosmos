import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { GitVersion, RuntimeCheckingState } from './RuntimeSettingsContentView';
import { truncatePath } from './RuntimeSettingsContentView';
import { useI18n } from '../../lib/i18n/useI18n';

interface RuntimeSystemDependencyRowsProps {
  checking: RuntimeCheckingState;
  gitVersion: GitVersion | null;
  showGitVersion: boolean;
}

const installLinkStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' };

/**
 * Git row for the unified app-managed environment card.
 */
const RuntimeSystemDependencyRows: React.FC<RuntimeSystemDependencyRowsProps> = ({
  checking,
  gitVersion,
  showGitVersion,
}) => {
  const { t } = useI18n();

  return (
    <>
      {showGitVersion && (
        <div className="runtime-component-row toolbar-setting-item">
          <div className="runtime-component-meta">
            <span className="setting-label">Git <span className="runtime-component-tag">{t('settings.runtime.gitVersionControl')}</span></span>
            <span className={`runtime-status-dot ${gitVersion?.installed ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
              {gitVersion?.installed ? (
                <span title={`${gitVersion.path || ''}${gitVersion.version ? ` (v${gitVersion.version})` : ''}`}>
                  {gitVersion.path ? truncatePath(gitVersion.path) : `v${gitVersion.version}`}
                </span>
              ) : checking.git ? t('settings.runtime.checking') : t('settings.runtime.notInstalled')}
            </span>
          </div>
          <div className="runtime-component-actions">
            {!gitVersion?.installed && !checking.git && (
              <a
                href="https://git-scm.com/downloads"
                target="_blank"
                rel="noopener noreferrer"
                className="runtime-action-btn"
                style={installLinkStyle}
              >
                {t('settings.runtime.install')} <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}

      {showGitVersion && !gitVersion?.installed && !checking.git && (
        <div className="runtime-empty-hint" style={{ padding: '12px', backgroundColor: 'rgba(251, 191, 36, 0.1)', borderRadius: '6px', marginTop: '8px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-warning-800)' }}>
            {t('settings.runtime.gitRequiredPrefix')}{' '}
            <a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-warning-700)', textDecoration: 'underline' }}>
              git-scm.com
            </a>
            .
          </p>
        </div>
      )}
    </>
  );
};

export default RuntimeSystemDependencyRows;
