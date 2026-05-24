import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';

import '../../../styles/Agent.css';
import { TabComponentProps } from './types';
import { useSubAgents } from '../../userData/userDataProvider';

/**
 * AgentSubAgentsTab - Agent Sub-Agents configuration tab
 *
 * Features:
 * - Displays the global Sub-Agents list
 * - Allows users to select/deselect Sub-Agents via checkboxes
 * - Selected sub-agent names are stored in agent.sub_agents: string[]
 *
 * Design reference: AgentSkillsTab.tsx
 * - Uses shared TabComponentProps interface
 * - cachedData takes priority over agentData (persists across tab switches)
 * - useMemo dirty detection notifies parent of hasChanges
 * - No readOnly restriction (Library Agents can also edit sub-agent references)
 */
const AgentSubAgentsTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { subAgents: globalSubAgents, isLoading } = useSubAgents();
  const navigate = useNavigate();
  const location = useLocation();

  // Store selected sub-agent names
  const [selectedSubAgents, setSelectedSubAgents] = useState<Set<string>>(new Set());

  const [isInitialized, setIsInitialized] = useState(false);

  // Initial data for comparison to detect modifications
  const [initialSubAgents, setInitialSubAgents] = useState<Set<string>>(new Set());

  // Load selected sub-agents - reload when agentData or cachedData changes
  useEffect(() => {
    if (agentData?.id) {
      const baseSubAgents = new Set<string>();

      if (agentData?.subAgents) {
        agentData.subAgents.forEach((name) => {
          baseSubAgents.add(name);
        });
      }

      // If cached data exists, prefer cached data
      let finalSubAgents = baseSubAgents;
      if (cachedData?.subAgents) {
        finalSubAgents = new Set(cachedData.subAgents);
      }

      setSelectedSubAgents(finalSubAgents);
      if (!isInitialized) {
        setInitialSubAgents(new Set(baseSubAgents)); // Initial data is always the original data
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.subAgents, cachedData?.subAgents, isInitialized]);

  // Check if data has been modified
  const hasChanges = useMemo(() => {
    if (selectedSubAgents.size !== initialSubAgents.size) return true;

    for (const name of selectedSubAgents) {
      if (!initialSubAgents.has(name)) return true;
    }
    return false;
  }, [selectedSubAgents, initialSubAgents]);

  // Notify parent component when data changes - use useRef to track last notified data
  const lastNotifiedDataRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isInitialized && onDataChange) {
      const subAgents = Array.from(selectedSubAgents);
      const dataKey = JSON.stringify(subAgents);

      // Only notify parent when data actually changes to avoid infinite loops
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('sub_agents', { subAgents }, hasChanges);
      }
    }
  }, [selectedSubAgents, hasChanges, isInitialized, onDataChange]);

  // Toggle sub-agent selection state
  const handleToggle = useCallback((subAgentName: string) => {
    if (readOnly) return;

    setSelectedSubAgents((prev) => {
      const newSelections = new Set(prev);

      if (newSelections.has(subAgentName)) {
        newSelections.delete(subAgentName);
      } else {
        newSelections.add(subAgentName);
      }

      return newSelections;
    });
  }, [readOnly]);

  // Count selected sub-agents (only those that actually exist in globalSubAgents)
  const selectedCount = useMemo(() => {
    if (!globalSubAgents || globalSubAgents.length === 0) {
      return 0;
    }
    const availableSelected = Array.from(selectedSubAgents).filter(name =>
      globalSubAgents.some(sa => sa.name === name)
    );
    return availableSelected.length;
  }, [selectedSubAgents, globalSubAgents]);

  // Navigate to Sub-Agents management page
  const handleManageAll = useCallback(() => {
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings/sub-agents');
  }, [navigate, location.pathname]);

  // Navigate to Sub-Agents management page and select the corresponding sub-agent
  const handleManageSubAgent = useCallback(
    (subAgentName: string) => {
      sessionStorage.setItem('previousPath', location.pathname);

      // Close Agent Editor first
      window.dispatchEvent(new CustomEvent('agent:closeEditor'));

      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('subAgents:selectSubAgent', {
            detail: { subAgentName },
          }),
        );
        navigate('/settings/sub-agents');
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
            {selectedCount} selected from available sub-agents
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleManageAll}
            title="Manage available sub-agents"
          >
            Manage Available Sub-Agents
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="tab-body">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner">🔄</div>
            <span>Loading Sub-Agents...</span>
          </div>
        ) : globalSubAgents && globalSubAgents.length > 0 ? (
          <>
            {/* Sub-Agent Cards List */}
            <div className="skill-cards">
              {globalSubAgents.map((subAgent) => {
                const isSelected = selectedSubAgents.has(subAgent.name);

                return (
                  <div
                    key={subAgent.name}
                    className={`skill-card ${isSelected ? 'selected' : ''} ${readOnly ? 'readonly' : ''}`}
                    onClick={() => !readOnly && handleToggle(subAgent.name)}
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
                            if (!readOnly) {
                              handleToggle(subAgent.name);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={readOnly}
                        />
                        <div className="skill-card-name-group">
                          <div className="server-title-row">
                            <span className="sub-agent-emoji" style={{ marginRight: '6px' }}>{subAgent.emoji}</span>
                            <span className="skill-card-name">{subAgent.display_name}</span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'row',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            {subAgent.version && (
                              <span className="skill-card-version">
                                v{subAgent.version}
                              </span>
                            )}
                            <span className="skill-card-version">
                              {subAgent.context_access}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="skill-actions">
                        <button
                          className="manage-btn always-visible"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleManageSubAgent(subAgent.name);
                          }}
                          title="Manage Sub-Agent"
                        >
                          <Settings size={14} />
                        </button>
                      </div>
                    </div>
                    {subAgent.description && (
                      <div className="sub-agent-card-description" style={{
                        padding: '0 12px 8px 36px',
                        fontSize: '12px',
                        color: 'var(--text-secondary, #6b7280)',
                        lineHeight: '1.4',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {subAgent.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h4>No available Sub-Agents to select</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', margin: '8px 0 16px' }}>
              Go to Settings → Sub-Agents to create or install sub-agents.
            </p>
            <button className="manage-servers-btn" onClick={handleManageAll}>
              Go to Manage Available Sub-Agents
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSubAgentsTab;
