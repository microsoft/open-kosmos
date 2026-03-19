'use client'

import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/AddNewMcpServerView.css';
import { useMCPServers } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { McpOps } from '../../lib/mcp/mcpOps'
import { KosmosAppMCPServerConfig } from '../../types/mcpTypes'
import ApplyMcpToAgentsDialog from './ApplyMcpToAgentsDialog'

// McpConfigFormatterResponse type definition
interface McpConfigFormatterResponse {
  success: boolean;
  originalFormat?: string;
  transportType?: string;
  serverName?: string;
  nameSource?: string;
  config?: Record<string, any>;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

// Clean up invisible characters that can cause JSON parsing issues
const cleanInvisibleCharacters = (text: string): string => {
  return text
    .replace(/\u00A0/g, ' ')  // Replace NBSP (non-breaking space) with regular space
    .replace(/\u202F/g, ' ')  // Replace narrow no-break space
    .replace(/\u2060/g, '')   // Remove word joiner
    .replace(/\uFEFF/g, '')   // Remove byte order mark (BOM)
    .replace(/\u180E/g, ' ')  // Replace Mongolian vowel separator
    .replace(/\u200B/g, '')   // Remove zero-width space
    .replace(/\u200C/g, '')   // Remove zero-width non-joiner
    .replace(/\u200D/g, '')   // Remove zero-width joiner
}

// Generate timestamp-based server name
const generateTimestampServerName = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `mcp-server-${year}${month}${day}${hours}${minutes}${seconds}`
}

interface AddNewMcpServerViewContentProps {
  editServerName?: string // Optional prop for editing existing server
}

