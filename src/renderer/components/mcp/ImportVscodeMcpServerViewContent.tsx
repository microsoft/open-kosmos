/**
 * ImportVscodeMcpServerViewContent Component
 * Main content area containing the VSCode import functionality
 */

import React, { useState, useCallback, useEffect } from 'react'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/ImportVscodeMcpServerView.css'
import { useMCPServers } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { getPlatformInfo } from '../../lib/mcp/platformDetector'
import { readFileContent } from '../../lib/utilities/fileSystemUtils'
import { detectVSCodeConfigs } from '../../lib/mcp/VscodeConfigDetector'
import { McpOps } from '../../lib/mcp/mcpOps'
import { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes'
import {
  DetectionSection,
  ImportActions,
  ImportOptionsSection,
  ImportTooltip,
  ServerSelectionSection,
  StatusSection,
  type DetectedConfig,
  type ImportOptions,
  type ParsedServerConfig,
} from './ImportVscodeMcpServerSections'
import { useI18n } from '../../lib/i18n/useI18n'

interface ImportVscodeMcpServerViewContentProps {
  onImportComplete?: (importedCount: number) => void
}

const ImportVscodeMcpServerViewContent: React.FC<ImportVscodeMcpServerViewContentProps> = ({
  onImportComplete
}) => {
  const { showError, showSuccess } = useToast()
  const { t } = useI18n()
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

      const detectionResult = await detectVSCodeConfigs()

      if (!detectionResult.success) {
        setDetectedConfig({
          path: 'Detection failed',
          exists: false,
          serverCount: 0,
          error: detectionResult.error || 'Failed to scan VSCode MCP configuration files.'
        })
        return
      }

      const validConfigFile = detectionResult.configFiles.find(
        file => file.exists && file.isValid && file.serverCount > 0
      )

      if (!validConfigFile) {
        const firstExistingConfig = detectionResult.configFiles.find(file => file.exists)

        if (firstExistingConfig) {
          setDetectedConfig({
            path: firstExistingConfig.expandedPath,
            exists: true,
            serverCount: 0,
            error: firstExistingConfig.error || 'Found a VSCode MCP configuration file, but it does not contain a supported MCP server configuration.'
          })
          return
        }

        setDetectedConfig({
          path: 'Multiple paths scanned',
          exists: false,
          serverCount: 0,
          error: 'No VSCode MCP configuration file found in the default user or profile locations.'
        })
        return
      }

      const detectedConfigPath = validConfigFile.expandedPath

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
      let headers: Record<string, string> | undefined

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

      if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) &&
          Object.keys(config.headers).length > 0 && Object.values(config.headers).every((v: unknown) => typeof v === 'string')) {
        headers = config.headers
      }

      // Check for name conflict
      const hasConflict = existingNames.includes(name)

      return {
        name,
        transport,
        command,
        args,
        env,
        headers,
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
      showError(t('mcp.importVscode.selectAtLeastOne'))
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

          // Convert to OpenKosmos.app format
          const openkosmosConfig: OpenKosmosAppMCPServerConfig = {
            name: finalName,
            transport: server.transport === 'StreamableHttp' ? 'StreamableHttp' as const : server.transport as 'stdio' | 'sse',
            command: server.command || '',
            args: server.args || [],
            env: server.env || {},
            headers: server.headers,
            url: server.url || '',
            in_use: true,
            // 🆕 Added from Import from VS Code: uniformly use 1.0.0 and ON-DEVICE
            version: '1.0.0',
            source: 'ON-DEVICE',
            // New local imports do not carry legacy remote version metadata.
            remoteVersion: ''
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
            result = await McpOps.update(server.name, openkosmosConfig)

            if (result.success) {
              importedCount++
            } else {
              errors.push(`${server.name}: Failed to update server - ${result.error || t('common.unknownError')}`)
            }
          } else {
            // Use McpOps.add for new servers or renamed servers
            result = await McpOps.add(openkosmosConfig)

            if (result.success) {
              importedCount++
            } else {
              errors.push(`${server.name}: Failed to add server - ${result.error || t('common.unknownError')}`)
            }
          }

        } catch (serverError) {
          errors.push(`${server.name}: ${serverError instanceof Error ? serverError.message : String(serverError)}`)
        }
      }

      if (importedCount > 0) {
        showSuccess(t('mcp.importVscode.importSuccess', {
          count: importedCount,
          serverLabel: t(importedCount > 1 ? 'mcp.importVscode.serverMultiple' : 'mcp.importVscode.serverSingle'),
          suffix: errors.length > 0 ? t('mcp.importVscode.failedSuffix', { count: errors.length }) : '',
        }))
        onImportComplete?.(importedCount)

        // Refresh runtime info to initialize and connect servers
        await refreshRuntimeInfo()
      } else {
        showError(t('mcp.importVscode.importFailedWithError', { error: errors.join('; ') }))
      }

    } catch (error) {
      showError(t('mcp.importVscode.importFailedWithError', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setIsScanning(false)
    }
  }, [detectedConfig?.servers, selectedServers, importOptions, existingServerNames, showError, showSuccess, onImportComplete, refreshRuntimeInfo, t])

  return (
    <div className="content-view-container vscode-importer-content">
      <div className="toolbar-settings-content mcp-settings-editor-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <DetectionSection isScanning={isScanning} detectedConfig={detectedConfig} />
            <ServerSelectionSection
              servers={detectedConfig?.servers}
              selectedServers={selectedServers}
              previewServer={previewServer}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onServerPreview={handleServerPreview}
              onServerToggle={handleServerToggle}
              onTooltipShow={handleTooltipShow}
              onTooltipHide={handleTooltipHide}
            />
            <ImportOptionsSection
              servers={detectedConfig?.servers}
              importOptions={importOptions}
              onConflictResolutionChange={(conflictResolution) => setImportOptions(prev => ({ ...prev, conflictResolution }))}
              onValidateBeforeImportChange={(validateBeforeImport) => setImportOptions(prev => ({ ...prev, validateBeforeImport }))}
            />
            <StatusSection detectedConfig={detectedConfig} />
            <ImportTooltip tooltipServer={tooltipServer} tooltipPosition={tooltipPosition} />
            <ImportActions
              isScanning={isScanning}
              selectedCount={selectedServers.size}
              onImport={handleRealImport}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImportVscodeMcpServerViewContent