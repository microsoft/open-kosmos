'use client'

import React from 'react'

import type { McpServerTransport } from './AddNewMcpServerFormModel'
import { useI18n } from '../../lib/i18n/useI18n'

type Translate = ReturnType<typeof useI18n>['t']

interface ValidationErrors {
  serverName?: string
  serverConfig?: string
}

interface ServerConfigSectionProps {
  isEditMode: boolean
  isVerified: boolean
  isVerifying: boolean
  newServerType: McpServerTransport
  newServerConfig: string
  validationErrors: ValidationErrors
  verifyError: string | null
  verifyResult: string | null
  onVerify: () => void
  onConfigChange: (value: string) => void
}

interface ServerDetailsSectionProps {
  isEditMode: boolean
  isVerified: boolean
  isLoading: boolean
  newServerType: McpServerTransport
  newServerName: string
  showServerTypeDropdown: boolean
  serverTypeDropdownRef: React.RefObject<HTMLDivElement>
  validationErrors: ValidationErrors
  hasValidationErrors: string | undefined
  onToggleServerTypeDropdown: () => void
  onServerTypeChange: (serverType: McpServerTransport) => void
  onServerNameChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

const stdioPlaceholder = `{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}`

const httpPlaceholder = `{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}`

const combinedPlaceholder = `Example 1 (Stdio):
${stdioPlaceholder}

Example 2 (Streamable HTTP):
${httpPlaceholder}`

const serverTypeLabel = (serverType: McpServerTransport, t: Translate) => {
  if (serverType === 'stdio') return t('mcp.form.serverTypeStdio')
  if (serverType === 'sse') return t('mcp.form.serverTypeSse')
  return t('mcp.form.serverTypeStreamableHttp')
}

const getConfigPlaceholder = (
  isEditMode: boolean,
  isVerified: boolean,
  newServerType: McpServerTransport,
) => {
  if (!isEditMode && !isVerified) return combinedPlaceholder
  return newServerType === 'stdio' ? stdioPlaceholder : httpPlaceholder
}

const CheckIcon: React.FC = () => (
  <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
    <path
      fillRule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
      clipRule="evenodd"
    />
  </svg>
)

const ServerTypeOption: React.FC<{
  value: McpServerTransport
  currentValue: McpServerTransport
  label: string
  disabled: boolean
  onSelect: (serverType: McpServerTransport) => void
}> = ({ value, currentValue, label, disabled, onSelect }) => (
  <button
    type="button"
    className={`model-option ${currentValue === value ? 'selected' : ''}`}
    onClick={() => onSelect(value)}
    disabled={disabled}
  >
    <div className="model-info">
      <span className="model-option-name">{label}</span>
    </div>
    {currentValue === value ? <CheckIcon /> : null}
  </button>
)

export const ServerConfigSection: React.FC<ServerConfigSectionProps> = ({
  isEditMode,
  isVerified,
  isVerifying,
  newServerType,
  newServerConfig,
  validationErrors,
  verifyError,
  verifyResult,
  onVerify,
  onConfigChange,
}) => {
  const { t } = useI18n()

  return (
    <div className="toolbar-settings-card server-config-section">
      <div className="server-config-header">
        <label className="form-label">
          {t('mcp.form.serverConfig')}
          <span className="field-requirement field-requirement--required">{t('common.required')}</span>
        </label>
        <button
          type="button"
          onClick={onVerify}
          disabled={isVerifying || !newServerConfig.trim()}
          className="btn-primary"
        >
          {isVerifying ? t('mcp.form.verifyWithAi') : t('mcp.form.verifyToContinue')}
        </button>
      </div>

      <textarea
        value={newServerConfig}
        onChange={(e) => onConfigChange(e.target.value)}
        className={`json-editor ${validationErrors.serverConfig ? 'error' : ''}`}
        placeholder={getConfigPlaceholder(isEditMode, isVerified, newServerType)}
        autoFocus={isEditMode || !isVerified}
        tabIndex={0}
      />

      {validationErrors.serverConfig ? (
        <div className="validation-error">
          {validationErrors.serverConfig}
        </div>
      ) : null}

      {verifyError ? (
        <div className="verify-error">
          {verifyError}
        </div>
      ) : null}

      {verifyResult ? (
        <div className="verify-success">
          {verifyResult}
        </div>
      ) : null}
    </div>
  )
}

export const ServerDetailsSection: React.FC<ServerDetailsSectionProps> = ({
  isEditMode,
  isVerified,
  isLoading,
  newServerType,
  newServerName,
  showServerTypeDropdown,
  serverTypeDropdownRef,
  validationErrors,
  hasValidationErrors,
  onToggleServerTypeDropdown,
  onServerTypeChange,
  onServerNameChange,
  onCancel,
  onSubmit,
}) => {
  const { t } = useI18n()

  if (!isEditMode && !isVerified) return null

  return (
    <>
      <div className="toolbar-settings-card server-type-section">
        <label className="form-label">
          {t('mcp.form.serverType')}
          <span className="field-requirement field-requirement--required">{t('common.required')}</span>
        </label>
        <div className="model-selector" ref={serverTypeDropdownRef}>
          <button
            type="button"
            className="model-button"
            onClick={onToggleServerTypeDropdown}
            disabled={isLoading}
          >
            <svg className="model-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="model-name">{serverTypeLabel(newServerType, t)}</span>
            <svg
              className={`dropdown-arrow ${showServerTypeDropdown ? 'rotated' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showServerTypeDropdown ? (
            <div className="model-dropdown">
              <div className="dropdown-header">{t('mcp.form.chooseServerType')}</div>
              <div className="model-list">
                <ServerTypeOption
                  value="stdio"
                  currentValue={newServerType}
                  label={t('mcp.form.serverTypeStdio')}
                  disabled={isLoading}
                  onSelect={onServerTypeChange}
                />
                <ServerTypeOption
                  value="sse"
                  currentValue={newServerType}
                  label={t('mcp.form.serverTypeSse')}
                  disabled={isLoading}
                  onSelect={onServerTypeChange}
                />
                <ServerTypeOption
                  value="StreamableHttp"
                  currentValue={newServerType}
                  label={t('mcp.form.serverTypeStreamableHttp')}
                  disabled={isLoading}
                  onSelect={onServerTypeChange}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="toolbar-settings-card server-name-section">
        <label className="form-label">
          {t('mcp.form.serverName')}
          <span className="field-requirement field-requirement--required">{t('common.required')}</span>
        </label>
        <input
          type="text"
          className={`server-name-input ${validationErrors.serverName ? 'error' : ''}`}
          value={newServerName}
          onChange={(e) => onServerNameChange(e.target.value)}
          placeholder={t('mcp.form.serverName')}
          disabled={isEditMode}
          autoFocus={!isEditMode && isVerified}
          tabIndex={isEditMode ? -1 : 0}
        />
      </div>

      {validationErrors.serverName ? (
        <div className="validation-error">
          {validationErrors.serverName}
        </div>
      ) : null}

      <div className="server-actions">
        <button className="btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>

        <button
          className="btn-primary"
          onClick={onSubmit}
          disabled={isLoading || !!hasValidationErrors || (!isEditMode && !isVerified)}
        >
          {isLoading ? (isEditMode ? t('mcp.form.updating') : t('mcp.form.adding')) : (isEditMode ? t('mcp.form.updateServer') : t('mcp.form.addServer'))}
        </button>
      </div>
    </>
  )
}
