/**
 * AddFromMcpLibraryViewContent Component
 * Main component for adding/updating MCP Servers from the MCP Library.
 *
 * Contains all the functionality for the MCP Library view:
 * - Left panel: MCP server list
 * - Right panel: MCP server detail with requirements check and install/update button
 *
 * ========================================
 * 📌 Button State Logic When Page Opens
 * ========================================
 *
 * 1. "Checking" - requirements status is being checked
 *    - Condition: requirementResults.length > 0 && !areAllRequirementsChecked()
 *
 * 2. "Installed" - already installed (button disabled)
 *    - Condition: name matches AND source === 'IN-LIBRARY' AND Library version <= local version
 *    - Functions: isMcpServerAdded() && !hasNewerVersion()
 *
 * 3. "Update" - newer version available for update
 *    - Condition: name matches AND source === 'IN-LIBRARY' AND Library version > local version
 *    - Functions: isMcpServerAdded() && hasNewerVersion()
 *
 * 4. "Install" - not installed (can be installed)
 *    - Condition: no IN-LIBRARY version with the same name exists
 *    - Functions: !isMcpServerAdded()
 *
 * ========================================
 * 📌 Logic Flow When Clicking Install Button
 * ========================================
 *
 * handleInstallServer()
 *   ↓
 * IF an ON-DEVICE version with the same name is already installed (hasOnDeviceVersion())
 *   ↓ Show showOverwriteDialog confirmation dialog
 *   ├─ "No" → exit installation
 *   └─ "Continue" → proceedWithInstallation(true)
 *        ↓
 *        IF requirements are not fully satisfied
 *          ↓ Show showConfirmDialog reminder dialog
 *          ├─ "No" → exit installation
 *          └─ "Let Kobi Fix & Install" → handleKobiFixAndInstall(true)
 *             (sends prompt: selectedServer.prompts.update_mcp)
 *        ELSE requirements are fully satisfied
 *          ↓ addServerConfig(true)
 *          - Merge ENV: use old value for same-key, use new value for new keys (mergeEnvConfigs)
 *          - Handle OpenKosmos placeholders (replaceOpenKosmosPlaceholders)
 *          - Handle USER-INPUT placeholders (parseUserInputPlaceholders → UserInputModal)
 *          - Overwrite existing MCP (executeServerAdd with overwrite=true)
 *
 * ELSE no ON-DEVICE version with the same name
 *   ↓ proceedWithInstallation(false)
 *   IF requirements are not fully satisfied
 *     ↓ Show showConfirmDialog reminder dialog
 *     ├─ "No" → exit installation
 *     └─ "Let Kobi Fix & Install" → handleKobiFixAndInstall(false)
 *        (sends prompt: selectedServer.prompts.setup_mcp)
 *   ELSE requirements are fully satisfied
 *     - Handle placeholders
 *     - Add new MCP directly (executeServerAdd with overwrite=false)
 *
 * ========================================
 * 📌 Logic Flow When Clicking Update Button
 * ========================================
 *
 * handleInstallServer() (isUpdate = true)
 *   ↓ proceedWithInstallation(true)
 *   IF requirements are not fully satisfied
 *     ↓ Show showConfirmDialog reminder dialog
 *     ├─ "No" → exit installation
 *     └─ "Let Kobi Fix & Install" → handleKobiFixAndInstall(true)
 *        (sends prompt: selectedServer.prompts.update_mcp)
 *   ELSE requirements are fully satisfied
 *     ↓ addServerConfig(true)
 *     - Merge ENV: use old value for same-key, use new value for new keys
 *     - Handle OpenKosmos placeholders
 *     - Handle USER-INPUT placeholders
 *     - Overwrite existing MCP
 *
 * ========================================
 * 📌 Version Override Rules
 * ========================================
 *
 * ❌ "MCP name x, lower version, IN-LIBRARY" cannot overwrite "MCP name x, higher version, IN-LIBRARY"
 *    → Button shows "Installed" and is disabled
 *
 * ❌ "MCP name x, same version, IN-LIBRARY" cannot overwrite "MCP name x, same version, IN-LIBRARY"
 *    → Button shows "Installed" and is disabled
 *
 * ✅ "MCP name x, higher version, IN-LIBRARY" can overwrite "MCP name x, lower version, IN-LIBRARY"
 *    → Button shows "Update", click to overwrite
 *
 * ✅ "MCP name x, any version, IN-LIBRARY" can overwrite "MCP name x, any version, ON-DEVICE"
 *    → Overwrite after user confirmation
 *
 * ❌ Cannot add duplicate-named MCP (duplicate check in executeServerAdd)
 *    → Shows error "Server with name already exists"
 */