const AddNewMcpServerViewContent: React.FC<AddNewMcpServerViewContentProps> = ({
  editServerName
}) => {
  const navigate = useNavigate()
  const { servers, addServer, refreshRuntimeInfo, getServerByName, updateServer } = useMCPServers()
  const { showError, showSuccess, showWarning } = useToast()
  
  // Determine if we're in edit mode
  const isEditMode = !!editServerName
  const editingServer = isEditMode ? getServerByName(editServerName!) : null
  
  // Local state management
  const [newServerName, setNewServerName] = useState('')
  const [newServerType, setNewServerType] = useState<'stdio' | 'sse' | 'StreamableHttp'>('stdio')
  const [newServerConfig, setNewServerConfig] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showServerTypeDropdown, setShowServerTypeDropdown] = useState(false)
  const serverTypeDropdownRef = React.useRef<HTMLDivElement>(null)

  // Verify functionality state
  const [isVerified, setIsVerified] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // Apply to agents dialog state
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyMcpServerName, setApplyMcpServerName] = useState('')

  // Validation state management
  const [validationErrors, setValidationErrors] = useState<{
    serverName?: string
    serverConfig?: string
  }>({})

  // Get server names for validation (exclude current server name when editing)
  const serverNames = servers.map(s => s.name).filter(name => isEditMode ? name !== editServerName : true)

  // Load existing server data when in edit mode
  React.useEffect(() => {
    if (isEditMode && editingServer) {
      setNewServerName(editingServer.name)
      setNewServerType(editingServer.transport)
      
      // Convert server config to JSON format for editor
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
    
    // Reset verify state
    setIsVerified(false)
    setIsVerifying(false)
    setVerifyResult(null)
    setVerifyError(null)
  }, [isEditMode, editServerName, refreshRuntimeInfo])

  // Ensure proper focus when component mounts
  React.useEffect(() => {
    // Small delay to ensure the component is fully rendered before focusing
    const timeoutId = setTimeout(() => {
      if (isEditMode) {
        // In edit mode, focus the textarea (config field) since it's the only editable field
        const textarea = document.querySelector('.json-editor') as HTMLTextAreaElement
        if (textarea) {
          textarea.focus()
        }
      } else {
        // In add mode, focus the server name input if verified, otherwise config textarea
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

  // Validate server name
  const validateServerName = useCallback((name: string) => {
    const errors: string[] = []
    
    // 1. Server name cannot be empty
    if (!name.trim()) {
      errors.push('Server name cannot be empty')
    }
    
    // 2. Server name cannot duplicate existing servers
    if (name.trim() && serverNames.includes(name.trim())) {
      errors.push('Server name already exists, please use a different name')
    }
    
    return errors.length > 0 ? errors.join('; ') : null
  }, [serverNames])

  // Validate MCP configuration
  const validateServerConfig = useCallback((config: string, serverType: 'stdio' | 'sse' | 'StreamableHttp') => {
    const errors: string[] = []
    
    // 3. MCP command cannot be empty
    if (!config.trim()) {
      errors.push('MCP configuration cannot be empty')
      return errors.join('; ')
    }
    
    // 4. MCP command cannot be sample
    const stdioExample = `{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}`
    const sseExample = `{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}`
    
    const normalizedConfig = config.replace(/\s+/g, ' ').trim()
    const normalizedStdioExample = stdioExample.replace(/\s+/g, ' ').trim()
    const normalizedSseExample = sseExample.replace(/\s+/g, ' ').trim()
    
    if (normalizedConfig === normalizedStdioExample || normalizedConfig === normalizedSseExample) {
      errors.push('Please modify the example configuration, cannot use default examples')
      return errors.join('; ')
    }
    
    // Clean up invisible characters before parsing JSON
    const cleanedConfig = cleanInvisibleCharacters(config)
    
    // Try to parse JSON
    let parsedConfig: any
    try {
      parsedConfig = JSON.parse(cleanedConfig)
    } catch (e) {
      errors.push(`Configuration must be valid JSON format. Error: ${e instanceof Error ? e.message : 'Unknown error'}`)
      return errors.join('; ')
    }
    
    if (serverType === 'stdio') {
      // 5. stdio command validation
      const configKeys = Object.keys(parsedConfig)
      const requiredKeys = ['command', 'args']
      const optionalKeys = ['env']
      const allowedKeys = [...requiredKeys, ...optionalKeys]
      
      // Check for required keys
      const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
      if (missingKeys.length > 0) {
        errors.push(`Stdio configuration must contain required fields: ${missingKeys.join(', ')}`)
      }
      
      // Check for invalid keys
      const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
      if (invalidKeys.length > 0) {
        errors.push(`Stdio configuration contains invalid fields: ${invalidKeys.join(', ')}. Only allowed: ${allowedKeys.join(', ')}`)
      }
      
      // command must be string and not empty
      if (typeof parsedConfig.command !== 'string' || !parsedConfig.command.trim()) {
        errors.push('command field must be a non-empty string')
      }
      
      // args must be string array and not empty
      if (!Array.isArray(parsedConfig.args)) {
        errors.push('args field must be an array')
      } else if (parsedConfig.args.length === 0) {
        errors.push('args array cannot be empty')
      } else if (!parsedConfig.args.every((arg: any) => typeof arg === 'string')) {
        errors.push('All elements in args array must be strings')
      }
      
      // env validation (optional)
      if (parsedConfig.env !== undefined) {
        if (typeof parsedConfig.env !== 'object' || parsedConfig.env === null || Array.isArray(parsedConfig.env)) {
          errors.push('env field must be an object with string key-value pairs')
        } else {
          const envEntries = Object.entries(parsedConfig.env)
          for (const [key, value] of envEntries) {
            if (typeof key !== 'string' || typeof value !== 'string') {
              errors.push('All env entries must be string key-value pairs')
              break
            }
          }
        }
      }
    } else if (serverType === 'sse') {
      // 6. sse command validation
      const configKeys = Object.keys(parsedConfig)
      const requiredKeys = ['url']
      const optionalKeys = ['env']
      const allowedKeys = [...requiredKeys, ...optionalKeys]
      
      // Check for required keys
      const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
      if (missingKeys.length > 0) {
        errors.push(`SSE configuration must contain required fields: ${missingKeys.join(', ')}`)
      }
      
      // Check for invalid keys
      const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
      if (invalidKeys.length > 0) {
        errors.push(`SSE configuration contains invalid fields: ${invalidKeys.join(', ')}. Only allowed: ${allowedKeys.join(', ')}`)
      }
      
      // url cannot be empty
      if (typeof parsedConfig.url !== 'string' || !parsedConfig.url.trim()) {
        errors.push('url field must be a non-empty string')
      }
      
      // env validation (optional)
      if (parsedConfig.env !== undefined) {
        if (typeof parsedConfig.env !== 'object' || parsedConfig.env === null || Array.isArray(parsedConfig.env)) {
          errors.push('env field must be an object with string key-value pairs')
        } else {
          const envEntries = Object.entries(parsedConfig.env)
          for (const [key, value] of envEntries) {
            if (typeof key !== 'string' || typeof value !== 'string') {
              errors.push('All env entries must be string key-value pairs')
              break
            }
          }
        }
      }
    } else if (serverType === 'StreamableHttp') {
      // StreamableHttp command validation
      const configKeys = Object.keys(parsedConfig)
      const requiredKeys = ['url']
      const optionalKeys = ['env']
      const allowedKeys = [...requiredKeys, ...optionalKeys]
      
      // Check for required keys
      const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
      if (missingKeys.length > 0) {
        errors.push(`StreamableHttp configuration must contain required fields: ${missingKeys.join(', ')}`)
      }
      
      // Check for invalid keys
      const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
      if (invalidKeys.length > 0) {
        errors.push(`StreamableHttp configuration contains invalid fields: ${invalidKeys.join(', ')}. Only allowed: ${allowedKeys.join(', ')}`)
      }
      
      // url cannot be empty
      if (typeof parsedConfig.url !== 'string' || !parsedConfig.url.trim()) {
        errors.push('url field must be a non-empty string')
      }
      
      // env validation (optional)
      if (parsedConfig.env !== undefined) {
        if (typeof parsedConfig.env !== 'object' || parsedConfig.env === null || Array.isArray(parsedConfig.env)) {
          errors.push('env field must be an object with string key-value pairs')
        } else {
          const envEntries = Object.entries(parsedConfig.env)
          for (const [key, value] of envEntries) {
            if (typeof key !== 'string' || typeof value !== 'string') {
              errors.push('All env entries must be string key-value pairs')
              break
            }
          }
        }
      }
    }
    
    return errors.length > 0 ? errors.join('; ') : null
  }, [])

  // Handle Verify button click
  const handleVerify = useCallback(async () => {
    // Only check if config is empty
    if (!newServerConfig.trim()) {
      setVerifyError('Please fill in Server Config')
      setVerifyResult(null)
      setIsVerified(false)
      return
    }

    try {
      setIsVerifying(true)
      setVerifyError(null)
      setVerifyResult(null)
      
      // Call main process McpConfigLlmFormatter.formatMcpConfig via IPC
      const ipcResult = await window.electronAPI?.llm?.formatMcpConfig(newServerConfig)
      
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
            warnings: [`AI formatting failed (${ipcResult.error}), using basic validation`]
          }
        } catch (parseError) {
          llmResponse = {
            success: false,
            errors: [`Configuration parsing failed: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`]
          }
        }
      }
      
      if (!llmResponse.success) {
        // Format failed
        const errorMessage = llmResponse.errors?.join(', ') || llmResponse.warnings?.join(', ') || 'Formatting failed'
        setVerifyError(`Configuration validation failed: ${errorMessage}`)
        setVerifyResult(null)
        setIsVerified(false)
        return
      }

      // Format successful - update UI
      
      // Extract formatted config from LLM response (both Add and Update modes)
      if (llmResponse.config) {
        // LLM should return config directly as an object (not nested under server name)
        let configToUse = llmResponse.config
        
        // Handle case where config might be nested under server name (fallback)
        if (llmResponse.serverName && llmResponse.config[llmResponse.serverName]) {
          configToUse = llmResponse.config[llmResponse.serverName]
        }
        
        // Update server config with formatted version
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
      
      setVerifyResult('Configuration validation successful')
      setIsVerified(true)
      
      // Clear validation errors
      setValidationErrors({})
      
    } catch (error) {
      setVerifyError(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setVerifyResult(null)
      setIsVerified(false)
    } finally {
      setIsVerifying(false)
    }
  }, [newServerConfig, isEditMode, newServerType, newServerName])

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

  // Helper function to increment patch version (e.g., "1.0.0" -> "1.0.1")
  const incrementPatchVersion = (version: string): string => {
    const parts = version.split('.')
    if (parts.length === 3) {
      const patch = parseInt(parts[2], 10)
      if (!isNaN(patch)) {
        return `${parts[0]}.${parts[1]}.${patch + 1}`
      }
    }
    // Fallback: return original version if format is unexpected
    return version
  }

  const handleAddServer = useCallback(async () => {
    try {
      setIsLoading(true)
      
      // Both Add and Update modes require verification first
      if (!isVerified) {
        showWarning('Please verify the configuration first')
        return
      }
      
      // Perform all validations first
      
      // For Add mode: validate both server name and config
      // For Update mode: only validate config (server name doesn't change)
      let nameError: string | null = null
      if (!isEditMode) {
        nameError = validateServerName(newServerName)
      }
      
      const configError = validateServerConfig(newServerConfig, newServerType)
      
      if (nameError || configError) {
        setValidationErrors({
          serverName: nameError || undefined,
          serverConfig: configError || undefined
        })
        return
      }

      if (!newServerName.trim() || !newServerConfig.trim()) {
        showWarning('Please provide server name and configuration')
        return
      }

      // Parse configuration and format for McpOps API
      // Clean up invisible characters before parsing
      const cleanedConfig = cleanInvisibleCharacters(newServerConfig)
      const parsedConfig = JSON.parse(cleanedConfig)
      
      // Determine version for the server config
      let version: string
      
      // 🔒 Re-fetch the latest server config to ensure consistency
      const currentEditingServer = isEditMode ? getServerByName(editServerName!) : null
      
      if (isEditMode && currentEditingServer) {
        // Edit mode: auto-increment patch version
        const currentVersion = currentEditingServer.version || '1.0.0'
        version = incrementPatchVersion(currentVersion)
      } else {
        // Add mode: use default values
        version = '1.0.0'
      }
      
      // Format config for McpOps API
      const mcpServerConfig: KosmosAppMCPServerConfig = {
        name: newServerName,
        transport: newServerType === 'StreamableHttp' ? 'StreamableHttp' as const : newServerType as 'stdio' | 'sse',
        in_use: true, // Set in_use=true so it will connect after adding/updating
        url: parsedConfig.url || '',
        command: parsedConfig.command || '',
        args: parsedConfig.args || [],
        env: parsedConfig.env || {},
        version,
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

        showSuccess(`Server "${newServerName}" ${isEditMode ? 'updated' : 'added'} successfully! ${isEditMode ? 'Reconnecting...' : 'Connecting...'}`)

        // For new servers (not edit), show Apply to Agents dialog before navigating
        if (!isEditMode) {
          setApplyMcpServerName(newServerName)
          setApplyDialogOpen(true)
        } else {
          // Navigate back to MCP view for edits
          navigate('/settings/mcp')
        }
      } else {
        showError(`Failed to ${isEditMode ? 'update' : 'add'} server: ${result.error || 'Unknown error'}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to ${isEditMode ? 'update' : 'add'} server: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [newServerName, newServerConfig, newServerType, validateServerName, validateServerConfig, showWarning, showSuccess, showError, refreshRuntimeInfo, isEditMode, editServerName, navigate, isVerified, getServerByName])

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
  }, [newServerConfig, validateServerConfig, isVerified])

  // Handle Apply to Agents dialog close - navigate to MCP view
  const handleApplyDialogClose = useCallback((open: boolean) => {
    setApplyDialogOpen(open)
    if (!open) {
      navigate('/settings/mcp')
    }
  }, [navigate])

  return (
    <div className="add-server-content">
      {/* Server Config section with Verify button in top right */}
      <div className="server-config-section">
        <div className="server-config-header">
          <label className="form-label">Server Config:</label>
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying || !newServerConfig.trim()}
            className="btn-primary"
          >
            {isVerifying ? 'Verifying with AI...' : 'Verify to Continue'}
          </button>
        </div>
        
        <textarea
          value={newServerConfig}
          onChange={(e) => handleConfigChange(e.target.value)}
          className={`json-editor ${validationErrors.serverConfig ? 'error' : ''}`}
          placeholder={(!isEditMode && !isVerified) ?
            `Example 1 (Stdio):
{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}

Example 2 (Streamable HTTP):
{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}` :
            (newServerType === 'stdio' ?
            `{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}` :
            `{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}`)}
          autoFocus={isEditMode || !isVerified}
          tabIndex={0}
        />
        
        {validationErrors.serverConfig && (
          <div className="validation-error">
            {validationErrors.serverConfig}
          </div>
        )}

        {/* Verify Status Messages */}
        {verifyError && (
          <div className="verify-error">
            {verifyError}
          </div>
        )}
        
        {verifyResult && (
          <div className="verify-success">
            {verifyResult}
          </div>
        )}
      </div>

      {/* Show Server Type and Server Name only after verification (Add mode) or always (Update mode) */}
      {(isEditMode || isVerified) && (
        <>
          <div className="server-type-section">
            <label className="form-label">Server Type:</label>
            <div className="model-selector" ref={serverTypeDropdownRef}>
              <button
                type="button"
                className="model-button"
                onClick={() => setShowServerTypeDropdown(!showServerTypeDropdown)}
                disabled={isLoading}
              >
                <svg
                  className="model-icon"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span className="model-name">
                  {newServerType === 'stdio' ? 'Stdio' : newServerType === 'sse' ? 'SSE' : 'StreamableHttp'}
                </span>
                <svg
                  className={`dropdown-arrow ${showServerTypeDropdown ? 'rotated' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              
              {/* Server Type dropdown */}
              {showServerTypeDropdown && (
                <div className="model-dropdown">
                  <div className="dropdown-header">Choose Server Type</div>
                  <div className="model-list">
                    <button
                      type="button"
                      className={`model-option ${newServerType === 'stdio' ? 'selected' : ''}`}
                      onClick={() => handleServerTypeChange('stdio')}
                      disabled={isLoading}
                    >
                      <div className="model-info">
                        <span className="model-option-name">Stdio</span>
                      </div>
                      {newServerType === 'stdio' && (
                        <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`model-option ${newServerType === 'sse' ? 'selected' : ''}`}
                      onClick={() => handleServerTypeChange('sse')}
                      disabled={isLoading}
                    >
                      <div className="model-info">
                        <span className="model-option-name">SSE</span>
                      </div>
                      {newServerType === 'sse' && (
                        <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`model-option ${newServerType === 'StreamableHttp' ? 'selected' : ''}`}
                      onClick={() => handleServerTypeChange('StreamableHttp')}
                      disabled={isLoading}
                    >
                      <div className="model-info">
                        <span className="model-option-name">StreamableHttp</span>
                      </div>
                      {newServerType === 'StreamableHttp' && (
                        <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="server-name-section">
            <label className="form-label">Server Name:</label>
            <input
              type="text"
              className={`server-name-input ${validationErrors.serverName ? 'error' : ''}`}
              value={newServerName}
              onChange={(e) => handleServerNameChange(e.target.value)}
              placeholder="Server Name"
              disabled={isEditMode}
              autoFocus={!isEditMode && isVerified}
              tabIndex={isEditMode ? -1 : 0}
            />
          </div>
          {validationErrors.serverName && (
            <div className="validation-error">
              {validationErrors.serverName}
            </div>
          )}
          
          {/* Action buttons */}
          <div className="server-actions">
            <button
              className="btn-secondary"
              onClick={() => navigate('/settings/mcp')}
            >
              Cancel
            </button>
            
            <button
              className="btn-primary"
              onClick={handleAddServer}
              disabled={isLoading || !!hasValidationErrors || (!isEditMode && !isVerified)}
            >
              {isLoading ? (isEditMode ? 'Updating...' : 'Adding...') : (isEditMode ? 'Update Server' : 'Add Server')}
            </button>
          </div>
        </>
      )}
      <ApplyMcpToAgentsDialog
        open={applyDialogOpen}
        onOpenChange={handleApplyDialogClose}
        mcpServerNames={[applyMcpServerName]}
      />
    </div>
  )
}

export default AddNewMcpServerViewContent