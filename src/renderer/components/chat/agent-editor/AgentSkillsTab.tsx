import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, RotateCw } from 'lucide-react';

import '../../../styles/Agent.css';
import { TabComponentProps } from './types';
import { useSkills } from '../../userData/userDataProvider';
import { useLayout } from '../../layout/LayoutProvider';
import { isBuiltinSkill } from '../../../../shared/constants/builtinSkills';
import { isBuiltinAgent } from '../../../lib/userData/types';
import ListSearchBox from '../../ui/ListSearchBox';
import { createLogger } from '../../../lib/utilities/logger';
const logger = createLogger('[AgentSkillsTab]');

/** Check if a skill is provided by a plugin (source === 'PLUGIN' or name starts with 'plugin:') */
function isPluginSkill(skillName: string, skillSource?: string): boolean {
  return skillSource === 'PLUGIN' || skillName.startsWith('plugin--');
}

/**
 * AgentSkillsTab - Agent Skills configuration tab
 *
 * Features:
 * - Displays the global Skills list
 * - Allows users to select/deselect Skills via checkboxes
 * - Selected skill names are stored in agent.skills: string[]
 *
 * Layout and styles are kept consistent with AgentMcpServersTab
 */
const AgentSkillsTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { skills: globalSkills, isLoading } = useSkills();
  const navigate = useNavigate();
  const location = useLocation();

  // Store selected skill names
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

  const [isInitialized, setIsInitialized] = useState(false);

  // 🆕 Search filter
  const [agentSkillSearchQuery, setAgentSkillSearchQuery] = useState('');

  // Initial data used to detect modifications
  const [initialSkills, setInitialSkills] = useState<Set<string>>(new Set());

  // Load selected skills - reload when agentData or cachedData changes
  useEffect(() => {
    if (agentData?.id) {
      const baseSkills = new Set<string>();

      if (agentData?.skills) {
        agentData.skills.forEach((skillName) => {
          baseSkills.add(skillName);
        });
      }

      // If cached data exists, prefer it over the base data
      let finalSkills = baseSkills;
      if (cachedData?.skills) {
        finalSkills = new Set(cachedData.skills);
      }

      setSelectedSkills(finalSkills);
      if (!isInitialized) {
        setInitialSkills(new Set(baseSkills)); // Initial data is always the original data
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.skills, cachedData?.skills, isInitialized]);

  // Check if data has been modified - use useMemo to avoid function reference changes
  const hasChanges = useMemo(() => {
    if (selectedSkills.size !== initialSkills.size) return true;

    for (const skill of selectedSkills) {
      if (!initialSkills.has(skill)) return true;
    }
    return false;
  }, [selectedSkills, initialSkills]);

  // Notify parent component when data changes - use useRef to track last notified data
  const lastNotifiedDataRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isInitialized && onDataChange) {
      const skills = Array.from(selectedSkills);
      const dataKey = JSON.stringify(skills);

      // Only notify parent when data actually changes, to avoid infinite loops
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('skills', { skills }, hasChanges);
      }
    }
  }, [selectedSkills, hasChanges, isInitialized, onDataChange]);

  // Toggle skill selection state
  const handleSkillToggle = useCallback((skillName: string) => {
    if (readOnly) return; // Toggle not allowed in read-only mode

    // Built-in skills cannot be unchecked for builtin agents
    if (isBuiltinSkill(skillName) && isBuiltinAgent(agentData?.name)) return;

    setSelectedSkills((prev) => {
      const newSelections = new Set(prev);

      if (newSelections.has(skillName)) {
        // Currently selected, deselect
        newSelections.delete(skillName);
      } else {
        // Currently not selected, add selection
        newSelections.add(skillName);
      }

      return newSelections;
    });
  }, [readOnly]);

  // 🆕 Refactor: count selected skills (only those that actually exist in globalSkills)
  const selectedCount = useMemo(() => {
    if (!globalSkills || globalSkills.length === 0) {
      return 0;
    }
    // Filter to skills that actually exist
    const availableSelectedSkills = Array.from(selectedSkills).filter(skillName =>
      globalSkills.some(s => s.name === skillName)
    );
    return availableSelectedSkills.length;
  }, [selectedSkills, globalSkills]);

  // Compute total skill count
  const totalCount = useMemo(() => {
    return globalSkills?.length || 0;
  }, [globalSkills]);

  // Navigate to Skills management page (settings page)
  const handleManageSkills = useCallback(() => {
    // Save current path to sessionStorage
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings/skills');
  }, [navigate, location.pathname]);

  // Navigate to Skills management page (settings page) and select the corresponding skill
  const handleManageSkill = useCallback(
    (skillName: string) => {
      // Save current path to sessionStorage
      sessionStorage.setItem('previousPath', location.pathname);

      // First close the Agent Editor
      window.dispatchEvent(new CustomEvent('agent:closeEditor'));

      // Wait briefly to ensure the editor is closed, then switch view and select the skill
      setTimeout(() => {
        // Dispatch custom event to notify SkillsView to select this skill
        window.dispatchEvent(
          new CustomEvent('skills:selectSkill', {
            detail: { skillName },
          }),
        );
        // Switch to the skills view on the settings page
        navigate('/settings/skills');
      }, 100);
    },
    [navigate, location.pathname],
  );

  /**
   * Navigate to Skill Library View and select the given Skill
   * Follows ChatViewHeader's approach: use URL query parameters to pass the selection
   * Also pass returnPath state so the SettingsPage Back button can return correctly
   */
  const handleUpdateSkill = useCallback(
    (skillName: string) => {
      if (!skillName) {
        logger.warn('Update button clicked but skill name is not available');
        return;
      }

      logger.debug('Update button clicked for Skill:', skillName);

      // Navigate to the Skill Library page, passing the skill name as a query parameter
      // Use encodeURIComponent to ensure special characters in the name are correctly encoded
      // Route path reference AppRoutes.tsx: /settings/skills/skill-library
      const skillLibraryUrl = `/settings/skills/skill-library?selectSkill=${encodeURIComponent(skillName)}`;

      // Pass returnPath state so the SettingsPage Back button can return to the current page
      navigate(skillLibraryUrl, { state: { returnPath: location.pathname } });
    },
    [navigate, location.pathname],
  );

  /**
   * Compare version strings; returns 1 if v1 > v2
   * Supports semantic versioning format (e.g. 1.0.0, 2.1.3)
   */
  const compareVersions = useCallback((v1: string, v2: string): number => {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }, []);

  // Determine whether to show the Update button for a Skill
  const shouldShowUpdateButton = useCallback((skill: any) => {
    const { version, remoteVersion, source } = skill;

    // ON-DEVICE skills should not show the Update button
    // ON-DEVICE skills are user-created and have no remote library version to update from
    if (source === 'ON-DEVICE') {
      return false;
    }

    // Only consider showing button when remoteVersion is non-empty
    if (!remoteVersion || remoteVersion.trim() === '') {
      return false;
    }

    // Show button if version is empty or remoteVersion > version
    if (!version || version.trim() === '' || compareVersions(remoteVersion, version) > 0) {
      return true;
    }

    return false;
  }, [compareVersions]);

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="tab-header">
        <div className="header-summary">
          <span className="summary-text">
            {selectedCount} selected from available skills
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleManageSkills}
            title="Manage available skills"
          >
            Manage Available Skills
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="tab-body">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner">🔄</div>
            <span>Loading Skills...</span>
          </div>
        ) : globalSkills && globalSkills.length > 0 ? (
          <>
            {/* Skills List */}
            <div className="skill-cards">
              <ListSearchBox
                value={agentSkillSearchQuery}
                onChange={setAgentSkillSearchQuery}
                placeholder="Search skills..."
              />
              {[...globalSkills].sort((a, b) => {
                const aBuiltin = isBuiltinSkill(a.name);
                const bBuiltin = isBuiltinSkill(b.name);
                if (aBuiltin && !bBuiltin) return -1;
                if (!aBuiltin && bBuiltin) return 1;
                const aPlugin = isPluginSkill(a.name, a.source);
                const bPlugin = isPluginSkill(b.name, b.source);
                if (aPlugin && !bPlugin) return 1;
                if (!aPlugin && bPlugin) return -1;
                return 0;
              })
              .filter(skill => !agentSkillSearchQuery || skill.name.includes(agentSkillSearchQuery))
              .map((skill) => {
                const isSelected = selectedSkills.has(skill.name);
                const isSkillBuiltin = isBuiltinSkill(skill.name);
                const isSkillFromPlugin = isPluginSkill(skill.name, skill.source);
                const isSkillLocked = (isSkillBuiltin && isBuiltinAgent(agentData?.name)) || isSkillFromPlugin;

                return (
                  <div
                    key={skill.name}
                    className={`skill-card ${isSelected ? 'selected' : ''} ${readOnly ? 'readonly' : ''} ${isSkillFromPlugin ? 'plugin-skill' : ''}`}
                    onClick={() => !readOnly && !isSkillFromPlugin && handleSkillToggle(skill.name)}
                    style={readOnly || isSkillFromPlugin ? { cursor: 'default', opacity: 0.75 } : undefined}
                  >
                    <div className="skill-card-header">
                      <div className="skill-info">
                        <input
                          type="checkbox"
                          className="skill-checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (!readOnly && !isSkillLocked) {
                              handleSkillToggle(skill.name);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={readOnly || isSkillLocked}
                        />
                        <div className="skill-card-name-group">
                          <div className="server-title-row">
                            <span className="skill-card-name">{skill.name}</span>
                            {isSkillBuiltin && <span className="builtin-badge">Built-in</span>}
                            {isSkillFromPlugin && <span className="builtin-badge" style={{ background: 'var(--color-accent-secondary, #6b5ce7)', opacity: 0.85 }}>Plugin</span>}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'row',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            {skill.version && (
                              <span className="skill-card-version">
                                v{skill.version}
                              </span>
                            )}
                            {skill.source && (
                              <span className="skill-card-version">
                                {skill.source}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="skill-actions">
                        {!isSkillFromPlugin && shouldShowUpdateButton(skill) && (
                          <button
                            className="update-skill-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateSkill(skill.name);
                            }}
                            title="Update to the latest version in library"
                          >
                            <RotateCw size={14} className="update-skill-icon" />
                            <span className="update-skill-text">Update</span>
                          </button>
                        )}
                        {!isSkillFromPlugin && (
                          <button
                            className="manage-btn always-visible"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageSkill(skill.name);
                            }}
                            title="Manage Skill"
                          >
                            <Settings size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h4>No available Skills to select</h4>
            <button className="manage-servers-btn" onClick={handleManageSkills}>
              Go to Manage Available Skills
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSkillsTab