'use client'

import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/AddNewMcpServerView.css';
import { useMCPServers } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { McpOps } from '../../lib/mcp/mcpOps'
import { redactHeadersForLlm, restoreHeadersAfterLlm } from '../../lib/mcp/mcpConfigRedaction'
import { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes'
import ApplyMcpToAgentsDialog from './ApplyMcpToAgentsDialog'
import {
  cleanInvisibleCharacters,
  generateTimestampServerName,
  incrementPatchVersion,
  validateServerConfig,
  validateServerName,
  type McpConfigFormatterResponse,
  type McpServerTransport,
} from './AddNewMcpServerFormModel'
import { ServerConfigSection, ServerDetailsSection } from './AddNewMcpServerFormSections'
import { buildMcpValidationMessages } from './AddNewMcpServerValidationMessages'
import { useI18n } from '../../lib/i18n/useI18n'

interface AddNewMcpServerViewContentProps {
  editServerName?: string
}

const AddNewMcpServerViewContent: React.FC<AddNewMcpServerViewContentProps> = ({
  editServerName
}) => {
  const navigate = useNavigate()
  const { servers, addServer, refreshRuntimeInfo, getServerByName, updateServer } = useMCPServers()
  const { showError, showSuccess, showWarning } = useToast()
  const { t } = useI18n()
  const validationMessages = React.useMemo(() => buildMcpValidationMessages(t), [t])

  const isEditMode = !!editServerName
  const editingServer = isEditMode ? getServerByName(editServerName!) : null

  const [newServerName, setNewServerName] = useState('')
  const [newServerType, setNewServerType] = useState<McpServerTransport>('stdio')
  const [newServerConfig, setNewServerConfig] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showServerTypeDropdown, setShowServerTypeDropdown] = useState(false)
  const serverTypeDropdownRef = React.useRef<HTMLDivElement>(null)

  const [isVerified, setIsVerified] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyMcpServerName, setApplyMcpServerName] = useState('')

  const [validationErrors, setValidationErrors] = useState<{
    serverName?: string
    serverConfig?: string
  }>({})

  const serverNames = servers.map(s => s.name).filter(name => isEditMode ? name !== editServerName : true)

  React.useEffect(() => {
    if (isEditMode && editingServer) {
      setNewServerName(editingServer.name)
      setNewServerType(editingServer.transport)

      const configObj: any = {}

      if (editingServer.transport === 'stdio') {
        // For stdio, include command and args (required fields)
        configObj.command = editingServer.command || ''
        configObj.args = editingServer.args || []
        // Include env if it exists and has properties
        if (editingServer.env && Object.keys(editingServer.env).length > 0) {
          configObj.env = editingServer.env
        }
      } else if (editingServer.transport === 'sse' || editingServer.transport === 'StreamableHttp') {
        // For sse/StreamableHttp, include url (required field)
        configObj.url = editingServer.url || ''
        // Include env if it exists and has properties
        if (editingServer.env && Object.keys(editingServer.env).length > 0) {
          configObj.env = editingServer.env
        }
        // Include headers if it exists and has properties
        if (editingServer.headers && Object.keys(editingServer.headers).length > 0) {
          configObj.headers = editingServer.headers
        }
      }

      const configJson = JSON.stringify(configObj, null, 2)
      setNewServerConfig(configJson)
    } else if (isEditMode && !editingServer) {
      // If in edit mode but no server found, force refresh and try again
      refreshRuntimeInfo().then(() => {
      }).catch(error => {
      })
    } else {
      // Reset form when not in edit mode
      setNewServerName('')
      setNewServerType('stdio')
      setNewServerConfig('')
    }
    setValidationErrors({})
    setIsVerified(false)
    setIsVerifying(false)
    setVerifyResult(null)
    setVerifyError(null)
  }, [isEditMode, editServerName, refreshRuntimeInfo])

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (isEditMode) {
        const textarea = document.querySelector('.json-editor') as HTMLTextAreaElement
        if (textarea) {
          textarea.focus()
        }
      } else {
        if (isVerified) {
          const input = document.querySelector('.server-name-input') as HTMLInputElement
          if (input) {
            input.focus()
          }
        } else {
          const textarea = document.querySelector('.json-editor') as HTMLTextAreaElement
          if (textarea) {
            textarea.focus()
          }
        }
      }
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [isEditMode, isVerified])

  const handleVerify = useCallback(async () => {
    if (!newServerConfig.trim()) {
      setVerifyError(t('mcp.add.serverConfigRequired'))
      setVerifyResult(null)
      setIsVerified(false)
      return
    }

    try {
      setIsVerifying(true)
      setVerifyError(null)
      setVerifyResult(null)

      const { redacted, originalHeaders } = redactHeadersForLlm(newServerConfig)

      const ipcResult = await window.electronAPI?.llm?.formatMcpConfig(redacted)

      if (!ipcResult) {
        throw new Error('LLM API not available')
      }

      let llmResponse: McpConfigFormatterResponse

      if (ipcResult.success && ipcResult.data) {
        llmResponse = ipcResult.data
      } else {
        // If AI formatting fails, provide a fallback mechanism
        try {
          const parsedConfig = JSON.parse(newServerConfig)
          llmResponse = {
            success: true,
            config: parsedConfig,
            transportType: newServerType,
            serverName: newServerName || generateTimestampServerName(),
            warnings: [t('mcp.add.aiFormattingFailed', { error: ipcResult.error || t('common.unknownError') })]
          }
        } catch (parseError) {
          llmResponse = {
            success: false,
            errors: [t('mcp.add.configParsingFailed', {
              error: parseError instanceof Error ? parseError.message : t('common.unknownError'),
            })]
          }
        }
      }

      if (!llmResponse.success) {
        // Format failed
        const errorMessage = llmResponse.errors?.join(', ') || llmResponse.warnings?.join(', ') || t('mcp.add.formattingFailed')
        setVerifyError(t('mcp.add.configValidationFailed', { error: errorMessage }))
        setVerifyResult(null)
        setIsVerified(false)
        return
      }

      if (llmResponse.config) {
        let configToUse = llmResponse.config

        if (llmResponse.serverName && llmResponse.config[llmResponse.serverName]) {
          configToUse = llmResponse.config[llmResponse.serverName]
        }

        if (originalHeaders) {
          restoreHeadersAfterLlm(configToUse, originalHeaders, llmResponse.serverName)
        }

        const formattedConfig = JSON.stringify(configToUse, null, 2)
        setNewServerConfig(formattedConfig)
      }

      // Update server type from LLM response (both Add and Update modes)
      if (llmResponse.transportType) {
        setNewServerType(llmResponse.transportType as 'stdio' | 'sse' | 'StreamableHttp')
      }

      // Update server name from LLM response (only for Add mode)
      // In Update mode, server name should never be changed by LLM
      if (!isEditMode) {
        let serverName = llmResponse.serverName
        // If LLM returned empty or invalid server name, generate timestamp-based name
        if (!serverName || !serverName.trim()) {
          serverName = generateTimestampServerName()
        }
        setNewServerName(serverName)
      }

      setVerifyResult(t('mcp.add.validationSuccessful'))
      setIsVerified(true)

      // Clear validation errors
      setValidationErrors({})

    } catch (error) {
      setVerifyError(t('mcp.add.validationFailed', {
        error: error instanceof Error ? error.message : t('common.unknownError'),
      }))
      setVerifyResult(null)
      setIsVerified(false)
    } finally {
      setIsVerifying(false)
    }
  }, [newServerConfig, isEditMode, newServerType, newServerName, t])

  // Reset verify state when config changes
  const handleConfigChange = useCallback((value: string) => {
    setNewServerConfig(value)
    // Reset verify state when config changes
    if (isVerified) {
      setIsVerified(false)
      setVerifyResult(null)
      setVerifyError(null)
    }
  }, [isVerified])

  // Reset verify state when server name changes (after verification)
  const handleServerNameChange = useCallback((value: string) => {
    setNewServerName(value)
    // In Add mode, when server name changes after verification, we should NOT reset isVerified
    // to false because that would cause the fields to disappear due to the conditional rendering
    // Instead, we only clear the verify messages to indicate that re-verification may be needed
    // In Edit mode, server name changes shouldn't reset verify state at all since it's disabled
    if (isVerified && !isEditMode) {
      // Keep isVerified as true to maintain field visibility
      // Only clear the verify messages
      setVerifyResult(null)
      setVerifyError(null)
    }
  }, [isVerified, isEditMode])

  // Check if there are validation errors
  const hasValidationErrors = validationErrors.serverName || validationErrors.serverConfig

  const handleAddServer = useCallback(async () => {
    try {
      setIsLoading(true)

      // Both Add and Update modes require verification first
      if (!isVerified) {
        showWarning(t('mcp.add.verifyFirst'))
        return
      }

      // Perform all validations first

      // For Add mode: validate both server name and config
      // For Update mode: only validate config (server name doesn't change)
      let nameError: string | null = null
      if (!isEditMode) {
        nameError = validateServerName(newServerName, serverNames, validationMessages)
      }

      const configError = validateServerConfig(newServerConfig, newServerType, validationMessages)

      if (nameError || configError) {
        setValidationErrors({
          serverName: nameError || undefined,
          serverConfig: configError || undefined
        })
        return
      }

      if (!newServerName.trim() || !newServerConfig.trim()) {
        showWarning(t('mcp.add.nameAndConfigRequired'))
        return
      }

      // Parse configuration and format for McpOps API
      // Clean up invisible characters before parsing
      const cleanedConfig = cleanInvisibleCharacters(newServerConfig)
      const parsedConfig = JSON.parse(cleanedConfig)

      // Editing any persisted server creates a local revision.
      let version = '1.0.0'
      const source = 'ON-DEVICE' as const

      // 🔒 Re-fetch the latest server config to ensure source is never accidentally changed
      const currentEditingServer = isEditMode ? getServerByName(editServerName!) : null

      if (isEditMode && currentEditingServer) {
        const currentVersion = currentEditingServer.version || '1.0.0'
        version = incrementPatchVersion(currentVersion)
      }

      // Format config for McpOps API
      const mcpServerConfig: OpenKosmosAppMCPServerConfig = {
        name: newServerName,
        transport: newServerType === 'StreamableHttp' ? 'StreamableHttp' as const : newServerType as 'stdio' | 'sse',
        in_use: true, // Set in_use=true so it will connect after adding/updating
        url: parsedConfig.url || '',
        command: parsedConfig.command || '',
        args: parsedConfig.args || [],
        env: parsedConfig.env || {},
        headers: parsedConfig.headers,
        version,
        source,
        remoteVersion: ''
      }

      let result: { success: boolean; error?: string }

      if (isEditMode) {
        // Update existing server using McpOps API
        result = await McpOps.update(editServerName!, mcpServerConfig)
      } else {
        // Add new server using McpOps API
        result = await McpOps.add(mcpServerConfig)
      }

      if (result.success) {
        // For updates, we need to force refresh the ProfileDataManager cache
        // to ensure the UI gets the updated configuration
        if (isEditMode) {
          // Wait a bit longer for backend to process the update and start connection
          setTimeout(async () => {
            try {
              // Force refresh to get updated server data and status
              await refreshRuntimeInfo()
            } catch (error) {
            }
          }, 200) // Longer delay for updates to ensure backend processing completes
        } else {
          // For new servers, shorter delay is fine
          setTimeout(() => {
            refreshRuntimeInfo()
          }, 100)
        }

        showSuccess(t(isEditMode ? 'mcp.add.updateSuccess' : 'mcp.add.addSuccess', { name: newServerName }))

        // For new servers (not edit), show Apply to Agents dialog before navigating
        if (!isEditMode) {
          setApplyMcpServerName(newServerName)
          setApplyDialogOpen(true)
        } else {
          // Navigate back to MCP view for edits
          navigate('/settings/mcp')
        }
      } else {
        showError(t(isEditMode ? 'mcp.add.updateFailed' : 'mcp.add.addFailed', {
          error: result.error || t('common.unknownError'),
        }))
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('common.unknownError')
      showError(t(isEditMode ? 'mcp.add.updateFailed' : 'mcp.add.addFailed', { error: errorMessage }))
    } finally {
      setIsLoading(false)
    }
  }, [newServerName, newServerConfig, newServerType, serverNames, showWarning, showSuccess, showError, refreshRuntimeInfo, isEditMode, editServerName, navigate, isVerified, getServerByName, t, validationMessages])

  // Handle server type change
  const handleServerTypeChange = useCallback((serverType: 'stdio' | 'sse' | 'StreamableHttp') => {
    setNewServerType(serverType)
    setShowServerTypeDropdown(false)

    // Reset verify state when server type changes after verification
    // But do NOT reset isVerified to false, instead just clear verify messages
    // This prevents the server type and server name fields from disappearing
    if (isVerified) {
      setVerifyResult(null)
      setVerifyError(null)
      // Keep isVerified as true to maintain field visibility
    }

    // Clear validation errors when changing type
    setValidationErrors(prev => ({
      ...prev,
      serverConfig: undefined
    }))

    // Re-validate existing config with new server type if config exists
    if (newServerConfig.trim()) {
      setTimeout(() => {
        const configError = validateServerConfig(newServerConfig, serverType)
        if (configError) {
          setValidationErrors(prev => ({
            ...prev,
            serverConfig: configError
          }))
        }
      }, 0)
    }
  }, [newServerConfig, isVerified])

  // Handle Apply to Agents dialog close - navigate to MCP view
  const handleApplyDialogClose = useCallback((open: boolean) => {
    setApplyDialogOpen(open)
    if (!open) {
      navigate('/settings/mcp')
    }
  }, [navigate])

  return (
    <div className="content-view-container add-server-content">
      <div className="toolbar-settings-content mcp-settings-editor-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <ServerConfigSection
              isEditMode={isEditMode}
              isVerified={isVerified}
              isVerifying={isVerifying}
              newServerType={newServerType}
              newServerConfig={newServerConfig}
              validationErrors={validationErrors}
              verifyError={verifyError}
              verifyResult={verifyResult}
              onVerify={handleVerify}
              onConfigChange={handleConfigChange}
            />

            <ServerDetailsSection
              isEditMode={isEditMode}
              isVerified={isVerified}
              isLoading={isLoading}
              newServerType={newServerType}
              newServerName={newServerName}
              showServerTypeDropdown={showServerTypeDropdown}
              serverTypeDropdownRef={serverTypeDropdownRef}
              validationErrors={validationErrors}
              hasValidationErrors={hasValidationErrors}
              onToggleServerTypeDropdown={() => setShowServerTypeDropdown(!showServerTypeDropdown)}
              onServerTypeChange={handleServerTypeChange}
              onServerNameChange={handleServerNameChange}
              onCancel={() => navigate('/settings/mcp')}
              onSubmit={handleAddServer}
            />
          </div>
        </div>
      </div>

      <ApplyMcpToAgentsDialog
        open={applyDialogOpen}
        onOpenChange={handleApplyDialogClose}
        mcpServerNames={[applyMcpServerName]}
      />
    </div>
  )
}

export default AddNewMcpServerViewContent