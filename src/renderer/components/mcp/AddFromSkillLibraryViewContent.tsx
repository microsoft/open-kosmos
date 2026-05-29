/**
 * AddFromSkillLibraryViewContent Component
 * Contains all the functionality from the original SkillLibraryView, but as a content view instead of a modal
 */

import React, { useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSearchParams } from 'react-router-dom'
import '../../styles/Modal.css'
import '../../styles/McpLibraryView.css'
import { useToast } from '../ui/ToastProvider'
import { useSkills } from '../userData/userDataProvider'
import { createLogger } from '../../lib/utilities/logger';
import ListSearchBox from '../ui/ListSearchBox'
import { ApplySkillDialogAtom } from '../skills/ApplySkillToAgentsDialog'
const logger = createLogger('[AddFromSkillLibraryViewContent]');

interface AddFromSkillLibraryViewContentProps {
  onSkillAdded?: (count: number) => void
}

interface SkillLibraryItem {
  name: string
  description: string
  version: string
  contact?: string
}

interface SkillLibraryData {
  skills: SkillLibraryItem[]
}

const AddFromSkillLibraryViewContent: React.FC<AddFromSkillLibraryViewContentProps> = ({
  onSkillAdded
}) => {
  const { showError, showSuccess, showToast } = useToast()
  const { skills: existingSkills } = useSkills()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [libraryData, setLibraryData] = useState<SkillLibraryData | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillLibraryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  // 🆕 Search filter
  const [skillLibSearchQuery, setSkillLibSearchQuery] = useState('')

  // Auto-select first filtered item when current selection is not in filtered results
  const filteredSkillLibItems = libraryData?.skills.filter(
    skill => !skillLibSearchQuery || skill.name.includes(skillLibSearchQuery)
  ) ?? []

  useEffect(() => {
    if (!skillLibSearchQuery) return
    if (filteredSkillLibItems.length === 0) {
      setSelectedSkill(null)
    } else {
      const currentInFiltered = selectedSkill && filteredSkillLibItems.some(s => s.name === selectedSkill.name)
      if (!currentInFiltered) {
        setSelectedSkill(filteredSkillLibItems[0])
      }
    }
  }, [skillLibSearchQuery, filteredSkillLibItems.length])
  // Load library data on component mount
  useEffect(() => {
    loadLibraryData()
  }, [])

  const loadLibraryData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      logger.debug('[AddFromSkillLibraryViewContent] Loading library data via IPC...')

      // Use IPC to get library data from main process
      const result = await window.electronAPI.skillLibrary.getLibraryData()

      if (!result.success) {
        throw new Error(result.error || 'Failed to load library data')
      }

      const data: SkillLibraryData = result.data

      if (!data.skills || !Array.isArray(data.skills)) {
        throw new Error('Invalid data format: skills array not found')
      }

      logger.debug(`[AddFromSkillLibraryViewContent] Successfully loaded ${data.skills.length} skills`)

      setLibraryData(data)

      // Check for selectSkill URL parameter to auto-select specific skill
      const selectSkillParam = searchParams.get('selectSkill')
      if (selectSkillParam && data.skills.length > 0) {
        const skillToSelect = data.skills.find(skill => skill.name === selectSkillParam)
        if (skillToSelect) {
          logger.debug(`[AddFromSkillLibraryViewContent] Auto-selecting skill from URL param: ${selectSkillParam}`)
          setSelectedSkill(skillToSelect)
        } else {
          // Fallback to first skill if specified skill not found
          logger.debug(`[AddFromSkillLibraryViewContent] Skill "${selectSkillParam}" not found, selecting first skill`)
          setSelectedSkill(data.skills[0])
        }
      } else if (data.skills.length > 0) {
        // Auto-select first skill if available
        setSelectedSkill(data.skills[0])
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      logger.error('[AddFromSkillLibraryViewContent] Failed to load library data:', err)
      setError(errorMessage)
      showError(`Failed to load Skill library: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [showError, searchParams])

  // Check if skill already exists in library (name match AND source is IN-LIBRARY)
  const isSkillAdded = useCallback((skillName: string): boolean => {
    return existingSkills.some(s => s.name === skillName && s.source === 'IN-LIBRARY')
  }, [existingSkills])

  // Check if skill has a newer version available
  const hasNewerVersion = useCallback((skillName: string, libraryVersion: string): boolean => {
    const existingSkill = existingSkills.find(s => s.name === skillName && s.source === 'IN-LIBRARY')
    if (!existingSkill) return false

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

    return compareVersions(libraryVersion, existingSkill.version) > 0
  }, [existingSkills])

  const installSkillActions = ApplySkillDialogAtom.useChange();

  // Handle skill addition with new logic flow
  const handleAddSkill = useCallback(async () => {
    if (!selectedSkill) {
      showError('Please select a skill to add')
      return
    }

    setIsAdding(true)

    try {
      // Step 1: Perform compliance check (excluding same-name check) and same-name check
      logger.debug('[AddFromSkillLibraryViewContent] Starting skill validation...')
      const validationResult = await window.electronAPI.skillLibrary.validateSkill(selectedSkill.name)

      if (!validationResult.success) {
        // Step 2: If non-compliant, show error message and end the flow
        logger.debug('[AddFromSkillLibraryViewContent] Skill validation failed:', validationResult.error)
        showToast(
          validationResult.error || 'Skill validation failed',
          'error',
          0, // 0 duration for persistent toast
          { persistent: true }
        )
        return
      }

      logger.debug('[AddFromSkillLibraryViewContent] Skill validation passed, hasExisting:', validationResult.hasExisting)

      // Step 3: If compliant, check for skills with the same name
      if (validationResult.hasExisting) {
        // Step 3.1: A skill with the same name exists — use native dialog to request user confirmation for overwrite
        logger.debug('[AddFromSkillLibraryViewContent] Found existing skill, requesting user confirmation')

        const confirmResult = await window.electronAPI.skillLibrary.showOverwriteConfirmDialog(selectedSkill.name)

        if (!confirmResult.success) {
          showError(`Failed to show confirmation dialog: ${confirmResult.error || 'Unknown error'}`)
          return
        }

        if (confirmResult.confirmed) {
          // User confirmed overwrite — delete original directory, then extract zip
          logger.debug('[AddFromSkillLibraryViewContent] User confirmed overwrite for:', selectedSkill.name)
          await performSkillInstallation(selectedSkill.name, true)
        } else {
          // User cancelled overwrite — end the entire Add flow (temp files already cleaned up by backend)
          logger.debug('[AddFromSkillLibraryViewContent] User cancelled overwrite for:', selectedSkill.name)
        }
        return
      } else {
        // Step 3.2: No skill with the same name — proceed with normal installation
        logger.debug('[AddFromSkillLibraryViewContent] No existing skill found, proceeding with installation')
        await performSkillInstallation(selectedSkill.name, false)
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      logger.error('[AddFromSkillLibraryViewContent] Skill validation error:', errorMessage)
      showError(`Failed to validate skill: ${errorMessage}`)
    } finally {
      setIsAdding(false)
    }
  }, [selectedSkill, showError, showSuccess, showToast, onSkillAdded])

  // Execute the actual Skill installation
  const performSkillInstallation = useCallback(async (skillName: string, overwrite: boolean) => {
    try {
      logger.debug('[AddFromSkillLibraryViewContent] Installing skill:', skillName, 'overwrite:', overwrite)
      const result = await window.electronAPI.skillLibrary.addSkill(skillName, {
        overwrite,
        requestSource: 'skill-library',
      })

      if (result.success) {
        showSuccess(result.message || `Skill "${skillName}" ${overwrite ? 'replaced' : 'added'} successfully!`)

        // Notify parent component
        onSkillAdded?.(1)

        // Settings library install has no explicit agent target, so fresh installs should open manual selection.
        if (result.skillName && !overwrite && result.resolution === 'installed_but_not_applied') {
          installSkillActions.setSkill(result.skillName);
        }
      } else {
        showError(`Failed to ${overwrite ? 'replace' : 'add'} skill: ${result.error || 'Unknown error'}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to ${overwrite ? 'replace' : 'add'} skill: ${errorMessage}`)
    }
  }, [showError, showSuccess, onSkillAdded])

  // Handle skill update
  const handleUpdateSkill = useCallback(async () => {
    if (!selectedSkill) {
      showError('Please select a skill to update')
      return
    }

    setIsAdding(true)

    try {
      // Update skill using IPC
      const result = await window.electronAPI.skillLibrary.updateSkill(selectedSkill.name)

      if (result.success) {
        showSuccess(`Skill "${selectedSkill.name}" updated successfully!`)

        // Notify parent component
        onSkillAdded?.(1)
      } else {
        showError(`Failed to update skill: ${result.error || 'Unknown error'}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      showError(`Failed to update skill: ${errorMessage}`)
    } finally {
      setIsAdding(false)
    }
  }, [selectedSkill, showError, showSuccess, onSkillAdded])

  return (
    <div className="add-from-mcp-library-content mcp-library-view">
      {isLoading ? (
        <div className="library-loading">
          <svg className="spinner" width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="18" cy="18" r="16.5" stroke="black" strokeOpacity="0.15" strokeWidth="3"/>
            <path d="M34.5 18C34.5 22.3761 32.7616 26.5729 29.6673 29.6673C26.5729 32.7616 22.3761 34.5 18 34.5" stroke="#272320" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <span>Loading Skill library...</span>
        </div>
      ) : error ? (
        <div className="library-error">
          <div className="error-icon">❌</div>
          <div className="error-message">{error}</div>
          <button className="btn-secondary" onClick={loadLibraryData}>
            Retry
          </button>
        </div>
      ) : libraryData && libraryData.skills.length > 0 ? (
        <div className="library-layout">
          {/* Left: Skill List */}
          <div className="server-list-panel">
            <ListSearchBox
              value={skillLibSearchQuery}
              onChange={setSkillLibSearchQuery}
              placeholder="Search skills..."
            />
            <div className="server-list">
              {filteredSkillLibItems.map((skill) => {
                const skillAdded = isSkillAdded(skill.name)
                const hasUpdate = skillAdded && hasNewerVersion(skill.name, skill.version)

                return (
                  <div
                    key={skill.name}
                    className={`server-card ${selectedSkill?.name === skill.name ? 'selected' : ''} ${skillAdded ? 'added' : ''}`}
                    onClick={() => setSelectedSkill(skill)}
                  >
                    <div className="server-card-header">
                      <div className="skill-card-info">
                        <div className="skill-card-name-group">
                          <span className="server-card-name">
                            {skill.name}
                            {hasUpdate && (
                              <sup style={{ color: '#ff4444', marginLeft: '4px', fontSize: '0.7em', fontWeight: 'bold' }}>new</sup>
                            )}
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center' }}>
                            {skill.version && (
                              <span className="skill-card-version">v{skill.version}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {skillAdded && !hasUpdate && (
                        <span className="added-badge">Installed</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: Skill Detail */}
          <div className="server-detail-panel">
            {selectedSkill ? (
              <div className="mcp-server-detail-view">
                {/* Skill Header */}
                <div className="server-detail-header">
                  <div className="server-header-info">
                    <div className="server-header-text">
                      <h2 className="server-title">{selectedSkill.name}</h2>
                    </div>
                  </div>

                  {/* Add/Update Button in Header */}
                  <div className="server-header-actions">
                    {(() => {
                      const skillAdded = isSkillAdded(selectedSkill.name)
                      const hasUpdate = skillAdded && hasNewerVersion(selectedSkill.name, selectedSkill.version)

                      if (hasUpdate) {
                        return (
                          <button
                            className="btn-primary"
                            onClick={handleUpdateSkill}
                            disabled={isAdding}
                          >
                            {isAdding ? 'Updating...' : 'Update'}
                          </button>
                        )
                      } else {
                        return (
                          <button
                            className={`btn-primary ${skillAdded ? 'btn-added' : ''}`}
                            onClick={handleAddSkill}
                            disabled={isAdding || skillAdded}
                          >
                            {skillAdded
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

                {/* Skill Content */}
                <div className="server-detail-content">
                  {/* Version Section */}
                  <div className="detail-section">
                    <h3 className="section-title">Version</h3>
                    <div className="section-content">
                      <p className="lib-version-text">
                        <strong>Current Version:</strong> {selectedSkill.version}
                        {(() => {
                          const existingSkill = existingSkills.find(s => s.name === selectedSkill.name && s.source === 'IN-LIBRARY')
                          if (existingSkill) {
                            return (
                              <>
                                <br />
                                <strong>Installed Version:</strong> {existingSkill.version}
                              </>
                            )
                          }
                          return null
                        })()}
                      </p>
                    </div>
                  </div>

                  {/* Description Section */}
                  <div className="detail-section">
                    <h3 className="section-title">Description</h3>
                    <div className="section-content">
                      <div className="server-description-text">
                        {selectedSkill.description ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedSkill.description}
                          </ReactMarkdown>
                        ) : (
                          <p>No description available</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Contact Section */}
                  {selectedSkill.contact && (
                    <div className="detail-section">
                      <h3 className="section-title">Contact</h3>
                      <div className="section-content">
                        <a href={`mailto:${selectedSkill.contact}`} className="lib-contact-link">
                          {selectedSkill.contact}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="no-selection">
                <span>Select a skill from the list to view details</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="library-empty">
          <div className="empty-icon">📦</div>
          <div className="empty-message">No skills available in the library</div>
        </div>
      )}
    </div>
  )
}

export default AddFromSkillLibraryViewContent