import React, { useState, useCallback, useEffect } from 'react'
import { startNewChatFor } from '../../lib/chat/startNewChatFor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../styles/Modal.css'
import '../../styles/McpLibraryView.css'
import { useToast } from '../ui/ToastProvider'
import { useMCPServers } from '../userData/userDataProvider'
import { McpOps } from '../../lib/mcp/mcpOps'
import { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes'
import UserInputModal from './UserInputModal'
import ApplyMcpToAgentsDialog from './ApplyMcpToAgentsDialog'
import {
  parseUserInputPlaceholders,
  applyUserInputsToEnv,
  applyUserInputsToUrl,
  applyUserInputsToArgs,
  UserInputField
} from '../../lib/utilities/processUserInputPlaceholder'
import {
  hasOpenKosmosPlaceholdersInObject,
  replaceOpenKosmosPlaceholders,
  containsOpenKosmosPlaceholder
} from '../../lib/utilities/openkosmosPlaceholderParser'
import { profileDataManager } from '../../lib/userData/profileDataManager'
import { Message } from '@shared/types/chatTypes'
import { sendUserMessageOptimistically } from '../../lib/chat/sendUserMessageOptimistically'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog'
import { createLogger } from '../../lib/utilities/logger';
import ListSearchBox from '../ui/ListSearchBox'
import { agentChatSessionCacheManager } from "../../lib/chat/agentChatSessionCacheManager";
import { agentChatIpc } from "../../lib/chat/agentChatIpc";
const logger = createLogger('[AddFromMcpLibraryViewContent]');

// Requirement check result interface
interface RequirementCheckResult {
  name: string
  requiredVersion: string
  isInstalled: boolean
  installedVersion?: string
  satisfiesRequirement: boolean
  details: string
  isChecking?: boolean
}

interface AddFromMcpLibraryViewContentProps {
  onServerAdded?: (count: number) => void
}

interface McpServerLibraryItem {
  name: string
  description: string
  version?: string
  source?: 'IN-LIBRARY' | 'ON-DEVICE'
  contact?: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  tags?: string[]
  requirements?: Record<string, string>
  prompts?: {
    setup_mcp?: string
    update_mcp?: string
    setup_requirements?: string
  }
}

interface McpLibraryData {
  mcp_servers: McpServerLibraryItem[]
}

const AddFromMcpLibraryViewContent: React.FC<AddFromMcpLibraryViewContentProps> = ({
  onServerAdded
}) => {
  const { showError, showSuccess } = useToast()
  const { refreshRuntimeInfo, servers: existingServers } = useMCPServers()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [libraryData, setLibraryData] = useState<McpLibraryData | null>(null)
  const [selectedServer, setSelectedServer] = useState<McpServerLibraryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [requirementResults, setRequirementResults] = useState<RequirementCheckResult[]>([])

  // User input modal state - using unified UserInputField type
  const [showUserInputModal, setShowUserInputModal] = useState(false)
  const [pendingServerConfig, setPendingServerConfig] = useState<OpenKosmosAppMCPServerConfig | null>(null)
  // Save UserInputFields returned by the backend parser, used for UserInputModal rendering and applying user inputs
  const [userInputFields, setUserInputFields] = useState<UserInputField[]>([])
  // Save whether this is an overwrite installation, used by the user input modal callback
  const [pendingOverwriteMode, setPendingOverwriteMode] = useState(false)

  // 🆕 Search filter
  const [mcpLibSearchQuery, setMcpLibSearchQuery] = useState('')

  // Auto-select first filtered item when current selection is not in filtered results
  const filteredMcpLibServers = libraryData?.mcp_servers.filter(
    server => !mcpLibSearchQuery || server.name.includes(mcpLibSearchQuery)
  ) ?? []

  useEffect(() => {
    if (!mcpLibSearchQuery) return
    if (filteredMcpLibServers.length === 0) {
      setSelectedServer(null)
      setRequirementResults([])
    } else {
      const currentInFiltered = selectedServer && filteredMcpLibServers.some(s => s.name === selectedServer.name)
      if (!currentInFiltered) {
        setSelectedServer(filteredMcpLibServers[0])
        setRequirementResults([])
      }
    }
  }, [mcpLibSearchQuery, filteredMcpLibServers.length])

  // Confirm dialog state for ON-DEVICE overwrite
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false)

  // Confirm dialog state for missing requirements
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmDialogContent, setConfirmDialogContent] = useState<{ missingList: string[] }>({
    missingList: [],
  })

  // Flag to track if this is an update operation
  const [isUpdateMode, setIsUpdateMode] = useState(false)

  // Apply to agents dialog state
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyMcpServerName, setApplyMcpServerName] = useState('')

  // Check if all requirements have finished checking
  const areAllRequirementsChecked = useCallback((): boolean => {
    if (requirementResults.length === 0) return true
    return requirementResults.every(req => !req.isChecking)
  }, [requirementResults])

  // Check if any requirements are not satisfied (only when all are checked)
  const hasUnsatisfiedRequirements = useCallback((): boolean => {
    if (!areAllRequirementsChecked()) return false
    return !requirementResults.every(req => req.satisfiesRequirement)
  }, [requirementResults, areAllRequirementsChecked])

  /**
   * Version comparison function - for comparing Library versions
   * Used to determine whether the Update button should be shown
   *
   * @param v1 - First version number (typically Library version)
   * @param v2 - Second version number (typically locally installed version)
   * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   *
   * @example
   * compareLibraryVersions('2.0.0', '1.0.0') // returns 1 → show Update
   * compareLibraryVersions('1.0.0', '2.0.0') // returns -1 → show Installed
   * compareLibraryVersions('1.0.0', '1.0.0') // returns 0 → show Installed
   */
  const compareLibraryVersions = useCallback((v1: string, v2: string): number => {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0
      const num2 = parts2[i] || 0
      if (num1 > num2) return 1
      if (num1 < num2) return -1
    }
    return 0
  }, [])

  /**
   * Check if MCP Server is already installed from the Library
   * 📌 Used for button state: determines whether to show Install or Installed/Update
   *
   * Condition: name matches AND source === 'IN-LIBRARY'
   * - Returns true → already installed (may show Installed or Update)
   * - Returns false → not installed (shows Install)
   *
   * @param serverName - Name of the server to check
   * @returns true if server is installed from library
   */
  const isMcpServerAdded = useCallback((serverName: string): boolean => {
    return existingServers.some(s =>
      s.name === serverName && s.source === 'IN-LIBRARY'
    )
  }, [existingServers])

  /**
   * Check if a newer version is available in the Library
   * 📌 Used for button state: determines whether to show Installed or Update
   *
   * Comparison logic: Library version > locally installed version
   * - Returns true → update available (shows Update button)
   * - Returns false → no update (shows Installed button)
   *
   * @param serverName - Server name
   * @param libraryVersion - Version number in the Library
   * @returns true if library has newer version
   */
  const hasNewerVersion = useCallback((serverName: string, libraryVersion: string): boolean => {
    const existingServer = existingServers.find(s =>
      s.name === serverName && s.source === 'IN-LIBRARY'
    )
    if (!existingServer?.version) return false

    return compareLibraryVersions(libraryVersion, existingServer.version) > 0
  }, [existingServers, compareLibraryVersions])

  /**
   * Get the installed server's version number
   * Used for UI display "Installed Version: x.x.x"
   *
   * @param serverName - Server name
   * @returns Version string, or null if not installed
   */
  const getInstalledServerVersion = useCallback((serverName: string): string | null => {
    const existingServer = existingServers.find(s =>
      s.name === serverName && s.source === 'IN-LIBRARY'
    )
    return existingServer?.version || null
  }, [existingServers])

  /**
   * Check if an ON-DEVICE version with the same name exists
   * 📌 Used in the Install flow: determines whether to show the overwrite confirmation dialog
   *
   * When user clicks Install:
   * - If an ON-DEVICE version with the same name exists → show showOverwriteDialog
   * - If not → install directly
   *
   * Note: source being undefined is also treated as ON-DEVICE (backward compatibility)
   *
   * @param serverName - Server name
   * @returns true if ON-DEVICE version exists
   */
  const hasOnDeviceVersion = useCallback((serverName: string): boolean => {
    return existingServers.some(s =>
      s.name === serverName && (s.source === 'ON-DEVICE' || !s.source)
    )
  }, [existingServers])

  // Extract version from output text using various patterns
  const extractVersionFromOutput = useCallback((output: string, packageName: string): string | null => {
    if (!output || !output.trim()) {
      return null
    }

    // Define package-specific patterns for common tools
    const packagePatterns: Record<string, RegExp[]> = {
      'python': [
        /Python\s+(\d+\.\d+(?:\.\d+)?)/i,
        /(\d+\.\d+(?:\.\d+)?)/
      ],
      'uvx': [
        /uv-tool-uvx\s+(\d+\.\d+(?:\.\d+)?)/i,
        /uvx\s+(\d+\.\d+(?:\.\d+)?)/i,
        /(\d+\.\d+(?:\.\d+)?)/
      ],
      'playwright': [
        /Version\s+(\d+\.\d+(?:\.\d+)?)/i,
        /playwright\s+(\d+\.\d+(?:\.\d+)?)/i,
        /(\d+\.\d+(?:\.\d+)?)/
      ],
      'node': [
        /v(\d+\.\d+(?:\.\d+)?)/i,
        /(\d+\.\d+(?:\.\d+)?)/
      ],
      'npm': [
        /(\d+\.\d+(?:\.\d+)?)/
      ]
    }

    // Get patterns for the specific package, or use generic patterns if not found
    const patterns = packagePatterns[packageName.toLowerCase()] || [
      // Generic version patterns - try common formats
      /version\s+(\d+\.\d+(?:\.\d+)?)/i,
      /v(\d+\.\d+(?:\.\d+)?)/i,
      /(\d+\.\d+(?:\.\d+)?)/
    ]

    // Try each pattern until we find a match
    for (const pattern of patterns) {
      const match = output.match(pattern)
      if (match && match[1]) {
        return match[1]
      }
    }

    return null
  }, [])

  // Check a single requirement
  const checkSingleRequirement = useCallback(async (packageName: string, requiredVersion: string): Promise<RequirementCheckResult> => {
    let isInstalled = false
    let installedVersion = ''
    let satisfiesRequirement = false
    let details = 'Not installed'

    try {
      // Use generic command pattern: {package_name} --version
      const command = `${packageName} --version`

      logger.debug(`[Dependencies] Executing command: ${command}`)
      const result = await window.electronAPI.builtinTools.execute('execute_command', {
        description: `Check ${packageName} version for MCP requirements`,
        command: command,
        cwd: '.'
      })

      if (result.success && result.data) {
        // Parse the JSON string if needed
        let parsedData;
        if (typeof result.data === 'string') {
          try {
            parsedData = JSON.parse(result.data);
          } catch (e) {
            logger.error(`[Dependencies] Failed to parse JSON for ${packageName}:`, e);
            parsedData = { stdout: '', stderr: '', exitCode: 1 };
          }
        } else {
          parsedData = result.data;
        }

        const output = (parsedData.stdout || parsedData.stderr || '').trim()
        logger.debug(`[Dependencies] ${packageName} version check result:`, { stdout: parsedData.stdout, exitCode: parsedData.exitCode, output })

        // Only process version detection if command succeeded
        if (parsedData.exitCode === 0 && output) {
          const extractedVersion = extractVersionFromOutput(output, packageName)

          if (extractedVersion) {
            isInstalled = true
            installedVersion = extractedVersion
            details = `Installed version: ${installedVersion}`
            satisfiesRequirement = compareVersions(installedVersion, requiredVersion)
            logger.debug(`[Dependencies] ${packageName} version detected: ${installedVersion}, satisfies ${requiredVersion}: ${satisfiesRequirement}`)
          } else if (output.trim()) {
            // Command executed but no clear version found
            isInstalled = true
            installedVersion = 'unknown'
            details = `Installed (version unknown)`
            satisfiesRequirement = false
            logger.debug(`[Dependencies] ${packageName} found but version unknown, output:`, output)
          }
        } else {
          logger.debug(`[Dependencies] Command failed for ${packageName}:`, result)
        }
      } else {
        logger.debug(`[Dependencies] Command failed for ${packageName}:`, result)
      }
    } catch (err) {
      logger.warn(`[Dependencies] Failed to check ${packageName} version:`, err)
    }

    return {
      name: packageName,
      requiredVersion,
      isInstalled,
      installedVersion,
      satisfiesRequirement,
      details
    }
  }, [extractVersionFromOutput])

  // Initialize requirements with loading state
  const initializeRequirements = useCallback((requirements: Record<string, string>): RequirementCheckResult[] => {
    return Object.entries(requirements).map(([name, requiredVersion]) => ({
      name,
      requiredVersion: requiredVersion as string,
      isInstalled: false,
      satisfiesRequirement: false,
      details: 'Checking...',
      isChecking: true
    }))
  }, [])

  // Check single requirement and update state
  const checkSingleRequirementAsync = useCallback(async (packageName: string, requiredVersion: string) => {
    try {
      const result = await checkSingleRequirement(packageName, requiredVersion)

      // Update the specific requirement in the results
      setRequirementResults(prev =>
        prev.map(req =>
          req.name === packageName
            ? { ...result, isChecking: false }
            : req
        )
      )
    } catch (err) {
      logger.warn(`Failed to check dependency ${packageName}:`, err)

      // Update with error state
      setRequirementResults(prev =>
        prev.map(req =>
          req.name === packageName
            ? {
                name: packageName,
                requiredVersion,
                isInstalled: false,
                satisfiesRequirement: false,
                details: 'Check failed',
                isChecking: false
              }
            : req
        )
      )
    }
  }, [checkSingleRequirement])

  // Start checking all requirements asynchronously
  const startRequirementsCheck = useCallback((requirements: Record<string, string>) => {
    // Initialize all requirements with loading state
    const initialResults = initializeRequirements(requirements)
    setRequirementResults(initialResults)

    // Start checking each requirement asynchronously
    Object.entries(requirements).forEach(([name, requiredVersion]) => {
      checkSingleRequirementAsync(name, requiredVersion as string)
    })
  }, [initializeRequirements, checkSingleRequirementAsync])

  // Version comparison function (supports ^, ~, and exact version matching)
  const compareVersions = (installed: string, required: string): boolean => {
    logger.debug(`[Version Compare] Comparing installed: "${installed}" with required: "${required}"`)

    // Parse versions into arrays of numbers
    const parseVersion = (version: string) => {
      return version.split('.').map(v => parseInt(v, 10) || 0)
    }

    const installedParts = parseVersion(installed)
    const requiredParts = parseVersion(required.replace(/^[~^]/, ''))

    // Ensure we have at least 3 parts for major.minor.patch
    while (installedParts.length < 3) installedParts.push(0)
    while (requiredParts.length < 3) requiredParts.push(0)

    const [iMajor, iMinor, iPatch] = installedParts
    const [rMajor, rMinor, rPatch] = requiredParts

    logger.debug(`[Version Compare] Parsed - Installed: [${iMajor}, ${iMinor}, ${iPatch}], Required: [${rMajor}, ${rMinor}, ${rPatch}]`)

    let result = false

    if (required.startsWith('^')) {
      // Caret range: ^1.57.0 means >= 1.57.0 < 2.0.0
      // Lock major version, allow minor and patch updates
      if (iMajor !== rMajor) result = false
      else if (iMajor === rMajor && iMinor > rMinor) result = true
      else if (iMajor === rMajor && iMinor === rMinor && iPatch >= rPatch) result = true
      else result = false
      logger.debug(`[Version Compare] Caret range (^) result: ${result}`)
    } else if (required.startsWith('~')) {
      // Tilde range: ~1.57.0 means >= 1.57.0 < 1.58.0
      // Lock major and minor version, allow patch updates
      if (iMajor !== rMajor) result = false
      else if (iMinor !== rMinor) result = false
      else result = iPatch >= rPatch
      logger.debug(`[Version Compare] Tilde range (~) result: ${result}`)
    } else {
      // Exact version match: 1.57.0 means exactly 1.57.0
      result = iMajor === rMajor && iMinor === rMinor && iPatch === rPatch
      logger.debug(`[Version Compare] Exact match result: ${result}`)
    }

    return result
  }

  // Check requirements when selected server changes
  useEffect(() => {
    if (selectedServer && selectedServer.requirements && Object.keys(selectedServer.requirements).length > 0) {
      // Start asynchronous requirements check
      startRequirementsCheck(selectedServer.requirements)
    } else {
      setRequirementResults([])
    }
  }, [selectedServer, startRequirementsCheck])

  // Load library data on component mount
  useEffect(() => {
    loadLibraryData()
  }, [])

  const loadLibraryData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      logger.debug('[AddFromMcpLibraryViewContent] Loading library data via IPC...')

      // Use IPC to get library data from main process
      const result = await window.electronAPI.mcpLibrary.getLibraryData()

      if (!result.success) {
        throw new Error(result.error || 'Failed to load library data')
      }

      const data: McpLibraryData = result.data

      if (!data.mcp_servers || !Array.isArray(data.mcp_servers)) {
        throw new Error('Invalid data format: mcp_servers array not found')
      }

      logger.debug(`[AddFromMcpLibraryViewContent] Successfully loaded ${data.mcp_servers.length} servers`)

      setLibraryData(data)

      // Check for selectMcp URL parameter to auto-select specific server
      const selectMcpParam = searchParams.get('selectMcp')
      if (selectMcpParam && data.mcp_servers.length > 0) {
        const serverToSelect = data.mcp_servers.find(server => server.name === selectMcpParam)
        if (serverToSelect) {
          logger.debug(`[AddFromMcpLibraryViewContent] Auto-selecting MCP server from URL param: ${selectMcpParam}`)
          setSelectedServer(serverToSelect)
        } else {
          // Fallback to first server if specified server not found
          logger.debug(`[AddFromMcpLibraryViewContent] Server "${selectMcpParam}" not found, selecting first server`)
          setSelectedServer(data.mcp_servers[0])
        }
      } else if (data.mcp_servers.length > 0) {
        // Auto-select first server if available
        setSelectedServer(data.mcp_servers[0])
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      logger.error('[AddFromMcpLibraryViewContent] Failed to load library data:', err)
      setError(errorMessage)
      showError(`Failed to load MCP library: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [showError, searchParams])

  /**
   * Core logic for executing server add (supports overwrite installation)
   * 📌 This is the function that ultimately performs the add/update operation
   *
   * Call paths:
   * - addServerConfig() → executeServerAdd()
   * - handleUserInputSubmit() → executeServerAdd()
   * - handleUserInputSkip() → executeServerAdd()
   *
   * Overwrite rules check is performed here (for overwrite=false cases):
   * - Does not allow adding duplicate-named MCP → shows error
   *
   * @param config - MCP server configuration
   * @param overwrite -
   *   - true: Update mode, uses McpOps.update() to overwrite existing config
   *   - false: Install mode, uses McpOps.add() to add new config
   */
  const executeServerAdd = useCallback(async (config: OpenKosmosAppMCPServerConfig, overwrite: boolean = false) => {
    try {
      let result;

      if (overwrite) {
        // Update mode: use McpOps.update to preserve any existing state
        logger.debug('[AddFromMcpLibraryViewContent] Updating existing MCP server:', config.name)
        result = await McpOps.update(config.name, config);

        if (result.success) {
          showSuccess(`Server "${config.name}" updated successfully! Reconnecting...`);

          // Refresh runtime info to reconnect the server
          setTimeout(() => {
            refreshRuntimeInfo();
          }, 100);

          // Notify parent component
          onServerAdded?.(1);

          // Show Apply to Agents dialog
          setApplyMcpServerName(config.name);
          setApplyDialogOpen(true);
        } else {
          showError(`Failed to update server: ${result.error || 'Unknown error'}`);
        }
      } else {
        // Check for duplicate name first
        const duplicateServer = existingServers.find(s => s.name === config.name)
        if (duplicateServer) {
          showError(`Server with name "${config.name}" already exists. Please use Update instead.`)
          return
        }

        // Add new server
        result = await McpOps.add(config);

        if (result.success) {
          showSuccess(`Server "${config.name}" added successfully! Connecting...`);

          // Refresh runtime info to connect the new server
          setTimeout(() => {
            refreshRuntimeInfo();
          }, 100);

          // Notify parent component
          onServerAdded?.(1);

          // Show Apply to Agents dialog
          setApplyMcpServerName(config.name);
          setApplyDialogOpen(true);
        } else {
          showError(`Failed to add server: ${result.error || 'Unknown error'}`);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      showError(`Failed to ${overwrite ? 'update' : 'add'} server: ${errorMessage}`);
    }
  }, [showSuccess, showError, refreshRuntimeInfo, onServerAdded, existingServers]);

  // Handle user input submission
  const handleUserInputSubmit = useCallback(async (userInputs: Record<string, any>) => {
    if (!pendingServerConfig) {
      showError('No pending server configuration found');
      return;
    }

    try {
      // Use unified handler to apply user inputs to environment variables
      const updatedEnv = applyUserInputsToEnv(
        pendingServerConfig.env,
        userInputs,
        userInputFields
      );
      // 🔥 Also apply user inputs to URL if needed
      const updatedUrl = applyUserInputsToUrl(
        pendingServerConfig.url || '',
        userInputs,
        userInputFields
      );
      const updatedArgs = applyUserInputsToArgs(
        pendingServerConfig.args || [],
        userInputs,
        userInputFields
      );
      const finalConfig: OpenKosmosAppMCPServerConfig = {
        ...pendingServerConfig,
        env: updatedEnv,
        url: updatedUrl,
        args: updatedArgs
      };

      // Execute actual server add, passing saved overwrite mode state
      logger.debug('[AddFromMcpLibraryViewContent] handleUserInputSubmit: pendingOverwriteMode =', pendingOverwriteMode);
      await executeServerAdd(finalConfig, pendingOverwriteMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to apply user inputs: ${errorMessage}`);
    } finally {
      // Clean up state
      setShowUserInputModal(false);
      setPendingServerConfig(null);
      setUserInputFields([]);
      setPendingOverwriteMode(false);
    }
  }, [pendingServerConfig, userInputFields, showError, pendingOverwriteMode, executeServerAdd]);

  // Handle user input skip
  const handleUserInputSkip = useCallback(async () => {
    if (!pendingServerConfig) {
      showError('No pending server configuration found');
      return;
    }

    try {
      // Use unified handler to apply empty inputs (optional fields will be automatically removed)
      const cleanedEnv = applyUserInputsToEnv(
        pendingServerConfig.env,
        {}, // empty user inputs
        userInputFields
      );
      // 🔥 Also handle URL field on skip
      const cleanedUrl = applyUserInputsToUrl(
        pendingServerConfig.url || '',
        {},
        userInputFields
      );

      const cleanedArgs = applyUserInputsToArgs(
        pendingServerConfig.args || [],
        {},
        userInputFields
      );

      const finalConfig: OpenKosmosAppMCPServerConfig = {
        ...pendingServerConfig,
        env: cleanedEnv,
        url: cleanedUrl,
        args: cleanedArgs
      };

      // Execute actual server add, passing saved overwrite mode state
      logger.debug('[AddFromMcpLibraryViewContent] handleUserInputSkip: pendingOverwriteMode =', pendingOverwriteMode);
      await executeServerAdd(finalConfig, pendingOverwriteMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to add server: ${errorMessage}`);
    } finally {
      // Clean up state
      setShowUserInputModal(false);
      setPendingServerConfig(null);
      setUserInputFields([]);
      setPendingOverwriteMode(false);
    }
  }, [pendingServerConfig, userInputFields, showError, pendingOverwriteMode, executeServerAdd]);

  /**
   * ENV configuration merge function
   * 📌 Used when updating/overwriting to merge new and old version environment variables
   *
   * Merge rules:
   * 1. Same-name keys: use old value (preserve user-configured values)
   * 2. New keys: use new value (may contain placeholders, needs further processing)
   * 3. Keys in old version but not in new version: preserve (backward compatibility)
   *
   * @param newEnv - New version ENV config from Library
   * @param oldEnv - Old version ENV config from local installation
   * @returns { mergedEnv: merged ENV, newKeys: array of newly added key names }
   *
   * @example
   * // Old version: { API_KEY: "xxx", OLD_CONFIG: "yyy" }
   * // New version: { API_KEY: "{{USER_INPUT}}", NEW_FEATURE: "{{USER_INPUT}}" }
   * // Result: { API_KEY: "xxx", OLD_CONFIG: "yyy", NEW_FEATURE: "{{USER_INPUT}}" }
   * // newKeys: ["NEW_FEATURE"]
   */
  const mergeEnvConfigs = useCallback((
    newEnv: Record<string, string>,
    oldEnv: Record<string, string> | undefined
  ): { mergedEnv: Record<string, string>; newKeys: string[] } => {
    if (!oldEnv || Object.keys(oldEnv).length === 0) {
      return { mergedEnv: newEnv, newKeys: Object.keys(newEnv) }
    }

    const mergedEnv: Record<string, string> = {}
    const newKeys: string[] = []

    // Process all keys from new config
    for (const key of Object.keys(newEnv)) {
      if (key in oldEnv) {
        // Key exists in old config, use old value
        mergedEnv[key] = oldEnv[key]
        logger.debug(`[ENV Merge] Key "${key}": using old value`)
      } else {
        // New key, use new value (may contain placeholders)
        mergedEnv[key] = newEnv[key]
        newKeys.push(key)
        logger.debug(`[ENV Merge] Key "${key}": new key, using new value`)
      }
    }

    // Also include any old keys not in new config
    for (const key of Object.keys(oldEnv)) {
      if (!(key in mergedEnv)) {
        mergedEnv[key] = oldEnv[key]
        logger.debug(`[ENV Merge] Key "${key}": preserving old key not in new config`)
      }
    }

    return { mergedEnv, newKeys }
  }, [])

  /**
   * Add/update MCP server configuration
   * 📌 Intermediate function that handles config, placeholders, and calls executeServerAdd
   *
   * Processing steps:
   * 1. If in overwrite mode, merge new and old ENV configs (mergeEnvConfigs)
   * 2. Handle OpenKosmos placeholders for new keys only (replaceOpenKosmosPlaceholders)
   * 3. Check for USER_INPUT placeholders in new keys (parseUserInputPlaceholders)
   *    - If found, show UserInputModal to wait for user input
   *    - If not found, call executeServerAdd directly
   *
   * @param overwrite -
   *   - true: Update mode or ON-DEVICE overwrite, will perform ENV merge
   *   - false: Fresh install, no merge needed
   */
  const addServerConfig = useCallback(async (overwrite: boolean = false) => {
    if (!selectedServer) {
      showError('Server configuration not found')
      return
    }

    setIsAdding(true)

    try {
      logger.debug('[AddFromMcpLibraryViewContent] Adding server config:', selectedServer.name, 'overwrite:', overwrite)

      // Step 1: Prepare server configuration with placeholder processing
      // IMPORTANT: Deep clone env to avoid mutating selectedServer.env (which would affect UI display)
      let newEnvConfig = selectedServer.env ? { ...selectedServer.env } : {}

      // Step 1.0: If overwriting, get existing server's ENV and merge
      let mergedEnvConfig = { ...newEnvConfig }
      let newEnvKeys: string[] = Object.keys(newEnvConfig)

      if (overwrite) {
        // Find existing server to get its ENV
        const existingServer = existingServers.find(s => s.name === selectedServer.name)
        if (existingServer?.env) {
          logger.debug('[AddFromMcpLibraryViewContent] Overwrite mode: merging ENV configs')
          const mergeResult = mergeEnvConfigs(newEnvConfig, existingServer.env)
          mergedEnvConfig = mergeResult.mergedEnv
          newEnvKeys = mergeResult.newKeys
          logger.debug('[AddFromMcpLibraryViewContent] ENV merge complete. New keys:', newEnvKeys)
        }
      }

      // Step 1.1: Process OpenKosmos placeholders only for new keys
      // Create a subset of env with only new keys for placeholder processing
      const newKeysEnv: Record<string, string> = {}
      for (const key of newEnvKeys) {
        newKeysEnv[key] = mergedEnvConfig[key]
      }

      if (hasOpenKosmosPlaceholdersInObject(newKeysEnv)) {
        logger.debug('[AddFromMcpLibraryViewContent] Found OpenKosmos placeholders in new env keys, replacing...')
        const replacedNewKeysEnv = await replaceOpenKosmosPlaceholders(newKeysEnv)
        // Merge replaced values back
        for (const key of newEnvKeys) {
          mergedEnvConfig[key] = replacedNewKeysEnv[key]
        }
      }

      // 🔥 Step 1.1.1: Process OpenKosmos placeholders in URL field
      let processedUrl = selectedServer.url || ''
      if (processedUrl && containsOpenKosmosPlaceholder(processedUrl)) {
        logger.debug('[AddFromMcpLibraryViewContent] Found OpenKosmos placeholder in url, replacing...')
        const replacedUrlObj = await replaceOpenKosmosPlaceholders({ _url: processedUrl })
        processedUrl = replacedUrlObj._url || processedUrl
      }

      // Build MCP server configuration from library item
      const mcpServerConfig: OpenKosmosAppMCPServerConfig = {
        name: selectedServer.name,
        transport: selectedServer.transport === 'StreamableHttp' ? 'StreamableHttp' as const : selectedServer.transport as 'stdio' | 'sse',
        in_use: true,
        url: processedUrl,
        command: selectedServer.command || '',
        args: selectedServer.args || [],
        env: mergedEnvConfig,
        // 🆕 Added from Library: use version and source from library, default to IN-LIBRARY
        version: selectedServer.version || '1.0.0',
        source: selectedServer.source || 'IN-LIBRARY',
        // 🆕 remoteVersion: same as version for IN-LIBRARY source (both are CDN version)
        remoteVersion: selectedServer.version || '1.0.0'
      }

      // Step 1.2: Check for USER_INPUT placeholders in new env keys, url, AND args
      const configForUserInput = {
        env: newKeysEnv,
        url: selectedServer.url || '', // Use original url for USER_INPUT detection
        args: selectedServer.args || [],
      }
      const parseResult = await parseUserInputPlaceholders(configForUserInput)

      if (parseResult.hasUserInputFields) {
        // Need user input for new env keys, save parsed results and show modal
        logger.debug('[AddFromMcpLibraryViewContent] Found USER_INPUT placeholders in new env keys, showing modal...')
        logger.debug('[AddFromMcpLibraryViewContent] Saving pendingOverwriteMode:', overwrite)
        setUserInputFields(parseResult.fields)
        setPendingServerConfig(mcpServerConfig)
        setPendingOverwriteMode(overwrite) // Save overwrite mode state for modal callback
        setShowUserInputModal(true)
        return // Wait for user input
      }

      // Step 2: No user input needed, directly add/update server
      await executeServerAdd(mcpServerConfig, overwrite)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to install server: ${errorMessage}`)
    } finally {
      if (!showUserInputModal) {
        setIsAdding(false)
      }
    }
  }, [selectedServer, showError, executeServerAdd, showUserInputModal, existingServers, mergeEnvConfigs])

  /**
   * Handle Kobi fixing requirements and installing MCP server
   * 📌 Uses different prompt URLs based on the scenario
   *
   * @param isUpdateOrOverwrite - Whether this is an Update or ON-DEVICE overwrite scenario
   *   - true: Update mode or Install overwriting ON-DEVICE → uses selectedServer.prompts.update_mcp
   *   - false: Fresh install (no ON-DEVICE conflict) → uses selectedServer.prompts.setup_mcp
   */
  const handleKobiFixAndInstall = useCallback(async (isUpdateOrOverwrite: boolean) => {
    try {
      // 1. Get current user info
      const userAlias = profileDataManager.getCurrentUserAlias()
      if (!userAlias) {
        showError('User not logged in')
        return
      }

      // 2. Get current profile data, find Kobi agent
      const profileData = profileDataManager.getCache()
      if (!profileData?.profile?.chats) {
        showError('Unable to get agent configuration')
        return
      }

      // 3. Find Kobi agent (name === 'Kobi')
      const kobiChat = profileData.profile.chats.find(chat =>
        chat.agent?.name?.toLowerCase() === 'kobi'
      )

      if (!kobiChat) {
        showError('Kobi agent not found')
        return
      }

      // 3.1. Switch to Kobi's new chat session via agentChatManager
      logger.debug(`[Install with Kobi] Creating new chat session for Kobi (${kobiChat.chat_id})`)

      const newChatResult = await startNewChatFor(kobiChat.chat_id)
      if (!newChatResult.success || !newChatResult.chatSessionId) {
        showError(`Failed to create new chat session: ${newChatResult.error || 'Unknown error'}`)
        return
      }

      const currentChatSessionId = newChatResult.chatSessionId
      logger.debug(`[Install with Kobi] Successfully created new chat session: ${currentChatSessionId}`)

      // 3.2. Navigate to the chat session page FIRST
      const chatUrl = `/agent/chat/${kobiChat.chat_id}/${currentChatSessionId}`
      logger.debug(`[Install with Kobi] Navigating to: ${chatUrl}`)
      navigate(chatUrl)

      // Wait for navigation to complete before updating cache
      await new Promise(resolve => setTimeout(resolve, 200))

      // 3.3. Determine prompt URL based on scenario using MCP's own prompts config
      // - Update mode or overwriting ON-DEVICE: selectedServer.prompts.update_mcp
      // - Fresh install: selectedServer.prompts.setup_mcp
      const promptUrl = isUpdateOrOverwrite
        ? selectedServer?.prompts?.update_mcp
        : selectedServer?.prompts?.setup_mcp

      if (!promptUrl) {
        showError(`No prompt URL configured for ${isUpdateOrOverwrite ? 'update' : 'setup'}`)
        return
      }

      logger.debug(`[Install with Kobi] Using prompt URL: ${promptUrl} (isUpdateOrOverwrite: ${isUpdateOrOverwrite})`)

      // 3.4. Send user message to CurrentChatSessionId following the two-step process
      const userMsg: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: [{
          type: 'text',
          text: `Follow instructions in ${promptUrl}`
        }],
        timestamp: Date.now(),
      }

      await sendUserMessageOptimistically({
        chatSessionId: currentChatSessionId,
        userMessage: userMsg,
        cacheManager: agentChatSessionCacheManager,
        send: () => agentChatIpc.streamMessage(userMsg, {
          onAssistantMessage: (msg: any) => {
            logger.debug('[Install with Kobi] Assistant message:', msg.id)
          },
          onToolUse: (toolName: string) => {
            logger.debug('[Install with Kobi] Tool used:', toolName)
          },
          onToolResult: (toolMessage: any) => {
            logger.debug('[Install with Kobi] Tool result received:', toolMessage.id)
          },
        }),
      })

      logger.debug('[Install with Kobi] Message sent successfully')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to start Kobi fix: ${errorMessage}`)
      logger.error('[AddFromMcpLibraryViewContent] Install with Kobi error:', error)
    }
  }, [showError, navigate, selectedServer])

  /**
   * Continue installation flow - called after the ON-DEVICE check
   * 📌 Checks whether requirements are met and determines the next step
   *
   * Call scenarios:
   * 1. Install with no ON-DEVICE conflict
   * 2. Install after user confirms overwriting ON-DEVICE
   * 3. Update — called directly
   *
   * Flow:
   * - If there are unsatisfied requirements → show showConfirmDialog
   *   - User selects "No" → exit
   *   - User selects "Let Kobi Fix & Install" → handleKobiFixAndInstall()
   * - If all requirements are satisfied → addServerConfig(isUpdate)
   *
   * @param isUpdate - true for Update mode, false for Install mode
   */
  const proceedWithInstallation = useCallback(async (isUpdate: boolean) => {
    // Get unsatisfied requirements
    const unsatisfiedRequirements = requirementResults.filter(req => !req.satisfiesRequirement)

    if (unsatisfiedRequirements.length > 0) {
      // Build the list of missing requirements for the dialog
      const missingList = unsatisfiedRequirements.map(req => {
        const version = req.requiredVersion ? ` (${req.requiredVersion})` : ''
        return `${req.name}${version} - ${req.details}`
      })

      // Show custom confirm dialog for missing requirements
      setIsUpdateMode(isUpdate)
      setConfirmDialogContent({ missingList })
      setShowConfirmDialog(true)
      return // Wait for user interaction with dialog
    } else {
      // All requirements satisfied, directly add server config
      await addServerConfig(isUpdate)
    }
  }, [requirementResults, addServerConfig])

  /**
   * Install/Update button click handler
   * 📌 This is the main entry point for button clicks
   *
   * Full flow:
   * 1. Check if requirements are still being checked
   * 2. Determine whether this is an Install or Update:
   *    - serverAdded = isMcpServerAdded() → whether IN-LIBRARY version is installed
   *    - hasUpdate = serverAdded && hasNewerVersion() → whether an update is available
   *    - isUpdate = hasUpdate → Update mode flag
   *
   * 3. If Install and no IN-LIBRARY version is installed:
   *    - Check if ON-DEVICE version exists (hasOnDeviceVersion)
   *    - If exists → show showOverwriteDialog to ask for confirmation
   *    - If not → call proceedWithInstallation(false) directly
   *
   * 4. If Update:
   *    - Call proceedWithInstallation(true) directly
   *
   * Version override rules are enforced here via button disabled state:
   * - Lower/same version IN-LIBRARY cannot overwrite higher/same version IN-LIBRARY → button disabled
   */
  const handleInstallServer = useCallback(async () => {
    if (!selectedServer) {
      showError('Please select a server to install')
      return
    }

    // Check if requirements are still being checked
    if (requirementResults.length > 0 && !areAllRequirementsChecked()) {
      showError('Please wait for requirements check to complete')
      return
    }

    // Determine if this is an install or update operation
    const serverAdded = isMcpServerAdded(selectedServer.name)
    const hasUpdate = serverAdded && hasNewerVersion(selectedServer.name, selectedServer.version || '1.0.0')
    const isUpdate = hasUpdate

    // For INSTALL operation: Check if ON-DEVICE version exists
    if (!isUpdate && !serverAdded) {
      const hasOnDevice = hasOnDeviceVersion(selectedServer.name)
      if (hasOnDevice) {
        // Show overwrite confirmation dialog
        setIsUpdateMode(false)
        setShowOverwriteDialog(true)
        return
      }
    }

    // For UPDATE operation or INSTALL without ON-DEVICE conflict
    setIsUpdateMode(isUpdate)
    await proceedWithInstallation(isUpdate)
  }, [selectedServer, requirementResults, areAllRequirementsChecked, isMcpServerAdded, hasNewerVersion, hasOnDeviceVersion, showError, proceedWithInstallation])

  // Added: handle Fix Requirements button click
  const handleFixRequirements = useCallback(async () => {
    try {
      // 1. Get current user info
      const userAlias = profileDataManager.getCurrentUserAlias();
      if (!userAlias) {
        showError('User not logged in');
        return;
      }

      // 2. Get current profile data, find Kobi agent
      const profileData = profileDataManager.getCache();
      if (!profileData?.profile?.chats) {
        showError('Unable to get agent configuration');
        return;
      }

      // 3. Find Kobi agent (name === 'Kobi')
      const kobiChat = profileData.profile.chats.find(chat =>
        chat.agent?.name?.toLowerCase() === 'kobi'
      );

      if (!kobiChat) {
        showError('Kobi agent not found');
        return;
      }

      // 3.1. Switch to Kobi's new chat session via agentChatManager
      logger.debug(`[Fix Requirements] Creating new chat session for Kobi (${kobiChat.chat_id})`);

      const newChatResult = await startNewChatFor(kobiChat.chat_id);
      if (!newChatResult.success || !newChatResult.chatSessionId) {
        showError(`Failed to create new chat session: ${newChatResult.error || 'Unknown error'}`);
        return;
      }

      const currentChatSessionId = newChatResult.chatSessionId;
      logger.debug(`[Fix Requirements] Successfully created new chat session: ${currentChatSessionId}`);

      // 3.2. Navigate to the chat session page FIRST
      const chatUrl = `/agent/chat/${kobiChat.chat_id}/${currentChatSessionId}`;
      logger.debug(`[Fix Requirements] Navigating to: ${chatUrl}`);
      navigate(chatUrl);

      // 3.3. Get the setup_requirements prompt URL from selectedServer
      const promptUrl = selectedServer?.prompts?.setup_requirements
      if (!promptUrl) {
        showError('No setup_requirements prompt URL configured for this MCP server')
        return
      }

      // 3.4. Send user message to CurrentChatSessionId following the two-step process
      const userMsg: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: [{
          type: 'text',
          text: `Follow instructions in ${promptUrl} to fix ${selectedServer?.name || 'MCP server'} requirements`
        }],
        timestamp: Date.now(),
      };

      await sendUserMessageOptimistically({
        chatSessionId: currentChatSessionId,
        userMessage: userMsg,
        cacheManager: agentChatSessionCacheManager,
        send: () => agentChatIpc.streamMessage(userMsg, {
          onAssistantMessage: (msg: any) => {
            logger.debug('[Fix Requirements] Assistant message:', msg.id);
          },
          onToolUse: (toolName: string) => {
            logger.debug('[Fix Requirements] Tool used:', toolName);
          },
          onToolResult: (toolMessage: any) => {
            logger.debug('[Fix Requirements] Tool result received:', toolMessage.id);
          },
        }),
      });

      logger.debug('[Fix Requirements] Message sent successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Fix Requirements failed: ${errorMessage}`);
      logger.error('[AddFromMcpLibraryViewContent] Fix Requirements error:', error);
    }
  }, [showError, navigate, selectedServer]);

  return (
    <div className="add-from-mcp-library-content mcp-library-view">
      {isLoading ? (
        <div className="library-loading">
          <svg className="spinner" width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="18" cy="18" r="16.5" stroke="black" strokeOpacity="0.15" strokeWidth="3"/>
            <path d="M34.5 18C34.5 22.3761 32.7616 26.5729 29.6673 29.6673C26.5729 32.7616 22.3761 34.5 18 34.5" stroke="#272320" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <span>Loading MCP library...</span>
        </div>
      ) : error ? (
        <div className="library-error">
          <div className="error-icon">❌</div>
          <div className="error-message">{error}</div>
          <button className="btn-secondary" onClick={loadLibraryData}>
            Retry
          </button>
        </div>
      ) : libraryData && libraryData.mcp_servers.length > 0 ? (
        <div className="library-layout">
          {/* Left: Server List */}
          <div className="server-list-panel">
            <ListSearchBox
              value={mcpLibSearchQuery}
              onChange={setMcpLibSearchQuery}
              placeholder="Search MCP servers..."
            />
            <div className="server-list">
              {filteredMcpLibServers.map((server) => {
                const serverAdded = isMcpServerAdded(server.name)
                const hasUpdate = serverAdded && hasNewerVersion(server.name, server.version || '1.0.0')

                return (
                  <div
                    key={server.name}
                    className={`server-card ${selectedServer?.name === server.name ? 'selected' : ''} ${serverAdded ? 'added' : ''}`}
                    onClick={() => {
                      setSelectedServer(server)
                      setRequirementResults([])
                    }}
                  >
                    <div className="server-card-header">
                      <div className="skill-card-info">
                        <div className="skill-card-name-group">
                          <span className="server-card-name">
                            {server.name}
                            {hasUpdate && (
                              <sup style={{ color: '#ff4444', marginLeft: '4px', fontSize: '0.7em', fontWeight: 'bold' }}>new</sup>
                            )}
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center' }}>
                            {server.tags?.map(tag => (
                              <span key={tag} className="skill-card-version" style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>{tag}</span>
                            ))}
                            {server.version && (
                              <span className="skill-card-version">v{server.version}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {serverAdded && !hasUpdate && (
                        <span className="added-badge">Installed</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: Server Detail */}
          <div className="server-detail-panel">
            {selectedServer ? (
              <div className="mcp-server-detail-view">
                {/* Server Header */}
                <div className="server-detail-header">
                  <div className="server-header-info">
                    <div className="server-header-text">
                      <h2 className="server-title">{selectedServer.name}</h2>
                    </div>
                  </div>

                  {/* Install/Update Button in Header */}
                  <div className="server-header-actions">
                    {(() => {
                      const serverAdded = isMcpServerAdded(selectedServer.name)
                      const hasUpdate = serverAdded && hasNewerVersion(selectedServer.name, selectedServer.version || '1.0.0')

                      if (hasUpdate) {
                        return (
                          <button
                            className="btn-primary"
                            onClick={handleInstallServer}
                            disabled={isAdding || (requirementResults.length > 0 && !areAllRequirementsChecked()) || hasUnsatisfiedRequirements()}
                          >
                            {(requirementResults.length > 0 && !areAllRequirementsChecked())
                              ? 'Checking...'
                              : isAdding
                                ? 'Updating...'
                                : 'Update'
                            }
                          </button>
                        )
                      } else {
                        return (
                          <button
                            className={`btn-primary ${serverAdded ? 'btn-added' : ''}`}
                            onClick={handleInstallServer}
                            disabled={isAdding || serverAdded || (requirementResults.length > 0 && !areAllRequirementsChecked()) || hasUnsatisfiedRequirements()}
                          >
                            {(requirementResults.length > 0 && !areAllRequirementsChecked())
                              ? 'Checking...'
                              : serverAdded
                                ? 'Installed'
                                : isAdding
                                  ? 'Installing...'
                                  : 'Install'
                            }
                          </button>
                        )
                      }
                    })()}
                  </div>
                </div>

                {/* Server Content */}
                <div className="server-detail-content">
                  {/* Requirements Warning */}
                  {selectedServer.requirements && Object.keys(selectedServer.requirements).length > 0 && hasUnsatisfiedRequirements() && (
                    <div className="detail-section warning-section">
                      <div className="requirements-warning">
                        <div className="warning-icon">⚠️</div>
                        <div className="warning-text">
                          This MCP server may not work correctly until all requirements are met.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Requirements Section */}
                  {selectedServer.requirements && (
                    <div className="detail-section">
                      <div
                        className="section-title-with-actions"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '16px'
                        }}
                      >
                        <h3 className="section-title" style={{ margin: 0 }}>Requirements</h3>
                        {/* Fix Requirements button - shown only when requirements are not fully satisfied */}
                        {hasUnsatisfiedRequirements() && (
                          <div className="server-header-actions">
                            <button
                              className="btn-primary"
                              onClick={handleFixRequirements}
                              title="Let Kobi agent help fix requirements"
                              style={{ fontSize: '12px', padding: '4px 8px', boxShadow: 'none' }}
                            >
                              Fix Requirements
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="section-content">
                        {Object.keys(selectedServer.requirements).length === 0 ? (
                          <p className="no-requirements">No requirements needed</p>
                        ) : (
                          <div className="requirements-table-container">
                            <table className="requirements-table">
                              <thead>
                                <tr>
                                  <th>Requirement</th>
                                  <th>Required Version</th>
                                  <th>Actual Version</th>
                                  <th>Meets Requirements</th>
                                  <th>Local Details</th>
                                </tr>
                              </thead>
                              <tbody>
                                {requirementResults.length > 0 ? (
                                  requirementResults.map((req: RequirementCheckResult) => (
                                    <tr key={req.name} className={`requirement-row ${req.isChecking ? 'checking' : req.satisfiesRequirement ? 'satisfied' : req.isInstalled ? 'installed' : 'missing'}`}>
                                      <td className="requirement-name">{req.name}</td>
                                      <td className="requirement-version">{req.requiredVersion}</td>
                                      <td className="requirement-version">{req.installedVersion || '-'}</td>
                                      <td className="requirement-status">
                                        {req.isChecking ? (
                                          <svg className="spinner-small" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <g clipPath="url(#clip0_390_2695)">
                                              <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                                              <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                                            </g>
                                            <defs>
                                              <clipPath id="clip0_390_2695">
                                                <rect width="20" height="20" fill="white"/>
                                              </clipPath>
                                            </defs>
                                          </svg>
                                        ) : (
                                          <span style={{color: req.satisfiesRequirement ? '#16a34a' : '#dc2626'}}>
                                            {req.satisfiesRequirement ? '✓' : '✗'}
                                          </span>
                                        )}
                                      </td>
                                      <td className="requirement-details">
                                        {req.isChecking ? (
                                          <svg className="spinner-small" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <g clipPath="url(#clip0_390_2696)">
                                              <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                                              <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                                            </g>
                                            <defs>
                                              <clipPath id="clip0_390_2696">
                                                <rect width="20" height="20" fill="white"/>
                                              </clipPath>
                                            </defs>
                                          </svg>
                                        ) : (
                                          req.details
                                        )}
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  Object.entries(selectedServer.requirements).map(([name, version]) => (
                                    <tr key={name} className="requirement-row checking">
                                      <td className="requirement-name">{name}</td>
                                      <td className="requirement-version">{version as string}</td>
                                      <td className="requirement-version">-</td>
                                      <td className="requirement-status">
                                        <svg className="spinner-small" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <g clipPath="url(#clip0_390_2695)">
                                            <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                                            <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                                          </g>
                                          <defs>
                                            <clipPath id="clip0_390_2695">
                                              <rect width="20" height="20" fill="white"/>
                                            </clipPath>
                                          </defs>
                                        </svg>
                                      </td>
                                      <td className="requirement-details">
                                        <svg className="spinner-small" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <g clipPath="url(#clip0_390_2697)">
                                            <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                                            <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                                          </g>
                                          <defs>
                                            <clipPath id="clip0_390_2697">
                                              <rect width="20" height="20" fill="white"/>
                                            </clipPath>
                                          </defs>
                                        </svg>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Transport Configuration Section */}
                  <div className="detail-section">
                    <h3 className="section-title">Configuration</h3>
                    <div className="section-content">
                      <pre className="schema-code">
                        <code>{(() => {
                          // Build complete configuration JSON
                          const config: any = {
                            name: selectedServer.name,
                            transport: selectedServer.transport
                          };

                          // Add corresponding fields based on transport type
                          if (selectedServer.transport === 'stdio') {
                            if (selectedServer.command) config.command = selectedServer.command;
                            if (selectedServer.args && selectedServer.args.length > 0) config.args = selectedServer.args;
                          } else if (selectedServer.transport === 'sse' || selectedServer.transport === 'StreamableHttp') {
                            if (selectedServer.url) config.url = selectedServer.url;
                          }

                          // Add environment variables (if any)
                          if (selectedServer.env && Object.keys(selectedServer.env).length > 0) {
                            config.env = selectedServer.env;
                          } else {
                            config.env = {};
                          }

                          return JSON.stringify(config, null, 2);
                        })()}</code>
                      </pre>
                    </div>
                  </div>

                  {/* Contact Section */}
                  {selectedServer.contact && (
                    <div className="detail-section">
                      <h3 className="section-title">Contact</h3>
                      <div className="section-content">
                        <a href={`mailto:${selectedServer.contact}`} className="lib-contact-link">
                          {selectedServer.contact}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Description Section */}
                  <div className="detail-section">
                    <h3 className="section-title">Description</h3>
                    <div className="section-content">
                      <div className="server-description-text">
                        {selectedServer.description ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedServer.description}
                          </ReactMarkdown>
                        ) : (
                          <p>No description available</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Version Section */}
                  {selectedServer.version && (
                    <div className="detail-section">
                      <h3 className="section-title">Version</h3>
                      <div className="section-content">
                        <p className="lib-version-text">
                          <strong>Current Version:</strong> {selectedServer.version}
                          {(() => {
                            const installedVersion = getInstalledServerVersion(selectedServer.name)
                            if (installedVersion) {
                              return (
                                <>
                                  <br />
                                  <strong>Installed Version:</strong> {installedVersion}
                                </>
                              )
                            }
                            return null
                          })()}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="no-selection">
                <span>Select a server from the list to view details</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="library-empty">
          <div className="empty-icon">📦</div>
          <div className="empty-message">No servers available in the library</div>
        </div>
      )}

      {/* Confirm Dialog for ON-DEVICE Overwrite */}
      <Dialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Replace Existing MCP Server</DialogTitle>
            <DialogDescription className="text-left">
              An MCP server with the same name already exists on your device. This action will replace it and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-left">
            <p className="text-sm text-gray-700">
              Server name: <strong>{selectedServer?.name}</strong>
            </p>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 sm:flex-row sm:space-x-0">
            <button
              className="btn-secondary px-4 py-2 text-sm"
              onClick={() => setShowOverwriteDialog(false)}
            >
              No
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={async () => {
                setShowOverwriteDialog(false)
                // Continue with installation, passing true to overwrite
                await proceedWithInstallation(true)
              }}
            >
              Continue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog for Missing Requirements */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Missing Requirements</DialogTitle>
            <DialogDescription className="text-left">
              The MCP server may not work correctly until all requirements are met.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-left">
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              {confirmDialogContent.missingList.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 sm:flex-row sm:space-x-0">
            <button
              className="btn-secondary px-4 py-2 text-sm"
              onClick={() => setShowConfirmDialog(false)}
            >
              No
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={async () => {
                setShowConfirmDialog(false)
                // Decide which prompt URL to use based on isUpdateMode
                // isUpdateMode=true → Update or overwriting ON-DEVICE → selectedServer.prompts.update_mcp
                // isUpdateMode=false → fresh install → selectedServer.prompts.setup_mcp
                await handleKobiFixAndInstall(isUpdateMode)
              }}
            >
              Let Kobi Fix & Install
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Input Modal for USER_INPUT placeholders */}
      <UserInputModal
        isOpen={showUserInputModal}
        onClose={() => {
          setShowUserInputModal(false)
          setPendingServerConfig(null)
          setUserInputFields([])
          setPendingOverwriteMode(false)
          setIsAdding(false)
        }}
        fields={userInputFields}
        serverName={selectedServer?.name || ''}
        contact={selectedServer?.contact}
        onSubmit={handleUserInputSubmit}
        onSkip={handleUserInputSkip}
      />
      <ApplyMcpToAgentsDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        mcpServerNames={[applyMcpServerName]}
      />
    </div>
  )
}

export default AddFromMcpLibraryViewContent