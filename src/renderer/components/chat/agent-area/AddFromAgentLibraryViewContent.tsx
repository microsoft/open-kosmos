/**
 * AddFromAgentLibraryViewContent Component
 * Contains all the functionality for the Agent Library view:
 * - Left panel: Agent list
 * - Right panel: Agent detail with requirements check and install button
 *
 * Requirements check includes:
 * - Software: Same as MCP requirements check
 * - MCP: Check if user has added MCP server with same name
 * - Skills: Check if user has added skill with same name
 *
 * ============================================================================
 * INSTALL/UPDATE BUTTON LOGIC DESIGN
 * ============================================================================
 *
 * ## Button state display logic (when opening the detail page)
 *
 * 1. "Checking": requirements status is being checked
 * 2. Check installation status: name matches AND source === "IN-LIBRARY"
 *    - If installed and library version <= local version: show "Installed" (button disabled)
 *    - If installed but library version > local version: show "Update"
 *    - If not installed: show "Install"
 *
 * ## Click Install flow
 *
 * 1. IF an ON-DEVICE version with the same name is installed → ask user whether to overwrite (showOverwriteDialog)
 *    - No → exit installation
 *    - Continue → proceed to step 2
 *
 * 2. IF requirements are not fully satisfied → ask user whether to let Kobi help fix (showConfirmDialog)
 *    - No → exit installation
 *    - Continue → send prompt to Kobi to start installation
 *
 * 3. ELSE (requirements fully satisfied):
 *    - IF overwrite mode: inherit workspace value from local version
 *    - Process OpenKosmos placeholders and USER-INPUT placeholders
 *    - Directly add agent
 *
 * ## Click Update flow
 *
 * 1. IF requirements are not fully satisfied → ask user whether to let Kobi help fix (showConfirmDialog)
 *    - No → exit installation
 *    - Continue → send prompt to Kobi to start installation
 *
 * 2. ELSE (requirements fully satisfied):
 *    - Inherit workspace value from local version
 *    - Directly overwrite and update agent
 *
 * ## AGENT OVERWRITE RULES
 *
 * | Source version       | Target version       | Allow overwrite |
 * |---------------------|---------------------|-----------------|
 * | IN-LIBRARY smaller  | IN-LIBRARY larger   | ❌ Not allowed  |
 * | IN-LIBRARY same     | IN-LIBRARY same     | ❌ Not allowed  |
 * | IN-LIBRARY larger   | IN-LIBRARY smaller  | ✅ Allowed (Update) |
 * | IN-LIBRARY any      | ON-DEVICE any       | ✅ Allowed (Install with overwrite) |
 *
 * ============================================================================
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../../styles/Modal.css'
import '../../../styles/McpLibraryView.css'
import { useToast } from '../../ui/ToastProvider'
import { useMCPServers, useSkills, useProfileData } from '../../userData/userDataProvider'
import { profileDataManager } from '../../../lib/userData/profileDataManager'
import { Message } from '@shared/types/chatTypes'
import { chatOps } from '../../../lib/chat/chatOps'
import UserInputModal from '../../mcp/UserInputModal'
import { appendCacheBustingTimestamp } from '../../../lib/utils/urlUtils'
import { getCdnBaseUrl, isCdnConfigured } from '@shared/utils/cdn'
import { sendUserMessageOptimistically } from '../../../lib/chat/sendUserMessageOptimistically'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog'
import {
  parseUserInputPlaceholders,
  applyUserInputsToEnv,
  UserInputField
} from '../../../lib/utilities/processUserInputPlaceholder'
import {
  hasOpenKosmosPlaceholdersInObject,
  replaceOpenKosmosPlaceholders
} from '../../../lib/utilities/kosmosPlaceholderParser'
import { McpOps } from '../../../lib/mcp/mcpOps'
import { startNewChatFor } from '../../../lib/chat/startNewChatFor'
import { createLogger } from '../../../lib/utilities/logger';
import { agentChatSessionCacheManager } from "../../../lib/chat/agentChatSessionCacheManager";
import { agentChatIpc } from "../../../lib/chat/agentChatIpc";
const logger = createLogger('[AddFromAgentLibraryViewContent]');

// Agent Library Item interface based on agent_lib.json structure
interface AgentLibraryItem {
  name: string
  version: string
  source?: 'IN-LIBRARY' | 'ON-DEVICE'
  description: string
  contact?: string
  requirements?: {
    software?: Record<string, string>
    mcp?: string[]
    skills?: string[]
  }
  configuration?: {
    emoji?: string
    avatar?: string
    name?: string
    workspace?: string
    knowledgeBase?: string
    model?: string
    mcp_servers?: Array<{
      name: string
      tools?: string[]
    }>
    system_prompt?: string
    context_enhancement?: {
      search_memory?: {
        enabled: boolean
        semantic_similarity_threshold?: number
        semantic_top_n?: number
      }
      generate_memory?: {
        enabled: boolean
      }
    }
    skills?: string[]
    zero_states?: {
      greeting?: string
      quick_starts?: Array<{
        title: string
        image?: string
        description: string
        prompt: string
      }>
    }
  }
  prompts?: {
    setup_agent?: string
    update_agent?: string
    setup_requirements?: string
  }
}

interface AgentLibraryData {
  agents: AgentLibraryItem[]
}

// Requirement check result interface
interface RequirementCheckResult {
  name: string
  type: 'software' | 'mcp' | 'skill'
  requiredVersion?: string
  isInstalled: boolean
  installedVersion?: string
  satisfiesRequirement: boolean
  details: string
  isChecking?: boolean
}

interface AddFromAgentLibraryViewContentProps {
  onAgentAdded?: (count: number) => void
}

const getAgentLibraryUrl = () => {
  const baseCdnUrl = getCdnBaseUrl();
  return baseCdnUrl ? `${baseCdnUrl}/agent/agent_lib.json` : '';
};

const AGENT_LIBRARY_URL = getAgentLibraryUrl();

const AddFromAgentLibraryViewContent: React.FC<AddFromAgentLibraryViewContentProps> = ({
  onAgentAdded
}) => {
  const { showError, showSuccess } = useToast()
  const { servers: existingMcpServers } = useMCPServers()
  const { skills: existingSkills } = useSkills()
  const { chats: existingChats } = useProfileData()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [libraryData, setLibraryData] = useState<AgentLibraryData | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AgentLibraryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isFixingRequirements, setIsFixingRequirements] = useState(false)
  const [requirementResults, setRequirementResults] = useState<RequirementCheckResult[]>([])

  // User input modal state for USER_INPUT placeholders
  const [showUserInputModal, setShowUserInputModal] = useState(false)
  const [userInputFields, setUserInputFields] = useState<UserInputField[]>([])
  const [pendingAgentConfig, setPendingAgentConfig] = useState<any>(null)

  // Confirm dialog state for missing requirements
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmDialogContent, setConfirmDialogContent] = useState<{ missingList: string[] }>({
    missingList: [],
  })

  // Confirm dialog state for ON-DEVICE overwrite
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false)

  // Flag to track if this is an update operation (will overwrite existing IN-LIBRARY agent)
  const [isUpdateMode, setIsUpdateMode] = useState(false)

  // Store the existing chat ID when updating (to preserve ID during overwrite)
  const [pendingUpdateChatId, setPendingUpdateChatId] = useState<string | null>(null)

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

  // Version comparison function (supports ^, ~, and exact version matching)
  const compareVersions = (installed: string, required: string): boolean => {
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

    if (required.startsWith('^')) {
      // Caret range: ^1.57.0 means >= 1.57.0 < 2.0.0
      if (iMajor !== rMajor) return false
      else if (iMajor === rMajor && iMinor > rMinor) return true
      else if (iMajor === rMajor && iMinor === rMinor && iPatch >= rPatch) return true
      else return false
    } else if (required.startsWith('~')) {
      // Tilde range: ~1.57.0 means >= 1.57.0 < 1.58.0
      if (iMajor !== rMajor) return false
      else if (iMinor !== rMinor) return false
      else return iPatch >= rPatch
    } else {
      // Exact version match
      return iMajor === rMajor && iMinor === rMinor && iPatch === rPatch
    }
  }

  // Check a single software requirement
  const checkSoftwareRequirement = useCallback(async (packageName: string, requiredVersion: string): Promise<RequirementCheckResult> => {
    let isInstalled = false
    let installedVersion = ''
    let satisfiesRequirement = false
    let details = 'Not installed'

    try {
      const command = `${packageName} --version`

      const result = await window.electronAPI.builtinTools.execute('execute_command', {
        description: `Check ${packageName} version for agent requirements`,
        command: command,
        cwd: '.'
      })

      if (result.success && result.data) {
        let parsedData;
        if (typeof result.data === 'string') {
          try {
            parsedData = JSON.parse(result.data);
          } catch {
            parsedData = { stdout: '', stderr: '', exitCode: 1 };
          }
        } else {
          parsedData = result.data;
        }

        const output = (parsedData.stdout || parsedData.stderr || '').trim()

        if (parsedData.exitCode === 0 && output) {
          const extractedVersion = extractVersionFromOutput(output, packageName)

          if (extractedVersion) {
            isInstalled = true
            installedVersion = extractedVersion
            details = `Installed version: ${installedVersion}`
            satisfiesRequirement = compareVersions(installedVersion, requiredVersion)
          } else if (output.trim()) {
            isInstalled = true
            installedVersion = 'unknown'
            details = `Installed (version unknown)`
            satisfiesRequirement = false
          }
        }
      }
    } catch (err) {
      logger.warn(`[Dependencies] Failed to check ${packageName} version:`, err)
    }

    return {
      name: packageName,
      type: 'software',
      requiredVersion,
      isInstalled,
      installedVersion,
      satisfiesRequirement,
      details
    }
  }, [extractVersionFromOutput])

  // Check MCP requirement - must be installed AND connected
  const checkMcpRequirement = useCallback((mcpName: string): RequirementCheckResult => {
    const server = existingMcpServers.find(s => s.name === mcpName)
    const isInstalled = !!server
    const isConnected = server?.status === 'connected'
    const satisfiesRequirement = isInstalled && isConnected

    let details = 'Not installed'
    if (isInstalled && isConnected) {
      details = 'Connected'
    } else if (isInstalled) {
      details = `Installed but ${server?.status || 'disconnected'}`
    }

    return {
      name: mcpName,
      type: 'mcp',
      isInstalled,
      satisfiesRequirement,
      details
    }
  }, [existingMcpServers])

  // Check Skill requirement
  const checkSkillRequirement = useCallback((skillName: string): RequirementCheckResult => {
    const isInstalled = existingSkills.some(s => s.name === skillName)

    return {
      name: skillName,
      type: 'skill',
      isInstalled,
      satisfiesRequirement: isInstalled,
      details: isInstalled ? 'Installed' : 'Not installed'
    }
  }, [existingSkills])

  // Initialize requirements with loading state
  const initializeRequirements = useCallback((agent: AgentLibraryItem): RequirementCheckResult[] => {
    const results: RequirementCheckResult[] = []

    if (agent.requirements?.software) {
      Object.entries(agent.requirements.software).forEach(([name, version]) => {
        results.push({
          name,
          type: 'software',
          requiredVersion: version as string,
          isInstalled: false,
          satisfiesRequirement: false,
          details: 'Checking...',
          isChecking: true
        })
      })
    }

    if (agent.requirements?.mcp) {
      agent.requirements.mcp.forEach(mcpName => {
        results.push({
          name: mcpName,
          type: 'mcp',
          isInstalled: false,
          satisfiesRequirement: false,
          details: 'Checking...',
          isChecking: true
        })
      })
    }

    if (agent.requirements?.skills) {
      agent.requirements.skills.forEach(skillName => {
        results.push({
          name: skillName,
          type: 'skill',
          isInstalled: false,
          satisfiesRequirement: false,
          details: 'Checking...',
          isChecking: true
        })
      })
    }

    return results
  }, [])

  // Start checking all requirements asynchronously
  const startRequirementsCheck = useCallback((agent: AgentLibraryItem) => {
    // Initialize all requirements with loading state
    const initialResults = initializeRequirements(agent)
    setRequirementResults(initialResults)

    // Check software requirements asynchronously
    if (agent.requirements?.software) {
      Object.entries(agent.requirements.software).forEach(([name, version]) => {
        checkSoftwareRequirement(name, version as string).then(result => {
          setRequirementResults(prev =>
            prev.map(req =>
              req.name === name && req.type === 'software'
                ? { ...result, isChecking: false }
                : req
            )
          )
        })
      })
    }

    // Check MCP requirements immediately (no async needed)
    if (agent.requirements?.mcp) {
      agent.requirements.mcp.forEach(mcpName => {
        const result = checkMcpRequirement(mcpName)
        setRequirementResults(prev =>
          prev.map(req =>
            req.name === mcpName && req.type === 'mcp'
              ? { ...result, isChecking: false }
              : req
          )
        )
      })
    }

    // Check Skill requirements immediately (no async needed)
    if (agent.requirements?.skills) {
      agent.requirements.skills.forEach(skillName => {
        const result = checkSkillRequirement(skillName)
        setRequirementResults(prev =>
          prev.map(req =>
            req.name === skillName && req.type === 'skill'
              ? { ...result, isChecking: false }
              : req
          )
        )
      })
    }
  }, [initializeRequirements, checkSoftwareRequirement, checkMcpRequirement, checkSkillRequirement])

  // Use ref to hold the latest startRequirementsCheck without causing useEffect re-fires.
  // This breaks the dependency chain: existingMcpServers/existingSkills change → checkMcpRequirement/checkSkillRequirement
  // re-created → startRequirementsCheck re-created → useEffect would fire (full re-check). With ref, the useEffect
  // only fires when selectedAgent actually changes. MCP/Skill real-time refresh is handled by the reactive useEffect below.
  const startRequirementsCheckRef = useRef(startRequirementsCheck)
  startRequirementsCheckRef.current = startRequirementsCheck

  // Check requirements when selected agent changes (NOT when check functions change)
  useEffect(() => {
    if (selectedAgent && selectedAgent.requirements) {
      const hasAnyRequirements =
        (selectedAgent.requirements.software && Object.keys(selectedAgent.requirements.software).length > 0) ||
        (selectedAgent.requirements.mcp && selectedAgent.requirements.mcp.length > 0) ||
        (selectedAgent.requirements.skills && selectedAgent.requirements.skills.length > 0)

      if (hasAnyRequirements) {
        startRequirementsCheckRef.current(selectedAgent)
      } else {
        setRequirementResults([])
      }
    } else {
      setRequirementResults([])
    }
  }, [selectedAgent])

  // Reactively update MCP and Skill requirement statuses when existing servers or skills change.
  // This enables real-time refresh in the requirements table after MCP/Skill installation.
  useEffect(() => {
    if (!selectedAgent) return

    setRequirementResults(prev => {
      if (prev.length === 0) return prev

      let changed = false
      const updated = prev.map(req => {
        if (req.type === 'mcp') {
          const result = checkMcpRequirement(req.name)
          if (result.satisfiesRequirement !== req.satisfiesRequirement ||
              result.details !== req.details ||
              result.isInstalled !== req.isInstalled) {
            changed = true
            return { ...result, isChecking: false }
          }
        }
        if (req.type === 'skill') {
          const result = checkSkillRequirement(req.name)
          if (result.satisfiesRequirement !== req.satisfiesRequirement ||
              result.details !== req.details ||
              result.isInstalled !== req.isInstalled) {
            changed = true
            return { ...result, isChecking: false }
          }
        }
        return req
      })
      return changed ? updated : prev
    })
  }, [existingMcpServers, existingSkills, selectedAgent, checkMcpRequirement, checkSkillRequirement])

  // Load library data on component mount
  useEffect(() => {
    loadLibraryData()
  }, [])

  const loadLibraryData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // CDN is optional; without it the Agent Library has no remote catalog.
      // Degrade silently to an empty state rather than surfacing an error, since
      // the entry point itself is hidden when no CDN is configured.
      if (!isCdnConfigured() || !AGENT_LIBRARY_URL) {
        logger.debug('[AddFromAgentLibraryViewContent] CDN not configured; Agent Library unavailable')
        setLibraryData({ agents: [] } as AgentLibraryData)
        return
      }

      logger.debug('[AddFromAgentLibraryViewContent] Loading library data from CDN...')

      // Fetch from remote CDN with cache disabled to always get latest version
      // Add timestamp parameter to bypass CDN cache
      const urlWithTimestamp = appendCacheBustingTimestamp(AGENT_LIBRARY_URL);
      const response = await fetch(urlWithTimestamp, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch agent library: ${response.status} ${response.statusText}`)
      }

      const data: AgentLibraryData = await response.json()

      if (!data.agents || !Array.isArray(data.agents)) {
        throw new Error('Invalid data format: agents array not found')
      }

      logger.debug(`[AddFromAgentLibraryViewContent] Successfully loaded ${data.agents.length} agents`)

      setLibraryData(data)

      // Check if there's a selectAgent parameter in URL (used when navigating from Update button)
      const selectAgentParam = searchParams.get('selectAgent')

      if (selectAgentParam && data.agents.length > 0) {
        // Try to find and select the agent by name
        const agentToSelect = data.agents.find(agent => agent.name === selectAgentParam)
        if (agentToSelect) {
          logger.debug(`[AddFromAgentLibraryViewContent] Auto-selecting agent from URL param: ${selectAgentParam}`)
          setSelectedAgent(agentToSelect)
        } else {
          // Agent not found, fall back to first agent
          logger.debug(`[AddFromAgentLibraryViewContent] Agent "${selectAgentParam}" not found in library, selecting first agent`)
          setSelectedAgent(data.agents[0])
        }
      } else if (data.agents.length > 0) {
        // No URL param, auto-select first agent if available
        setSelectedAgent(data.agents[0])
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      logger.error('[AddFromAgentLibraryViewContent] Failed to load library data:', err)
      setError(errorMessage)
      showError(`Failed to load Agent library: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [showError, searchParams])

  // Execute the actual agent config addition (or update if updateChatId is provided)
  const executeAgentAdd = useCallback(async (chatConfig: any, updateChatId?: string | null) => {
    try {
      let result

      // Use provided updateChatId or fall back to state (for modal callbacks)
      const chatIdToUpdate = updateChatId ?? pendingUpdateChatId

      if (chatIdToUpdate) {
        // Update mode: use updateChatConfig to preserve the existing chat ID
        logger.debug('[AddFromAgentLibraryViewContent] Updating existing agent:', chatIdToUpdate)
        result = await chatOps.updateChatConfig(chatIdToUpdate, chatConfig)

        if (result.success) {
          showSuccess(`Agent "${selectedAgent?.name}" updated successfully!`)
          onAgentAdded?.(1)
          // Navigate to the updated agent chat page
          navigate(`/agent/chat/${chatIdToUpdate}`)
        } else {
          showError(`Failed to update agent: ${result.error || 'Unknown error'}`)
        }
      } else {
        // New install mode: Check for duplicate name first
        const duplicateAgent = existingChats.find(chat => chat.agent?.name === chatConfig.agent?.name)
        if (duplicateAgent) {
          showError(`Agent with name "${chatConfig.agent?.name}" already exists. Please use Update instead.`)
          return
        }

        // Add new agent
        result = await chatOps.addChatConfig(chatConfig)

        if (result.success) {
          showSuccess(`Agent "${selectedAgent?.name}" installed successfully!`)
          onAgentAdded?.(1)
          // Navigate to the newly installed agent chat page
          const newChatId = result.data?.chat_id
          if (newChatId) {
            navigate(`/agent/chat/${newChatId}`, {
              state: {
                intent: 'new-chat',
                source: 'agent-library-install',
              },
            })
          } else {
            showError('Agent installed but failed to get chat ID')
          }
        } else {
          showError(`Failed to install agent: ${result.error || 'Unknown error'}`)
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to install agent: ${errorMessage}`)
    } finally {
      // Reset pendingUpdateChatId after operation
      setPendingUpdateChatId(null)
    }
  }, [selectedAgent, showSuccess, showError, onAgentAdded, navigate, pendingUpdateChatId, existingChats])

  // Handle user input submission from modal
  const handleUserInputSubmit = useCallback(async (userInputs: Record<string, any>) => {
    if (!pendingAgentConfig) {
      showError('No pending agent configuration found')
      return
    }

    try {
      // Apply user inputs to the workspace field (if it contains USER_INPUT placeholder)
      // 🔧 Fix: workspace is now at the agent level
      const currentWorkspace = pendingAgentConfig.agent?.workspace || ''
      const updatedWorkspace = applyUserInputsToEnv(
        { workspace: currentWorkspace },
        userInputs,
        userInputFields
      )

      const finalConfig = {
        ...pendingAgentConfig,
        agent: {
          ...pendingAgentConfig.agent,
          workspace: updatedWorkspace.workspace || ''
        }
      }

      // Execute the actual agent add
      await executeAgentAdd(finalConfig)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to apply user inputs: ${errorMessage}`)
    } finally {
      // Clean up state
      setShowUserInputModal(false)
      setPendingAgentConfig(null)
      setUserInputFields([])
      setIsInstalling(false)
    }
  }, [pendingAgentConfig, userInputFields, showError, executeAgentAdd])

  // Handle user input skip
  const handleUserInputSkip = useCallback(async () => {
    if (!pendingAgentConfig) {
      showError('No pending agent configuration found')
      return
    }

    try {
      // Apply empty inputs (will remove optional fields)
      // 🔧 Fix: workspace is now at the agent level
      const currentWorkspace = pendingAgentConfig.agent?.workspace || ''
      const cleanedWorkspace = applyUserInputsToEnv(
        { workspace: currentWorkspace },
        {},
        userInputFields
      )

      const finalConfig = {
        ...pendingAgentConfig,
        agent: {
          ...pendingAgentConfig.agent,
          workspace: cleanedWorkspace.workspace || ''
        }
      }

      // Execute the actual agent add
      await executeAgentAdd(finalConfig)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to add agent: ${errorMessage}`)
    } finally {
      // Clean up state
      setShowUserInputModal(false)
      setPendingAgentConfig(null)
      setUserInputFields([])
      setIsInstalling(false)
    }
  }, [pendingAgentConfig, userInputFields, showError, executeAgentAdd])

  /**
   * Actually perform the agent config add/update
   *
   * @param overwrite - whether this is overwrite mode
   *   - true: Update operation or overwriting an ON-DEVICE version; inherits local workspace
   *   - false: fresh install; processes placeholders and adds directly
   *
   * Flow:
   * 1. In overwrite mode, inherit workspace from the local same-name agent (preserve the user's current working directory)
   * 2. Process OpenKosmos placeholders (auto-replace system paths)
   * 3. Check for USER_INPUT placeholders
   *    - Present: show user input modal
   *    - Absent: directly add/update agent
   *
   * workspace inheritance rules:
   * - Updating IN-LIBRARY version: inherit workspace from local IN-LIBRARY version
   * - Installing to overwrite ON-DEVICE version: inherit workspace from local ON-DEVICE version
   * - Fresh Install: use workspace from library config (after placeholder processing)
   */
  const addAgentConfig = useCallback(async (overwrite: boolean = false) => {
    if (!selectedAgent || !selectedAgent.configuration) {
      showError('Agent configuration not found')
      return
    }

    setIsInstalling(true)

    try {
      logger.debug('[AddFromAgentLibraryViewContent] Adding agent config:', selectedAgent.name, 'overwrite:', overwrite)

      // Determine the chat ID to update (if overwrite mode)
      let updateChatId: string | null = null
      if (overwrite) {
        const existingChat = existingChats.find(chat => chat.agent?.name === selectedAgent.name)
        if (existingChat) {
          logger.debug('[AddFromAgentLibraryViewContent] Will update existing agent, preserving ID:', existingChat.chat_id)
          updateChatId = existingChat.chat_id
          // Also set state for modal callbacks
          setPendingUpdateChatId(existingChat.chat_id)
        }
      } else {
        // New install mode, clear any pending update ID
        setPendingUpdateChatId(null)
      }

      // Step 1: Prepare workspace - default to workspace in library config
      let workspace = selectedAgent.configuration.workspace || ''

      /**
       * Step 1.0: Inherit local workspace in overwrite mode
       *
       * Design requirement: "assign the workspace value of the locally installed same-name agent to the new version config"
       *
       * Applicable scenarios:
       * - Updating IN-LIBRARY version: preserve the user's current working directory
       * - Installing to overwrite ON-DEVICE version: preserve the user's originally configured working directory
       *
       * This ensures users do not lose their configured workspace path when updating an agent
       */
      if (overwrite) {
        const existingChat = existingChats.find(chat => chat.agent?.name === selectedAgent.name)
        if (existingChat?.agent?.workspace) {
          logger.debug('[AddFromAgentLibraryViewContent] Inheriting workspace from existing agent:', existingChat.agent.workspace)
          workspace = existingChat.agent.workspace
        }
      }

      // Step 1.1: Process OpenKosmos placeholders (auto-replace, no user input needed)
      if (workspace && hasOpenKosmosPlaceholdersInObject({ workspace })) {
        logger.debug('[AddFromAgentLibraryViewContent] Found OpenKosmos placeholders in workspace, replacing...')
        const replaced = await replaceOpenKosmosPlaceholders({ workspace })
        workspace = replaced.workspace || ''
      }

      // Build agent configuration from library item
      // 🆕 IN-LIBRARY update mode: mcp_servers and skills need to be merged, preserving local user selections
      let finalMcpServers = selectedAgent.configuration.mcp_servers || []
      let finalSkills = selectedAgent.configuration.skills || []

      if (overwrite) {
        const existingChat = existingChats.find(chat => chat.agent?.name === selectedAgent.name)
        if (existingChat?.agent) {
          // Merge mcp_servers: preserve local tools selections, add new remote servers
          // Tools merge: [] = all tools selected; either side [] → []; otherwise union
          const localServers = existingChat.agent.mcp_servers || []
          const remoteServers = selectedAgent.configuration.mcp_servers || []
          const mergedServerMap = new Map<string, { name: string; tools: string[] }>()
          for (const remote of remoteServers) {
            mergedServerMap.set(remote.name, { name: remote.name, tools: Array.isArray(remote.tools) ? remote.tools : [] })
          }
          for (const local of localServers) {
            const remoteEntry = mergedServerMap.get(local.name)
            if (remoteEntry) {
              // Same-name server: merge tools arrays
              const localTools = Array.isArray(local.tools) ? local.tools : []
              const remoteTools = remoteEntry.tools
              let mergedTools: string[]
              if (localTools.length === 0 || remoteTools.length === 0) {
                // [] = all tools selected — if either side is all, keep all
                mergedTools = []
              } else {
                // Both have specific selections: union
                const toolSet = new Set<string>(localTools)
                for (const t of remoteTools) { toolSet.add(t) }
                mergedTools = Array.from(toolSet)
              }
              mergedServerMap.set(local.name, { name: local.name, tools: mergedTools })
            } else {
              // Server only in local, keep it
              mergedServerMap.set(local.name, { name: local.name, tools: Array.isArray(local.tools) ? local.tools : [] })
            }
          }
          finalMcpServers = Array.from(mergedServerMap.values())

          // Merge skills: union of local and remote
          const localSkills = existingChat.agent.skills || []
          const remoteSkillsList = selectedAgent.configuration.skills || []
          const mergedSkillsSet = new Set<string>(remoteSkillsList)
          for (const skill of localSkills) {
            mergedSkillsSet.add(skill)
          }
          finalSkills = Array.from(mergedSkillsSet)
        }
      }

      // ============================================
      // Local-priority fields: model, knowledgeBase, context_enhancement
      // In update mode, use local values; fall back to remote only if local does not exist
      // ============================================
      const existingAgentForMerge = overwrite
        ? existingChats.find(chat => chat.agent?.name === selectedAgent.name)?.agent
        : null

      // model: local priority
      let finalModel = selectedAgent.configuration.model || 'gpt-4.1'
      if (existingAgentForMerge?.model) {
        finalModel = existingAgentForMerge.model
      }

      // knowledgeBase: local priority (preserve local knowledgeBase in update mode)
      let finalKnowledgeBase = selectedAgent.configuration.knowledgeBase || ''
      if (existingAgentForMerge?.knowledge?.knowledgeBase) {
        finalKnowledgeBase = existingAgentForMerge.knowledge.knowledgeBase
      }

      // context_enhancement: local priority (keep local if present, otherwise use remote)
      const defaultContextEnhancement = {
        search_memory: { enabled: false },
        generate_memory: { enabled: false }
      }
      let finalContextEnhancement = selectedAgent.configuration.context_enhancement || defaultContextEnhancement
      if (existingAgentForMerge?.context_enhancement) {
        finalContextEnhancement = existingAgentForMerge.context_enhancement
      }

      // ============================================
      // Remote-priority fields: emoji, avatar, name, system_prompt
      // ============================================
      // emoji: remote priority; if remote is empty, fall back to local → default 🤖
      const finalEmoji = selectedAgent.configuration.emoji
        || existingAgentForMerge?.emoji
        || '🤖'
      // avatar: remote priority; if remote is empty, fall back to local
      const finalAvatar = selectedAgent.configuration.avatar
        || existingAgentForMerge?.avatar
        || ''
      // name: remote priority
      const finalName = selectedAgent.configuration.name || selectedAgent.name
      // system_prompt: always use remote (clear if remote has none)
      const finalSystemPrompt = selectedAgent.configuration.system_prompt || ''

      const agentConfig = {
        emoji: finalEmoji,
        avatar: finalAvatar,
        name: finalName,
        model: finalModel,
        // 🆕 Adding from Library: use library version and source, default to IN-LIBRARY
        version: selectedAgent.version || '1.0.0',
        source: selectedAgent.source || 'IN-LIBRARY' as const,
        // 🆕 IN-LIBRARY agent: set remoteVersion to the remote version number
        remoteVersion: selectedAgent.version || '1.0.0',
        // local priority
        workspace: workspace,
        knowledgeBase: finalKnowledgeBase,
        system_prompt: finalSystemPrompt,
        mcp_servers: finalMcpServers,
        skills: finalSkills,
        context_enhancement: finalContextEnhancement,
        // 🆕 Add zero_states field
        zero_states: selectedAgent.configuration.zero_states || undefined
      }

      const chatConfig = {
        chat_type: 'single_agent' as const,
        agent: agentConfig
      }

      // Step 1.2: Check for USER_INPUT placeholders in workspace
      const parseResult = await parseUserInputPlaceholders({ workspace })

      if (parseResult.hasUserInputFields) {
        // Need user input, save parsed results and show modal
        logger.debug('[AddFromAgentLibraryViewContent] Found USER_INPUT placeholders, showing modal...')
        setUserInputFields(parseResult.fields)
        setPendingAgentConfig(chatConfig)
        setShowUserInputModal(true)
        return // Wait for user input
      }

      // Step 2: No user input needed, directly add agent (pass updateChatId directly)
      await executeAgentAdd(chatConfig, updateChatId)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to install agent: ${errorMessage}`)
    } finally {
      if (!showUserInputModal) {
        setIsInstalling(false)
      }
    }
  }, [selectedAgent, showError, executeAgentAdd, showUserInputModal, existingChats])

  /**
   * Let Kobi help fix requirements and install/update the agent
   *
   * Uses the URL from the agent config's prompts field, depending on operation type:
   * - Fresh install (Install): prompts.setup_agent
   * - Update or overwriting ON-DEVICE version: prompts.update_agent
   *
   * isUpdateMode state is true in the following cases:
   * - Clicking Update button (IN-LIBRARY larger version overwrites smaller version)
   * - Clicking Install but confirming overwrite of ON-DEVICE version
   */
  const handleKobiFixAndInstall = useCallback(async () => {
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

      // 3.3. Send user message to CurrentChatSessionId following the two-step process
      // Choose different prompt based on operation type:
      // - isUpdateMode: Update or overwriting ON-DEVICE → use update prompt (prompts.update_agent)
      // - Otherwise: fresh install → use setup prompt (prompts.setup_agent)
      const promptUrl = isUpdateMode
        ? selectedAgent?.prompts?.update_agent
        : selectedAgent?.prompts?.setup_agent

      if (!promptUrl) {
        showError(`No ${isUpdateMode ? 'update_agent' : 'setup_agent'} prompt URL configured for this agent`)
        return
      }

      logger.debug(`[Install with Kobi] Using prompt: ${promptUrl} (isUpdateMode: ${isUpdateMode})`)

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
      logger.error('[AddFromAgentLibraryViewContent] Install with Kobi error:', error)
    }
  }, [showError, navigate, isUpdateMode, selectedAgent])

  /**
   * Check if an agent has already been installed from the library
   * Conditions: name matches AND source === "IN-LIBRARY"
   *
   * Used for button state:
   * - true: show "Installed" (if no update) or "Update" (if update available)
   * - false: show "Install"
   */
  const isAgentAdded = useCallback((agentName: string): boolean => {
    return existingChats.some(chat =>
      chat.agent?.name === agentName && chat.agent?.source === 'IN-LIBRARY'
    )
  }, [existingChats])

  /**
   * Check if the library version is newer than the locally installed version
   * Only compares for already-installed IN-LIBRARY agents
   *
   * Used to determine whether to show the "Update" button:
   * - true: library version > local version, show "Update"
   * - false: library version <= local version, show "Installed"
   *
   * Overwrite rules:
   * - IN-LIBRARY larger version can overwrite IN-LIBRARY smaller version ✅
   * - IN-LIBRARY smaller/same version cannot overwrite IN-LIBRARY larger/same version ❌
   */
  const hasNewerVersion = useCallback((agentName: string, libraryVersion: string): boolean => {
    const existingChat = existingChats.find(chat =>
      chat.agent?.name === agentName && chat.agent?.source === 'IN-LIBRARY'
    )
    if (!existingChat?.agent?.version) return false

    // Simple version comparison (assumes semantic versioning like 1.0.0)
    const compareVersions = (v1: string, v2: string): number => {
      const parts1 = v1.split('.').map(Number)
      const parts2 = v2.split('.').map(Number)

      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0
        const num2 = parts2[i] || 0
        if (num1 > num2) return 1
        if (num1 < num2) return -1
      }
      return 0
    }

    return compareVersions(libraryVersion, existingChat.agent.version) > 0
  }, [existingChats])

  // Get installed agent info
  const getInstalledAgentVersion = useCallback((agentName: string): string | null => {
    const existingChat = existingChats.find(chat =>
      chat.agent?.name === agentName && chat.agent?.source === 'IN-LIBRARY'
    )
    return existingChat?.agent?.version || null
  }, [existingChats])

  /**
   * Check if there is an ON-DEVICE version of an agent with the same name
   * ON-DEVICE means a locally created agent (source === "ON-DEVICE" or source is undefined)
   *
   * Used in the Install flow to determine whether to show the overwrite confirmation dialog:
   * - IN-LIBRARY any version can overwrite ON-DEVICE any version ✅
   */
  const hasOnDeviceVersion = useCallback((agentName: string): boolean => {
    return existingChats.some(chat =>
      chat.agent?.name === agentName && (chat.agent?.source === 'ON-DEVICE' || !chat.agent?.source)
    )
  }, [existingChats])

  /**
   * Continue the installation flow (called after ON-DEVICE check, or for Update operations)
   *
   * Flow:
   * 1. Check if requirements are satisfied
   *    - Not satisfied: show dialog asking whether to let Kobi fix
   *    - Satisfied: call addAgentConfig() to perform actual install/update
   *
   * @param isUpdate - true means update operation; will overwrite existing agent and inherit workspace
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
      // All requirements satisfied, directly add agent config
      await addAgentConfig(isUpdate)
    }
  }, [requirementResults, addAgentConfig])

  /**
   * Install/Update button click handler - main entry point
   *
   * Flow:
   * 1. Wait for requirements check to complete
   * 2. Determine operation type (Install or Update)
   * 3. For Install:
   *    - Check if there is an ON-DEVICE version that needs to be overwritten
   *    - Show confirmation dialog if so
   * 4. For Update or conflict-free Install:
   *    - Call proceedWithInstallation() to continue
   */
  const handleInstallAgent = useCallback(async () => {
    if (!selectedAgent) {
      showError('Please select an agent to install')
      return
    }

    // Check if requirements are still being checked
    if (requirementResults.length > 0 && !areAllRequirementsChecked()) {
      showError('Please wait for requirements check to complete')
      return
    }

    // Determine if this is an install or update operation
    const agentAdded = isAgentAdded(selectedAgent.name)
    const hasUpdate = agentAdded && hasNewerVersion(selectedAgent.name, selectedAgent.version)
    const isUpdate = hasUpdate

    // For INSTALL operation: Check if ON-DEVICE version exists
    if (!isUpdate && !agentAdded) {
      const hasOnDevice = hasOnDeviceVersion(selectedAgent.name)
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
  }, [selectedAgent, requirementResults, areAllRequirementsChecked, isAgentAdded, hasNewerVersion, hasOnDeviceVersion, showError, proceedWithInstallation])

  // Group requirements by type for display
  const getRequirementsByType = useCallback((type: 'software' | 'mcp' | 'skill'): RequirementCheckResult[] => {
    return requirementResults.filter(req => req.type === type)
  }, [requirementResults])

  /**
   * Check if all software requirements are satisfied
   * Used to determine fix strategy:
   * - Software unsatisfied → use AI (Kobi) fix
   * - Only MCP/Skill unsatisfied → install directly from library
   */
  const areSoftwareRequirementsSatisfied = useCallback((): boolean => {
    const softwareReqs = requirementResults.filter(req => req.type === 'software')
    // If no software requirements, they are trivially satisfied
    if (softwareReqs.length === 0) return true
    return softwareReqs.every(req => req.satisfiesRequirement)
  }, [requirementResults])

  /**
   * Fix unsatisfied MCP and Skill requirements with type-specific actions:
   *
   * MCP Server:
   *   - NOT INSTALLED → install from MCP Library
   *   - INSTALLED but connecting → skip (reactive useEffect auto-monitors status change)
   *   - INSTALLED but error → reconnect MCP via McpOps.reconnect
   *
   * Skill:
   *   - NOT INSTALLED → install from Skill Library
   *
   * NOTE: No "apply to agents" step is needed after installation.
   */
  const fixMcpAndSkillRequirements = useCallback(async () => {
    const unsatisfiedMcps = requirementResults.filter(req => req.type === 'mcp' && !req.satisfiesRequirement)
    const unsatisfiedSkills = requirementResults.filter(req => req.type === 'skill' && !req.satisfiesRequirement)

    const totalToFix = unsatisfiedMcps.length + unsatisfiedSkills.length
    if (totalToFix === 0) return

    setIsFixingRequirements(true)
    let fixedCount = 0
    const errors: string[] = []

    try {
      // === Fix MCP server requirements based on their current state ===
      // Separate into categories by status
      const notInstalledMcps = unsatisfiedMcps.filter(req => !req.isInstalled)
      const connectingMcps = unsatisfiedMcps.filter(req => req.isInstalled && req.details.includes('connecting'))
      const errorMcps = unsatisfiedMcps.filter(req => req.isInstalled && (req.details.includes('error') || req.details.includes('disconnected')))

      // --- NOT INSTALLED: Install from MCP Library ---
      if (notInstalledMcps.length > 0) {
        logger.debug(`[Fix Requirements] Installing ${notInstalledMcps.length} missing MCP server(s) from library...`)

        // Fetch MCP library data
        const libraryResult = await window.electronAPI.mcpLibrary.fetchAndUpdate()
        if (!libraryResult.success || !libraryResult.data) {
          throw new Error('Failed to fetch MCP library: ' + (libraryResult.error || 'Unknown error'))
        }

        const mcpServers = libraryResult.data.mcp_servers || []

        for (const mcpReq of notInstalledMcps) {
          const mcpName = mcpReq.name
          logger.debug(`[Fix Requirements] Installing MCP server: ${mcpName}...`)

          const mcpConfig = mcpServers.find((server: any) => server.name === mcpName)
          if (!mcpConfig) {
            logger.warn(`[Fix Requirements] MCP server "${mcpName}" not found in library, skipping...`)
            errors.push(`MCP "${mcpName}" not found in library`)
            continue
          }

          // Process OpenKosmos placeholders in env
          let processedEnv = mcpConfig.env || {}
          if (Object.keys(processedEnv).length > 0) {
            const placeholderResult = await window.electronAPI.kosmos.replacePlaceholders(processedEnv)
            if (placeholderResult.success && placeholderResult.data) {
              processedEnv = placeholderResult.data
            }
          }

          // Process OpenKosmos placeholders in URL field
          let processedUrl = mcpConfig.url || ''
          if (processedUrl) {
            const urlPlaceholderResult = await window.electronAPI.kosmos.replacePlaceholders({ _url: processedUrl })
            if (urlPlaceholderResult.success && urlPlaceholderResult.data) {
              processedUrl = urlPlaceholderResult.data._url || processedUrl
            }
          }

          const configToAdd = {
            name: mcpConfig.name,
            transport: mcpConfig.transport,
            command: mcpConfig.command,
            args: mcpConfig.args || [],
            env: processedEnv,
            url: processedUrl,
            version: mcpConfig.version || '1.0.0',
            source: 'IN-LIBRARY' as const,
            remoteVersion: mcpConfig.version || '1.0.0',
          }

          const result = await window.electronAPI.builtinTools.execute('create_mcp_server_from_config', {
            mcp_config: configToAdd,
          })

          let resultData = result.data
          if (typeof resultData === 'string') {
            try { resultData = JSON.parse(resultData) } catch (e) { /* ignore */ }
          }

          // Check both outer IPC success AND inner tool result success
          const toolSuccess = result.success && (resultData?.success !== false)
          if (!toolSuccess) {
            const errorMsg = resultData?.message || result.error || resultData?.error || ''
            if (errorMsg.includes('already exists')) {
              logger.debug(`[Fix Requirements] MCP server "${mcpName}" already exists, skipping...`)
            } else {
              logger.warn(`[Fix Requirements] Failed to install MCP server "${mcpName}":`, errorMsg)
              errors.push(`MCP "${mcpName}": ${errorMsg}`)
            }
          } else {
            fixedCount++
            logger.debug(`[Fix Requirements] MCP server "${mcpName}" installed successfully`)
          }
        }
      }

      // --- INSTALLED but connecting: Already in progress, skip and let reactive useEffect handle ---
      // Note: We don't poll here because existingMcpServers is a closure-captured value that won't
      // update during async execution. The reactive useEffect on existingMcpServers will automatically
      // update the requirements table when the server status changes to connected/error.
      if (connectingMcps.length > 0) {
        logger.debug(`[Fix Requirements] ${connectingMcps.length} MCP server(s) already connecting, status will update automatically`)
        for (const mcpReq of connectingMcps) {
          logger.debug(`[Fix Requirements] MCP server "${mcpReq.name}" is connecting, skipping (will auto-refresh via reactive monitoring)`)
        }
      }

      // --- INSTALLED but error/disconnected: Reconnect ---
      if (errorMcps.length > 0) {
        logger.debug(`[Fix Requirements] Reconnecting ${errorMcps.length} errored MCP server(s)...`)

        for (const mcpReq of errorMcps) {
          const mcpName = mcpReq.name
          logger.debug(`[Fix Requirements] Reconnecting MCP server: ${mcpName}...`)

          const result = await McpOps.reconnect(mcpName)
          if (result.success) {
            fixedCount++
            logger.debug(`[Fix Requirements] MCP server "${mcpName}" reconnect initiated successfully`)
          } else {
            logger.warn(`[Fix Requirements] Failed to reconnect MCP server "${mcpName}":`, result.error)
            errors.push(`MCP "${mcpName}": reconnect failed - ${result.error || 'Unknown error'}`)
          }
        }
      }

      // === Install missing Skills from Skill Library ===
      if (unsatisfiedSkills.length > 0) {
        logger.debug(`[Fix Requirements] Installing ${unsatisfiedSkills.length} missing Skill(s) from library...`)

        for (const skillReq of unsatisfiedSkills) {
          const skillName = skillReq.name
          logger.debug(`[Fix Requirements] Installing skill: ${skillName}...`)

          const result = await window.electronAPI.skillLibrary.addSkill(skillName)

          if (!result.success) {
            const errorMsg = result.error || result.message || ''
            if (errorMsg.includes('already exists')) {
              logger.debug(`[Fix Requirements] Skill "${skillName}" already exists, skipping...`)
            } else {
              logger.warn(`[Fix Requirements] Failed to install skill "${skillName}":`, errorMsg)
              errors.push(`Skill "${skillName}": ${errorMsg}`)
            }
          } else {
            fixedCount++
            logger.debug(`[Fix Requirements] Skill "${skillName}" installed successfully`)
          }
        }
      }

      // Show results
      if (errors.length > 0) {
        showError(`Some requirements failed to fix: ${errors.join('; ')}`)
      }
      if (fixedCount > 0) {
        showSuccess(`Successfully fixed ${fixedCount} requirement(s)`)
        // Requirements table will auto-refresh via reactive useEffect on existingMcpServers/existingSkills changes
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Fix Requirements failed: ${errorMessage}`)
      logger.error('[AddFromAgentLibraryViewContent] Fix Requirements (direct fix) error:', error)
    } finally {
      setIsFixingRequirements(false)
    }
  }, [requirementResults, showError, showSuccess, selectedAgent])

  // Handle Fix Requirements button click
  /**
   * Fix Requirements button click handler
   *
   * Strategy:
   * - IF software is not fully satisfied → use original Kobi AI fix flow, ask user whether to use AI repair
   * - ELSE (software fully satisfied, only MCP or Skill unsatisfied) → install directly from MCP LIB / SKILL LIB
   *   No "apply to agents" step needed after installation
   */
  const handleFixRequirements = useCallback(async () => {
    // Check if software requirements are all satisfied
    const softwareSatisfied = areSoftwareRequirementsSatisfied()

    if (!softwareSatisfied) {
      // === Software not fully satisfied: use Kobi AI fix flow ===
      logger.debug('[Fix Requirements] Software requirements not satisfied, using Kobi AI fix flow...')
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

        // Wait for navigation to complete before updating cache
        await new Promise(resolve => setTimeout(resolve, 200));

        // 3.3. Send user message to CurrentChatSessionId following the two-step process
        // Use the setup_requirements prompt URL from agent config
        const requirementsPromptUrl = selectedAgent?.prompts?.setup_requirements;
        if (!requirementsPromptUrl) {
          showError('No setup_requirements prompt URL configured for this agent');
          return;
        }

        const userMsg: Message = {
          id: `msg_${Date.now()}`,
          role: 'user',
          content: [{
            type: 'text',
            text: `Follow instructions in ${requirementsPromptUrl} to fix ${selectedAgent?.name || 'Agent'} requirements`
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
        logger.error('[AddFromAgentLibraryViewContent] Fix Requirements error:', error);
      }
    } else {
      // === Software satisfied, only MCP/Skill unsatisfied: install directly from library ===
      logger.debug('[Fix Requirements] Software requirements satisfied, installing missing MCP/Skills directly from library...')
      await fixMcpAndSkillRequirements()
    }
  }, [showError, navigate, selectedAgent, areSoftwareRequirementsSatisfied, fixMcpAndSkillRequirements]);

  // Render requirement row
  const renderRequirementRow = (req: RequirementCheckResult) => (
    <tr key={`${req.type}-${req.name}`} className={`requirement-row ${req.isChecking ? 'checking' : req.satisfiesRequirement ? 'satisfied' : 'missing'}`}>
      <td className="requirement-name">{req.name}</td>
      <td className="requirement-version">{req.requiredVersion || '-'}</td>
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
          <span style={{color: req.satisfiesRequirement ? '#16a34a' : '#dc2626'}}>
            {req.details}
          </span>
        )}
      </td>
    </tr>
  )

  return (
    <div className="add-from-mcp-library-content mcp-library-view">
      {isLoading ? (
        <div className="library-loading">
          <svg className="spinner" width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="18" cy="18" r="16.5" stroke="black" strokeOpacity="0.15" strokeWidth="3"/>
            <path d="M34.5 18C34.5 22.3761 32.7616 26.5729 29.6673 29.6673C26.5729 32.7616 22.3761 34.5 18 34.5" stroke="#272320" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <span>Loading Agent library...</span>
        </div>
      ) : error ? (
        <div className="library-error">
          <div className="error-icon">❌</div>
          <div className="error-message">{error}</div>
          <button className="btn-secondary" onClick={loadLibraryData}>
            Retry
          </button>
        </div>
      ) : libraryData && libraryData.agents.length > 0 ? (
        <div className="library-layout">
          {/* Left: Agent List */}
          <div className="server-list-panel">
            <div className="server-list">
              {libraryData.agents.map((agent) => {
                const agentAdded = isAgentAdded(agent.name)
                const hasUpdate = agentAdded && hasNewerVersion(agent.name, agent.version)

                return (
                  <div
                    key={agent.name}
                    className={`server-card ${selectedAgent?.name === agent.name ? 'selected' : ''} ${agentAdded ? 'added' : ''}`}
                    onClick={() => {
                      setSelectedAgent(agent)
                      setRequirementResults([])
                      setIsFixingRequirements(false)
                      setIsInstalling(false)
                    }}
                  >
                    <div className="server-card-header">
                      <div className="skill-card-info">
                        <div className="skill-card-name-group">
                          <span className="server-card-name">
                            {agent.name}
                            {hasUpdate && (
                              <sup style={{ color: '#ff4444', marginLeft: '4px', fontSize: '0.7em', fontWeight: 'bold' }}>new</sup>
                            )}
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center' }}>
                            {agent.version && (
                              <span className="skill-card-version">v{agent.version}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {agentAdded && !hasUpdate && (
                        <span className="added-badge">Installed</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: Agent Detail */}
          <div className="server-detail-panel">
            {selectedAgent ? (
              <div className="mcp-server-detail-view">
                {/* Agent Header */}
                <div className="server-detail-header">
                  <div className="server-header-info">
                    <div className="server-header-text">
                      <h2 className="server-title">{selectedAgent.name}</h2>
                    </div>
                  </div>

                  {/* Install/Update Button in Header */}
                  <div className="server-header-actions">
                    {(() => {
                      const agentAdded = isAgentAdded(selectedAgent.name)
                      const hasUpdate = agentAdded && hasNewerVersion(selectedAgent.name, selectedAgent.version)

                      if (hasUpdate) {
                        return (
                          <button
                            className="btn-primary"
                            onClick={handleInstallAgent}
                            disabled={isInstalling || isFixingRequirements || (requirementResults.length > 0 && !areAllRequirementsChecked()) || hasUnsatisfiedRequirements()}
                          >
                            {(requirementResults.length > 0 && !areAllRequirementsChecked())
                              ? 'Checking...'
                              : isInstalling
                                ? 'Updating...'
                                : 'Update'
                            }
                          </button>
                        )
                      } else {
                        return (
                          <button
                            className={`btn-primary ${agentAdded ? 'btn-added' : ''}`}
                            onClick={handleInstallAgent}
                            disabled={isInstalling || isFixingRequirements || agentAdded || (requirementResults.length > 0 && !areAllRequirementsChecked()) || hasUnsatisfiedRequirements()}
                          >
                            {(requirementResults.length > 0 && !areAllRequirementsChecked())
                              ? 'Checking...'
                              : agentAdded
                                ? 'Installed'
                                : isInstalling
                                  ? 'Installing...'
                                  : 'Install'
                            }
                          </button>
                        )
                      }
                    })()}
                  </div>
                </div>

                {/* Agent Content */}
                <div className="server-detail-content">
                  {/* Requirements Warning */}
                  {requirementResults.length > 0 && hasUnsatisfiedRequirements() && (
                    <div className="detail-section warning-section">
                      <div className="requirements-warning">
                        <div className="warning-icon">⚠️</div>
                        <div className="warning-text">
                          This agent may not work correctly until all requirements are met.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Requirements Section */}
                  {requirementResults.length > 0 && (
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
                        {/* Fix Requirements button - only shown when requirements are not fully satisfied */}
                        {hasUnsatisfiedRequirements() && (
                          <div className="server-header-actions">
                            <button
                              className="btn-primary"
                              onClick={handleFixRequirements}
                              disabled={isFixingRequirements}
                              title="Fix unsatisfied requirements"
                              style={{ fontSize: '12px', padding: '4px 8px', boxShadow: 'none' }}
                            >
                              {isFixingRequirements
                                ? 'Fixing Requirements...'
                                : 'Fix Requirements'}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="section-content">
                        {/* Software Requirements */}
                        {getRequirementsByType('software').length > 0 && (
                          <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666' }}>Software</h4>
                            <div className="requirements-table-container">
                              <table className="requirements-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                                <colgroup>
                                  <col style={{ width: '30%' }} />
                                  <col style={{ width: '20%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '35%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Requirement</th>
                                    <th>Required Version</th>
                                    <th>Status</th>
                                    <th>Local Details</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {getRequirementsByType('software').map(renderRequirementRow)}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* MCP Requirements */}
                        {getRequirementsByType('mcp').length > 0 && (
                          <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666' }}>MCP Servers</h4>
                            <div className="requirements-table-container">
                              <table className="requirements-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                                <colgroup>
                                  <col style={{ width: '30%' }} />
                                  <col style={{ width: '20%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '35%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>MCP Server</th>
                                    <th>Required Version</th>
                                    <th>Status</th>
                                    <th>Local Details</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {getRequirementsByType('mcp').map(renderRequirementRow)}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Skill Requirements */}
                        {getRequirementsByType('skill').length > 0 && (
                          <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666' }}>Skills</h4>
                            <div className="requirements-table-container">
                              <table className="requirements-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                                <colgroup>
                                  <col style={{ width: '30%' }} />
                                  <col style={{ width: '20%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '35%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Skill</th>
                                    <th>Required Version</th>
                                    <th>Status</th>
                                    <th>Local Details</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {getRequirementsByType('skill').map(renderRequirementRow)}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Configuration Section */}
                  {selectedAgent.configuration && (
                    <div className="detail-section">
                      <h3 className="section-title">Configuration</h3>
                      <div className="section-content">
                        <pre className="schema-code">
                          <code>{JSON.stringify(selectedAgent.configuration, null, 2)}</code>
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Contact Section */}
                  {selectedAgent.contact && (
                    <div className="detail-section">
                      <h3 className="section-title">Contact</h3>
                      <div className="section-content">
                        <a href={`mailto:${selectedAgent.contact}`} className="lib-contact-link">
                          {selectedAgent.contact}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Description Section */}
                  <div className="detail-section">
                    <h3 className="section-title">Description</h3>
                    <div className="section-content">
                      <div className="server-description-text">
                        {selectedAgent.description ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedAgent.description}
                          </ReactMarkdown>
                        ) : (
                          <p>No description available</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Version Section */}
                  {selectedAgent.version && (
                    <div className="detail-section">
                      <h3 className="section-title">Version</h3>
                      <div className="section-content">
                        <p className="lib-version-text">
                          <strong>Current Version:</strong> {selectedAgent.version}
                          {(() => {
                            const installedVersion = getInstalledAgentVersion(selectedAgent.name)
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
                <span>Select an agent from the list to view details</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="library-empty">
          <div className="empty-icon">📦</div>
          <div className="empty-message">No agents available in the library</div>
        </div>
      )}

      {/* Confirm Dialog for ON-DEVICE Overwrite */}
      <Dialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Replace Existing Agent</DialogTitle>
            <DialogDescription className="text-left">
              An agent with the same name already exists on your device. This action will replace it and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-left">
            <p className="text-sm text-gray-700">
              Agent name: <strong>{selectedAgent?.name}</strong>
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
                // When overwriting ON-DEVICE version, set isUpdateMode to true
                // so that if requirements are unsatisfied and Kobi is needed, the update prompt is used
                setIsUpdateMode(true)
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
              The agent may not work correctly until all requirements are met.
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
                await handleKobiFixAndInstall()
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
          setPendingAgentConfig(null)
          setUserInputFields([])
          setIsInstalling(false)
        }}
        fields={userInputFields}
        serverName={selectedAgent?.name || ''}
        contact={selectedAgent?.contact}
        onSubmit={handleUserInputSubmit}
        onSkip={handleUserInputSkip}
      />
    </div>
  )
}

export default AddFromAgentLibraryViewContent
