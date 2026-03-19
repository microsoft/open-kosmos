'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useSkills, useProfileDataRefresh } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import SkillsHeaderView from './SkillsHeaderView';
import SkillsContentView from './SkillsContentView';
import { SkillConfig } from '../../lib/userData/types';
import { AgentContextType } from '../../types/agentContextTypes';

const SkillsView: React.FC = () => {
  const {
    sidepaneWidth: width,
    setSidepaneWidth: setWidth,
    isDragging,
    onSkillsAddMenuToggle,
    onSkillMenuToggle,
  } = useOutletContext<AgentContextType>();

  const navigate = useNavigate();

  // Use ProfileDataManager for Skills data
  const { skills, stats: skillsStats, isLoading } = useSkills();
  const { refresh } = useProfileDataRefresh();
  const { showSuccess, showError, showInfo, showToast } = useToast();

  // Local state management
  const [selectedSkill, setSelectedSkill] = useState<SkillConfig | null>(null);



  // When skills change, auto-select the first skill
  useEffect(() => {
    if (skills.length > 0 && !selectedSkill) {
      setSelectedSkill(skills[0]);
    } else if (skills.length === 0) {
      setSelectedSkill(null);
    }
  }, [skills, selectedSkill]);

  // Listen for skill selection events from other components
  useEffect(() => {
    const handleSelectSkillEvent = (event: CustomEvent) => {
      const { skillName } = event.detail;
      const skill = skills.find((s) => s.name === skillName);
      if (skill) {
        setSelectedSkill(skill);
      }
    };

    window.addEventListener(
      'skills:selectSkill',
      handleSelectSkillEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skills:selectSkill',
        handleSelectSkillEvent as EventListener,
      );
    };
  }, [skills]);

  // Handle skill selection
  const handleSkillSelect = useCallback((skill: SkillConfig) => {
    setSelectedSkill(skill);
  }, []);

  // Handle add button click
  const handleAddClick = useCallback(
    (buttonElement: HTMLElement) => {
      if (onSkillsAddMenuToggle) {
        onSkillsAddMenuToggle(buttonElement);
      }
    },
    [onSkillsAddMenuToggle],
  );

  // Handle skill library callback
  const handleSkillAdded = useCallback(() => {
    // Refresh profile data to reflect newly added skill
    setTimeout(() => {
      refresh().catch(() => {});
    }, 500);
  }, [refresh]);

  // Listen for Skills add menu events from AppLayout
  useEffect(() => {
    const handleAddFromDevice = async () => {
      try {
        // Check if API is available
        if (!window.electronAPI?.skillLibrary?.addSkillFromDevice) {
          showError('Add skill from device API not available');
          return;
        }

        // Record currently selected skill name to determine if skill-folder-explorer needs refresh
        const currentlySelectedSkillName = selectedSkill?.name;

        // Call main process IPC handler to select and import zip file
        const result =
          await window.electronAPI.skillLibrary.addSkillFromDevice();

        if (result.success) {
          showSuccess(`Skill "${result.skillName}" added successfully`);

          // Refresh skills list
          setTimeout(() => {
            refresh().catch(() => {});
          }, 500);

          // If overwritten skill is the currently selected skill, trigger skill-folder-explorer refresh
          if (result.skillName && currentlySelectedSkillName === result.skillName) {
            // Delay triggering refresh event to ensure skills list has been updated
            setTimeout(() => {
              // Dispatch custom event to trigger skill-folder-explorer refresh
              window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
                detail: { skillName: result.skillName }
              }));
            }, 600);
          }

          // Show Apply to Agents dialog only for new installs (not overwrites)
          if (result.skillName && !result.isOverwrite) {
            window.dispatchEvent(new CustomEvent('skills:applyToAgents', {
              detail: { skillName: result.skillName }
            }));
          }
        } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
          // Validation failure uses persistent toast, display error message directly (already includes "Validation failed: " prefix)
          showToast(result.error, 'error', undefined, { persistent: true });
        }
        // When result.error === 'File selection canceled' or 'User cancelled the operation', don't show any toast
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        showError(`Failed to add skill from device: ${errorMessage}`);
      }
    };

    window.addEventListener(
      'skills:addFromDevice',
      handleAddFromDevice as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skills:addFromDevice',
        handleAddFromDevice as EventListener,
      );
    };
  }, [refresh, showSuccess, showError, showInfo]);

  return (
    <div className="skills-view">
      <SkillsHeaderView
        totalSkills={skillsStats.totalSkills}
        onAddClick={handleAddClick}
      />

      <SkillsContentView
        skills={skills}
        selectedSkill={selectedSkill}
        isLoading={isLoading}
        onSelectSkill={handleSkillSelect}
        onSkillMenuToggle={onSkillMenuToggle}
      />

    </div>
  );
};

export default SkillsView