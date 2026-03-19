/**
 * ImportVscodeMcpServerViewContent Component
 * Contains the main content area for VSCode import functionality
 */

import React, { useState, useCallback, useEffect } from 'react'
import '../../styles/ImportVscodeMcpServerView.css'
import { useMCPServers } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { getPlatformInfo } from '../../lib/mcp/platformDetector'
import { readFileContent, expandPath, checkFileExists } from '../../lib/utilities/fileSystemUtils'
import { detectVscodeConfigFile } from '../../lib/mcp/VscodeConfigDetector'
import { McpOps } from '../../lib/mcp/mcpOps'
import { KosmosAppMCPServerConfig } from '../../types/mcpTypes'
import { Info } from 'lucide-react'

interface ParsedServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  hasConflict?: boolean
  originalConfig: any
}

interface DetectedConfig {
  path: string
  exists: boolean
  serverCount: number
  servers?: ParsedServerConfig[]
  error?: string
}

interface ImportOptions {
  conflictResolution: 'skip' | 'rename' | 'overwrite'
  validateBeforeImport: boolean
}

interface ImportVscodeMcpServerViewContentProps {
  onImportComplete?: (importedCount: number) => void
}

const ImportVscodeMcpServerViewContent: React.FC<ImportVscodeMcpServerViewContentProps> = ({
  onImportComplete
}) => {
  const { showError, showSuccess } = useToast()
  const [isScanning, setIsScanning] = useState(false)
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null)
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set())
  const [previewServer, setPreviewServer] = useState<ParsedServerConfig | null>(null)
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    conflictResolution: 'rename',
    validateBeforeImport: true
  })
  const [existingServerNames, setExistingServerNames] = useState<string[]>([])
  const [tooltipServer, setTooltipServer] = useState<ParsedServerConfig | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; right: number } | null>(null)

  // Get MCP context
  const { servers: mcpServers, refreshRuntimeInfo } = useMCPServers()

  // Auto-detect when component mounts
  useEffect(() => {
    if (!detectedConfig && !isScanning) {
      // Get existing server names for conflict detection
      let existingNames: string[] = []
      
      try {
        if (mcpServers && Array.isArray(mcpServers)) {
          // mcpServers is an array of server objects
          existingNames = mcpServers.map(server => server.name)
        } else if (mcpServers && typeof mcpServers === 'object') {
          // mcpServers is an object with server names as keys
          existingNames = Object.keys(mcpServers)
        }
        
        setExistingServerNames(existingNames)
      } catch (error) {
        setExistingServerNames([])
      }
      
      handleAutoDetect(existingNames)
    }
  }, [mcpServers])

  const handleAutoDetect = useCallback(async (currentExistingNames: string[]) => {
    setIsScanning(true)
    try {
      const platformInfo = getPlatformInfo()
      
      if (!platformInfo.isSupported) {
        setDetectedConfig({
          path: 'Unsupported platform',
          exists: false,
          serverCount: 0,
          error: `Platform ${platformInfo.platform} is not supported`
        })
        return
      }

      // Use the new multi-path detection to find the first valid VSCode config file
      const detectedConfigPath = await detectVscodeConfigFile()
      
      if (!detectedConfigPath) {
        setDetectedConfig({
          path: 'Multiple paths scanned',
          exists: false,
          serverCount: 0,
          error: 'No valid VSCode MCP configuration file found. Please ensure VSCode is properly installed and MCP servers are configured.'
        })
        return
      }

      // Read and parse the detected file
      const contentResult = await readFileContent(detectedConfigPath)
      
      if (!contentResult.success) {
        setDetectedConfig({
          path: detectedConfigPath,
          exists: true,
          serverCount: 0,
          error: `Failed to read file: ${contentResult.error}`
        })
        return
      }

      // Parse and convert servers
      let parsedServers: ParsedServerConfig[] = []
      try {
        const config = JSON.parse(contentResult.content!)
        
        // Support both mcp.json format (servers) and settings.json format (mcp.servers)
        const servers = config.servers || config.mcp?.servers
        
        if (servers && typeof servers === 'object') {
          // Convert each server to our format
          for (const [serverName, serverConfig] of Object.entries(servers)) {
            if (serverConfig && typeof serverConfig === 'object') {
              const parsedServer = parseServerConfig(serverName, serverConfig as any, currentExistingNames)
              if (parsedServer) {
                parsedServers.push(parsedServer)
              }
            }
          }
        }
      } catch (parseError) {
        setDetectedConfig({
          path: detectedConfigPath,
          exists: true,
          serverCount: 0,
          error: 'Invalid JSON format'
        })
        return
      }

      setDetectedConfig({
        path: detectedConfigPath,
        exists: true,
        serverCount: parsedServers.length,
        servers: parsedServers,
        error: parsedServers.length === 0 ? 'No MCP servers found in configuration' : undefined
      })

      // Set default selections (non-conflicting servers)
      if (parsedServers.length > 0) {
        const conflictingServers = parsedServers.filter(server => server.hasConflict)
        const nonConflictingServers = parsedServers.filter(server => !server.hasConflict)
        
        // Default select only non-conflicting servers
        const defaultSelected = new Set(nonConflictingServers.map(server => server.name))
        setSelectedServers(defaultSelected)
        
        // Set first server as preview
        setPreviewServer(parsedServers[0])
      }

    } catch (error) {
      setDetectedConfig({
        path: 'Detection failed',
        exists: false,
        serverCount: 0,
        error: `Error: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setIsScanning(false)
    }
  }, [])

  // Helper function to parse individual server config
  const parseServerConfig = (name: string, config: any, existingNames: string[]): ParsedServerConfig | null => {
    try {
      // Skip disabled servers
      if (config.disabled === true) {
        return null
      }

      // Determine transport type
      let transport: 'stdio' | 'sse' | 'StreamableHttp' = 'stdio'
      let command = ''
      let args: string[] = []
      let url = ''
      let env: Record<string, string> = {}

      if (config.type === 'stdio' || (config.command && !config.url)) {
        transport = 'stdio'
        command = config.command || ''
        args = config.args || []
      } else if (config.url) {
        if (config.type === 'sse' || config.url.endsWith('/sse')) {
          transport = 'sse'
        } else {
          transport = 'StreamableHttp'
        }
        url = config.url
      }

      if (config.env && typeof config.env === 'object') {
        env = config.env
      }

      // Check for name conflict
      const hasConflict = existingNames.includes(name)

      return {
        name,
        transport,
        command,
        args,
        env,
        url,
        hasConflict,
        originalConfig: config
      }
    } catch (error) {
      return null
    }
  }

  // Handle server selection
  const handleServerToggle = useCallback((serverName: string) => {
    setSelectedServers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverName)) {
        newSet.delete(serverName)
      } else {
        newSet.add(serverName)
      }
      return newSet
    })
  }, [])

  // Handle select all / deselect all
  const handleSelectAll = useCallback(() => {
    if (detectedConfig?.servers) {
      const allServerNames = new Set(detectedConfig.servers.map(s => s.name))
      setSelectedServers(allServerNames)
    }
  }, [detectedConfig?.servers])

  const handleDeselectAll = useCallback(() => {
    setSelectedServers(new Set())
  }, [])

  // Handle server preview
  const handleServerPreview = useCallback((server: ParsedServerConfig) => {
    setPreviewServer(server)
  }, [])

  // Handle tooltip show/hide
  const handleTooltipShow = useCallback((e: React.MouseEvent, server: ParsedServerConfig) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltipPosition({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right
    })
    setTooltipServer(server)
  }, [])

  const handleTooltipHide = useCallback(() => {
    setTooltipServer(null)
    setTooltipPosition(null)
  }, [])

  const handleRealImport = useCallback(async () => {
    if (!detectedConfig?.servers || selectedServers.size === 0) {
      showError('Please select at least one server to import')
      return
    }

    setIsScanning(true)
    
    try {
      const serversToImport = detectedConfig.servers.filter(server =>
        selectedServers.has(server.name)
      )

      let importedCount = 0
      const errors: string[] = []

      for (const server of serversToImport) {
        try {
          let finalName = server.name

          // Handle name conflicts
          if (server.hasConflict) {
            if (importOptions.conflictResolution === 'skip') {
              continue
            } else if (importOptions.conflictResolution === 'rename') {
              // Generate timestamp in YYYYMMDDHHMMSS format
              const now = new Date()
              const timestamp = now.getFullYear().toString() +
                              (now.getMonth() + 1).toString().padStart(2, '0') +
                              now.getDate().toString().padStart(2, '0') +
                              now.getHours().toString().padStart(2, '0') +
                              now.getMinutes().toString().padStart(2, '0') +
                              now.getSeconds().toString().padStart(2, '0')
              finalName = `${server.name}-${timestamp}`
            }
            // For overwrite, keep the original name
          }

          // Convert to Kosmos format
          const kosmosConfig: KosmosAppMCPServerConfig = {
            name: finalName,
            transport: server.transport === 'StreamableHttp' ? 'StreamableHttp' as const : server.transport as 'stdio' | 'sse',
            command: server.command || '',
            args: server.args || [],
            env: server.env || {},
            url: server.url || '',
            in_use: true,
            version: '1.0.0',
          }

          // Validate if required
          if (importOptions.validateBeforeImport) {
            // Basic validation
            if (server.transport === 'stdio' && !server.command) {
              errors.push(`${server.name}: Missing command for stdio transport`)
              continue
            }
            if ((server.transport === 'sse' || server.transport === 'StreamableHttp') && !server.url) {
              errors.push(`${server.name}: Missing URL for ${server.transport} transport`)
              continue
            }
          }

          // Add or update server based on conflict resolution using McpOps API
          let result: { success: boolean; error?: string }
          
          if (server.hasConflict && importOptions.conflictResolution === 'overwrite') {
            // Use McpOps.update for existing servers (overwrite mode)
            result = await McpOps.update(server.name, kosmosConfig)
            
            if (result.success) {
              importedCount++
            } else {
              errors.push(`${server.name}: Failed to update server - ${result.error || 'Unknown error'}`)
            }
          } else {
            // Use McpOps.add for new servers or renamed servers
            result = await McpOps.add(kosmosConfig)
            
            if (result.success) {
              importedCount++
            } else {
              errors.push(`${server.name}: Failed to add server - ${result.error || 'Unknown error'}`)
            }
          }

        } catch (serverError) {
          errors.push(`${server.name}: ${serverError instanceof Error ? serverError.message : String(serverError)}`)
        }
      }

      if (importedCount > 0) {
        showSuccess(
          `Successfully imported ${importedCount} server${importedCount > 1 ? 's' : ''}!` +
          (errors.length > 0 ? ` (${errors.length} failed)` : '')
        )
        onImportComplete?.(importedCount)
        
        // Refresh runtime info to initialize and connect servers
        await refreshRuntimeInfo()
      } else {
        showError(`Import failed: ${errors.join('; ')}`)
      }

    } catch (error) {
      showError(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsScanning(false)
    }
  }, [detectedConfig?.servers, selectedServers, importOptions, existingServerNames, showError, showSuccess, onImportComplete])

  const handleTestImport = useCallback(async () => {
    setIsScanning(true)
    try {
      // Simple test - just show success
      await new Promise(resolve => setTimeout(resolve, 1000))
      showSuccess('VSCode import dialog is working!')
      onImportComplete?.(1)
    } catch (error) {
      showError(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsScanning(false)
    }
  }, [showSuccess, showError, onImportComplete])

  return (
    <div className="vscode-importer-content">
      {/* Auto-detection section */}
      <div className="detection-section">
        {isScanning ? (
          <div className="scanning-status">
            <span className="spinner">🔍</span>
            <span>Scanning for VSCode MCP configuration...</span>
          </div>
        ) : detectedConfig ? (
          <div className={`detection-result ${detectedConfig.exists && detectedConfig.serverCount > 0 ? 'success' : 'error'}`}>
            {detectedConfig.exists && detectedConfig.serverCount > 0 ? (
              <>
                <div className="success-message">
                  ✅ Scan successful! Found {detectedConfig.serverCount} MCP servers in VSCode configuration
                </div>
                <div className="detection-path">
                  <strong>Configuration file path:</strong> {detectedConfig.path}
                </div>
              </>
            ) : detectedConfig.exists ? (
              <>
                <div className="warning-message">
                  ⚠️ Found VSCode configuration file but no MCP servers detected
                </div>
                <div className="detection-path">
                  <strong>Configuration file path:</strong> {detectedConfig.path}
                </div>
                <div className="help-message">
                  Please ensure MCP servers are properly configured in VSCode.
                </div>
              </>
            ) : (
              <>
                <div className="error-message">
                  ❌ {detectedConfig.error}
                </div>
                <div className="help-message">
                  <h4>Solutions:</h4>
                  <ul>
                    <li>Ensure VSCode is properly installed</li>
                    <li>Check if MCP servers are configured in VSCode</li>
                    <li>Verify MCP configuration file is in standard path</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Server selection section - show if servers detected */}
      {detectedConfig?.servers && detectedConfig.servers.length > 0 && (
        <>
          <div className="server-selection">
            <div className="selection-header">
              <h3>Available Configurations ({detectedConfig.servers.length} servers)</h3>
              <div className="selection-controls">
                <button onClick={handleSelectAll} className="btn-secondary">Select All</button>
                <button onClick={handleDeselectAll} className="btn-secondary">Deselect All</button>
              </div>
            </div>
            
            <div className="server-list">
              {detectedConfig.servers.map((server) => (
                <div
                  key={server.name}
                  className={`server-item ${server.hasConflict ? 'conflict' : ''} ${previewServer?.name === server.name ? 'selected' : ''}`}
                  onClick={() => handleServerPreview(server)}
                >
                  <label className="server-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedServers.has(server.name)}
                      onChange={() => handleServerToggle(server.name)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="server-info">
                      <span className="server-name">{server.name}</span>
                      <span className="server-transport">({server.transport})</span>
                      {server.hasConflict && <span className="conflict-badge">Name conflict!</span>}
                    </span>
                  </label>
                  <div
                    className="server-info-icon"
                    title="View original VSCode configuration"
                    onMouseEnter={(e) => handleTooltipShow(e, server)}
                    onMouseLeave={handleTooltipHide}
                  >
                    <Info className="info-icon" size={16} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Import options section */}
          <div className="import-options">
            <h3>Import Options</h3>
            
            <div className="option-group">
              <h4>Conflict Resolution:</h4>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    name="conflictResolution"
                    value="skip"
                    checked={importOptions.conflictResolution === 'skip'}
                    onChange={(e) => setImportOptions(prev => ({ ...prev, conflictResolution: e.target.value as any }))}
                  />
                  Skip conflicting servers
                </label>
                <label>
                  <input
                    type="radio"
                    name="conflictResolution"
                    value="rename"
                    checked={importOptions.conflictResolution === 'rename'}
                    onChange={(e) => setImportOptions(prev => ({ ...prev, conflictResolution: e.target.value as any }))}
                  />
                  Rename conflicting servers (format: X-YYYYMMDDHHMMSS)
                </label>
                <label>
                  <input
                    type="radio"
                    name="conflictResolution"
                    value="overwrite"
                    checked={importOptions.conflictResolution === 'overwrite'}
                    onChange={(e) => setImportOptions(prev => ({ ...prev, conflictResolution: e.target.value as any }))}
                  />
                  Overwrite existing servers
                </label>
              </div>
            </div>

            <div className="option-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={importOptions.validateBeforeImport}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, validateBeforeImport: e.target.checked }))}
                />
                Validate configurations before import
              </label>
            </div>
          </div>
        </>
      )}

      {/* Status section - only show if no servers detected or ready to import */}
      {(!detectedConfig?.servers || detectedConfig.servers.length === 0) && (
        <div className="status-section">
          {!detectedConfig ? (
            <>
              <h3>Waiting for scan</h3>
              <p>Opening this dialog will automatically scan for VSCode MCP configuration files.</p>
            </>
          ) : detectedConfig.exists && detectedConfig.serverCount === 0 ? (
            <>
              <h3>No MCP servers found</h3>
              <p>Found VSCode configuration file, but it contains no MCP server configurations.</p>
            </>
          ) : (
            <>
              <h3>Ready to import</h3>
              <p>VSCode import feature is ready, waiting for configuration file detection.</p>
            </>
          )}
        </div>
      )}

      {/* Floating tooltip rendered outside server-list */}
      {tooltipServer && tooltipPosition && (
        <div
          className="info-tooltip-fixed"
          style={{
            position: 'fixed',
            top: tooltipPosition.top,
            right: tooltipPosition.right,
            zIndex: 9999
          }}
        >
          <div className="tooltip-header">Original VSCode Configuration:</div>
          <pre className="tooltip-json-preview">{JSON.stringify(tooltipServer.originalConfig, null, 2)}</pre>
        </div>
      )}

      {/* Import button section */}
      <div className="import-actions">
        <button
          className="btn-primary"
          onClick={handleRealImport}
          disabled={isScanning || selectedServers.size === 0}
        >
          {isScanning ? 'Importing...' : `Import Selected (${selectedServers.size})`}
        </button>
      </div>
    </div>
  )
}

export default ImportVscodeMcpServerViewContent