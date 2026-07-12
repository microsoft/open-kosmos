import React from 'react'
import { Info } from 'lucide-react'
import { useI18n } from '../../lib/i18n/useI18n'

export interface ParsedServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  url?: string
  hasConflict?: boolean
  originalConfig: any
}

export interface DetectedConfig {
  path: string
  exists: boolean
  serverCount: number
  servers?: ParsedServerConfig[]
  error?: string
}

export interface ImportOptions {
  conflictResolution: 'skip' | 'rename' | 'overwrite'
  validateBeforeImport: boolean
}

export const DetectionSection: React.FC<{
  isScanning: boolean
  detectedConfig: DetectedConfig | null
}> = ({ isScanning, detectedConfig }) => {
  const { t } = useI18n()

  return (
    <div className="toolbar-settings-card detection-section">
      {isScanning ? (
        <div className="scanning-status">
          <span className="spinner">🔍</span>
          <span>{t('mcp.importVscode.scanning')}</span>
        </div>
      ) : detectedConfig ? (
        <div className={`detection-result ${detectedConfig.exists && detectedConfig.serverCount > 0 ? 'success' : 'error'}`}>
          {detectedConfig.exists && detectedConfig.serverCount > 0 ? (
            <>
              <div className="success-message">
                ✅ {t('mcp.importVscode.scanSuccess', { count: detectedConfig.serverCount })}
              </div>
              <div className="detection-path">
                <strong>{t('mcp.importVscode.configPath')}</strong> {detectedConfig.path}
              </div>
            </>
          ) : detectedConfig.exists ? (
            <>
              <div className="warning-message">
                ⚠️ {t('mcp.importVscode.noServersDetected')}
              </div>
              <div className="detection-path">
                <strong>{t('mcp.importVscode.configPath')}</strong> {detectedConfig.path}
              </div>
              <div className="help-message">
                {t('mcp.importVscode.ensureConfigured')}
              </div>
            </>
          ) : (
            <>
              <div className="error-message">
                ❌ {detectedConfig.error}
              </div>
              <div className="help-message">
                <h4>{t('mcp.importVscode.solutions')}</h4>
                <ul>
                  <li>{t('mcp.importVscode.ensureInstalled')}</li>
                  <li>{t('mcp.importVscode.checkConfigured')}</li>
                  <li>{t('mcp.importVscode.verifyStandardPath')}</li>
                </ul>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const ServerSelectionSection: React.FC<{
  servers: ParsedServerConfig[] | undefined
  selectedServers: Set<string>
  previewServer: ParsedServerConfig | null
  onSelectAll: () => void
  onDeselectAll: () => void
  onServerPreview: (server: ParsedServerConfig) => void
  onServerToggle: (serverName: string) => void
  onTooltipShow: (event: React.MouseEvent, server: ParsedServerConfig) => void
  onTooltipHide: () => void
}> = ({
  servers,
  selectedServers,
  previewServer,
  onSelectAll,
  onDeselectAll,
  onServerPreview,
  onServerToggle,
  onTooltipShow,
  onTooltipHide,
}) => {
  const { t } = useI18n()

  if (!servers || servers.length === 0) return null

  return (
    <div className="toolbar-settings-card server-selection">
      <div className="selection-header">
        <h3>{t('mcp.importVscode.availableConfigurations', { count: servers.length })}</h3>
        <div className="selection-controls">
          <button onClick={onSelectAll} className="btn-secondary">{t('mcp.importVscode.selectAll')}</button>
          <button onClick={onDeselectAll} className="btn-secondary">{t('mcp.importVscode.deselectAll')}</button>
        </div>
      </div>

      <div className="server-list">
        {servers.map((server) => (
          <div
            key={server.name}
            className={`server-item ${server.hasConflict ? 'conflict' : ''} ${previewServer?.name === server.name ? 'selected' : ''}`}
            onClick={() => onServerPreview(server)}
          >
            <label className="server-checkbox">
              <input
                type="checkbox"
                checked={selectedServers.has(server.name)}
                onChange={() => onServerToggle(server.name)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="server-info">
                <span className="server-name">{server.name}</span>
                <span className="server-transport">({server.transport})</span>
                {server.hasConflict ? <span className="conflict-badge">{t('mcp.importVscode.nameConflict')}</span> : null}
              </span>
            </label>
            <div
              className="server-info-icon"
              title={t('mcp.importVscode.viewOriginalConfig')}
              onMouseEnter={(e) => onTooltipShow(e, server)}
              onMouseLeave={onTooltipHide}
            >
              <Info className="info-icon" size={16} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const ImportOptionsSection: React.FC<{
  servers: ParsedServerConfig[] | undefined
  importOptions: ImportOptions
  onConflictResolutionChange: (value: ImportOptions['conflictResolution']) => void
  onValidateBeforeImportChange: (value: boolean) => void
}> = ({
  servers,
  importOptions,
  onConflictResolutionChange,
  onValidateBeforeImportChange,
}) => {
  const { t } = useI18n()

  if (!servers || servers.length === 0) return null

  return (
    <div className="toolbar-settings-card import-options">
      <h3>{t('mcp.importVscode.importOptions')}</h3>

      <div className="option-group">
        <h4>{t('mcp.importVscode.conflictResolution')}</h4>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="conflictResolution"
              value="skip"
              checked={importOptions.conflictResolution === 'skip'}
              onChange={(e) => onConflictResolutionChange(e.target.value as ImportOptions['conflictResolution'])}
            />
            {t('mcp.importVscode.skipConflicts')}
          </label>
          <label>
            <input
              type="radio"
              name="conflictResolution"
              value="rename"
              checked={importOptions.conflictResolution === 'rename'}
              onChange={(e) => onConflictResolutionChange(e.target.value as ImportOptions['conflictResolution'])}
            />
            {t('mcp.importVscode.renameConflicts')}
          </label>
          <label>
            <input
              type="radio"
              name="conflictResolution"
              value="overwrite"
              checked={importOptions.conflictResolution === 'overwrite'}
              onChange={(e) => onConflictResolutionChange(e.target.value as ImportOptions['conflictResolution'])}
            />
            {t('mcp.importVscode.overwriteExisting')}
          </label>
        </div>
      </div>

      <div className="option-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={importOptions.validateBeforeImport}
            onChange={(e) => onValidateBeforeImportChange(e.target.checked)}
          />
          {t('mcp.importVscode.validateBeforeImport')}
        </label>
      </div>
    </div>
  )
}

export const StatusSection: React.FC<{ detectedConfig: DetectedConfig | null }> = ({ detectedConfig }) => {
  const { t } = useI18n()

  if (detectedConfig?.servers && detectedConfig.servers.length > 0) return null

  return (
    <div className="toolbar-settings-card status-section">
      {!detectedConfig ? (
        <>
          <h3>{t('mcp.importVscode.waitingForScan')}</h3>
          <p>{t('mcp.importVscode.waitingDescription')}</p>
        </>
      ) : detectedConfig.exists && detectedConfig.serverCount === 0 ? (
        <>
          <h3>{t('mcp.importVscode.noServersFound')}</h3>
          <p>{t('mcp.importVscode.noServersDescription')}</p>
        </>
      ) : (
        <>
          <h3>{t('mcp.importVscode.readyToImport')}</h3>
          <p>{t('mcp.importVscode.readyDescription')}</p>
        </>
      )}
    </div>
  )
}

export const ImportTooltip: React.FC<{
  tooltipServer: ParsedServerConfig | null
  tooltipPosition: { top: number; right: number } | null
}> = ({ tooltipServer, tooltipPosition }) => {
  const { t } = useI18n()

  if (!tooltipServer || !tooltipPosition) return null

  return (
    <div
      className="info-tooltip-fixed"
      style={{
        position: 'fixed',
        top: tooltipPosition.top,
        right: tooltipPosition.right,
        zIndex: 9999,
      }}
    >
      <div className="tooltip-header">{t('mcp.importVscode.originalConfig')}</div>
      <pre className="tooltip-json-preview">{JSON.stringify(tooltipServer.originalConfig, null, 2)}</pre>
    </div>
  )
}

export const ImportActions: React.FC<{
  isScanning: boolean
  selectedCount: number
  onImport: () => void
}> = ({ isScanning, selectedCount, onImport }) => {
  const { t } = useI18n()

  return (
    <div className="import-actions">
      <button
        className="btn-primary"
        onClick={onImport}
        disabled={isScanning || selectedCount === 0}
      >
        {isScanning ? t('mcp.importVscode.importing') : t('mcp.importVscode.importSelected', { count: selectedCount })}
      </button>
    </div>
  )
}
