import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { GitVersion, RuntimeStatus } from './RuntimeSettingsContentView';

interface RuntimeSystemDependenciesCardProps {
  status: RuntimeStatus;
  gitVersion: GitVersion | null;
  showGitVersion: boolean;
}

const installLinkStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' };

const RuntimeSystemDependenciesCard: React.FC<RuntimeSystemDependenciesCardProps> = ({
  status: _status,
  gitVersion,
  showGitVersion,
}) => (
  <div className="toolbar-settings-card">
    <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
      <div className="setting-label-container">
        <label className="setting-label" style={{ fontWeight: 500 }}>System Dependencies</label>
        <p className="runtime-card-desc">System-wide tools used by command-line workflows.</p>
      </div>
    </div>

    {showGitVersion && (
      <div className="runtime-component-row toolbar-setting-item">
        <div className="runtime-component-meta">
          <span className="setting-label">Git <span className="runtime-component-tag">Version Control</span></span>
          <span className={`runtime-status-dot ${gitVersion?.installed ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}>
            {gitVersion?.installed ? (
              <span title={gitVersion.path || ''}>v{gitVersion.version}</span>
            ) : 'Not installed'}
          </span>
        </div>
        <div className="runtime-component-actions">
          {!gitVersion?.installed && (
            <a
              href="https://git-scm.com/downloads"
              target="_blank"
              rel="noopener noreferrer"
              className="runtime-action-btn"
              style={installLinkStyle}
            >
              Install <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    )}

    {showGitVersion && !gitVersion?.installed && (
      <div className="runtime-empty-hint" style={{ padding: '12px', backgroundColor: 'rgba(251, 191, 36, 0.1)', borderRadius: '6px', marginTop: '8px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#92400E' }}>
          Git is required for version control features. Please install Git from{' '}
          <a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer" style={{ color: '#B45309', textDecoration: 'underline' }}>
            git-scm.com
          </a>
          .
        </p>
      </div>
    )}
  </div>
);

export default RuntimeSystemDependenciesCard;
