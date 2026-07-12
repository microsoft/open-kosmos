'use client'

import React from 'react'
import { ExternalLink } from 'lucide-react'
import type { CodingCliId, CodingCliAvailability } from '@shared/types/codingCli'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/RuntimeSettings.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface CodingCliSettingsContentViewProps {
  enabled: boolean
  clis: CodingCliAvailability[]
  selectedCli: CodingCliId
  isLoading: boolean
  isSaving: boolean
  onToggle: (enabled: boolean) => void
  onSelect: (cli: CodingCliId) => void
}

/** Inline monospace chip for install hints / tool names, matching the shared card look. */
const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: '11px',
  background: 'rgba(0, 0, 0, 0.05)',
  padding: '1px 5px',
  borderRadius: '4px',
}

/** Secondary "Documentation" link rendered under each CLI row. */
const docsLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  marginTop: '2px',
  fontSize: '12px',
  color: 'var(--color-primary-700)',
  textDecoration: 'none',
  width: 'fit-content',
}

/**
 * Content for the Coding CLI settings page. Uses the unified settings layout
 * (content-view-container > toolbar-settings card) and renders each CLI as a
 * single-select row that reuses Runtime's row classes (runtime-mode-row /
 * runtime-status-dot / runtime-radio) so it is visually consistent with the
 * Runtime Environment and other settings pages.
 *
 * Selection is driven solely by each row's native radio `onChange`. The name/status
 * block is a `<label htmlFor>` for that radio so clicking it toggles the radio exactly
 * once (no extra row onClick that would double-fire the save IPC). The Documentation
 * link sits outside the label so clicking it navigates without changing the selection.
 */
const CodingCliSettingsContentView: React.FC<CodingCliSettingsContentViewProps> = ({
  enabled,
  clis,
  selectedCli,
  isLoading,
  isSaving,
  onToggle,
  onSelect,
}) => {
  const { t } = useI18n()
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            {/* Master switch — gates the coding_agent tool and the CLI selection below. */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.codingCli.enable')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.codingCli.enableDescriptionPrefix')}<code style={codeStyle}>coding_agent</code>{t('settings.codingCli.enableDescriptionSuffix')}
                  </p>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={isSaving}
                    onChange={(e) => onToggle(e.target.checked)}
                    aria-label={t('settings.codingCli.enable')}
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>

            {/* CLI selection — only shown while the feature is enabled. */}
            {enabled && (
            <div className="toolbar-settings-card">
              {/* Card header */}
              <div
                className="toolbar-setting-item"
                style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}
              >
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.codingCli.defaultCli')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.codingCli.defaultCliDescriptionPrefix')}<code style={codeStyle}>coding_agent</code>{t('settings.codingCli.defaultCliDescriptionSuffix')}
                  </p>
                </div>
              </div>

              {isLoading ? (
                <div className="runtime-settings-loading">{t('common.loading')}</div>
              ) : clis.length === 0 ? (
                <div className="runtime-settings-loading">{t('settings.codingCli.noClis')}</div>
              ) : (
                clis.map((cli) => {
                  const isSelected = selectedCli === cli.id
                  const radioId = `coding-cli-${cli.id}`
                  return (
                    <div
                      key={cli.id}
                      className={`runtime-mode-row toolbar-setting-item${isSelected ? ' runtime-mode-row--active' : ''}`}
                    >
                      <div className="runtime-component-meta">
                        <label htmlFor={radioId} style={{ display: 'flex', flexDirection: 'column', gap: '3px', cursor: 'pointer' }}>
                          <span className="setting-label">
                            {cli.displayName}
                            <span className="runtime-component-tag">{cli.binaryName}</span>
                          </span>
                          <span
                            className={`runtime-status-dot ${cli.available ? 'runtime-status-dot--ok' : 'runtime-status-dot--off'}`}
                          >
                            {cli.available ? (
                              <span title={cli.path ?? undefined}>{cli.path}</span>
                            ) : (
                              t('settings.codingCli.notFound')
                            )}
                          </span>
                          {!cli.available && (
                            <span className="runtime-card-desc">
                              {t('settings.codingCli.installWith')} <code style={codeStyle}>{cli.installHint}</code>
                            </span>
                          )}
                        </label>
                        <a
                          href={cli.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={docsLinkStyle}
                        >
                          {t('settings.codingCli.documentation')} <ExternalLink size={11} />
                        </a>
                      </div>
                      <input
                        id={radioId}
                        type="radio"
                        name="codingCli"
                        className="runtime-radio"
                        checked={isSelected}
                        onChange={() => onSelect(cli.id)}
                        disabled={isSaving}
                        aria-label={t('settings.codingCli.selectCli', { name: cli.displayName })}
                      />
                    </div>
                  )
                })
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CodingCliSettingsContentView
