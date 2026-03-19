import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';

import '../../../styles/Agent.css';
import { TabComponentProps } from './types';
import { useSkills } from '../../userData/userDataProvider';
import { useLayout } from '../../layout/LayoutProvider';
import { isBuiltinSkill } from '../../../../shared/constants/builtinSkills';
import { isBuiltinAgent } from '../../../lib/userData/types';

/**
 * AgentSkillsTab - Agent Skills configuration tab
 *
 * Features:
 * - Display global Skills list
 * - Allow users to select/deselect Skills via checkbox
 * - Selected skill names are stored in agent.skills: string[]
 *
 * Layout and styling are consistent with AgentMcpServersTab
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

  // Initial data for comparing changes
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

      // If cached data exists, use cached data first
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
    if (readOnly) return; // Toggling not allowed in read-only mode
    
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

  // 🆕 Refactored: Calculate selected skills count (only count those actually existing in globalSkills)
  const selectedCount = useMemo(() => {
    if (!globalSkills || globalSkills.length === 0) {
      return 0;
    }
    // Filter to only actually existing skills
    const availableSelectedSkills = Array.from(selectedSkills).filter(skillName =>
      globalSkills.some(s => s.name === skillName)
    );
    return availableSelectedSkills.length;
  }, [selectedSkills, globalSkills]);

  // Calculate total skills count
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
      
      // Close the Agent Editor first
      window.dispatchEvent(new CustomEvent('agent:closeEditor'));

      // Delay briefly to ensure editor is closed, then switch view and select skill
      setTimeout(() => {
        // Dispatch custom event to notify SkillsView to select the skill
        window.dispatchEvent(
          new CustomEvent('skills:selectSkill', {
            detail: { skillName },
          }),
        );
        // Switch to the skills view in settings page
        navigate('/settings/skills');
      }, 100);
    },
    [navigate, location.pathname],
  );

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
              {[...globalSkills].sort((a, b) => {
                const aBuiltin = isBuiltinSkill(a.name);
                const bBuiltin = isBuiltinSkill(b.name);
                if (aBuiltin && !bBuiltin) return -1;
                if (!aBuiltin && bBuiltin) return 1;
                return 0;
              }).map((skill) => {
                const isSelected = selectedSkills.has(skill.name);
                const isSkillLocked = isBuiltinSkill(skill.name) && isBuiltinAgent(agentData?.name);

                return (
                  <div
                    key={skill.name}
                    className={`skill-card ${isSelected ? 'selected' : ''} ${readOnly ? 'readonly' : ''}`}
                    onClick={() => !readOnly && handleSkillToggle(skill.name)}
                    style={readOnly ? { cursor: 'default' } : undefined}
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
                            {isBuiltinSkill(skill.name) && <span className="builtin-badge">Built-in</span>}
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
                          </div>
                        </div>
                      </div>
                      <div className="skill-actions">
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