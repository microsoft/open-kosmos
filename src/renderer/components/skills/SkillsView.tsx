'use client'

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom';
import { useSkills, useProfileDataRefresh } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import SkillsHeaderView from './SkillsHeaderView';
import SkillsContentView from './SkillsContentView';
import type { SkillConfig } from '../../lib/userData/types';
import { AgentContextType } from '../../types/agentContextTypes';
import { ApplySkillDialogAtom } from './ApplySkillToAgentsDialog';
import { useI18n } from '../../lib/i18n/useI18n';

const SkillsView: React.FC = () => {
  const {
    onSkillsAddMenuToggle,
    onSkillMenuToggle,
  } = useOutletContext<AgentContextType>();

  const { t } = useI18n();

  // Use ProfileDataManager for Skills data
  const { skills, stats: skillsStats, isLoading } = useSkills();
  const { refresh } = useProfileDataRefresh();
  const { showSuccess, showError, showInfo, showToast } = useToast();

  // Local state management
  const [selectedSkill, setSelectedSkill] = useState<SkillConfig | null>(null);
  const installSkillActions = ApplySkillDialogAtom.useChange();

  const handleAddFromDevice = useCallback(async (selectionMode?: 'artifact' | 'folder') => {
    try {
      if (!window.electronAPI?.skills?.addSkillFromDevice) {
        showError(t('skills.add.apiUnavailable'));
        return;
      }

      const currentlySelectedSkillName = selectedSkill?.name;

      const result = await window.electronAPI.skills.addSkillFromDevice(undefined, {
        requestSource: 'settings',
        selectionMode,
      });

      if (result.success) {
        showSuccess(result.message || t('skills.add.success', { name: result.skillName || '' }));

        setTimeout(() => {
          refresh().catch(() => {});
        }, 500);

        if (result.skillName && currentlySelectedSkillName === result.skillName) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
              detail: { skillName: result.skillName }
            }));
          }, 600);
        }

        if (result.skillName && !result.isOverwrite && result.resolution === 'installed_but_not_applied') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('common.unknownError');
      showError(t('skills.add.failed', { error: errorMessage }));
    }
  }, [refresh, selectedSkill?.name, showError, showSuccess, showToast, t]);



  // Ref to access latest skills without adding `skills` to effect deps
  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  // Stable identity for the skills list — only changes when actual skill names change, not on ref instability
  const skillsIdentity = useMemo(() => skills.map(s => s.name).join('\0'), [skills]);

  // When skills list content changes, fix up selection — but never auto-select from null
  // (initial selection and search-related selection are owned by SkillListPanel)
  useEffect(() => {
    const currentSkills = skillsRef.current;
    setSelectedSkill(prev => {
      if (!prev) return prev; // Respect intentional deselection (e.g. zero-result search)
      if (currentSkills.length === 0) return null;
      const stillExists = currentSkills.some(s => s.name === prev.name);
      return stillExists ? prev : currentSkills[0];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsIdentity]);

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
  const handleSkillSelect = useCallback((skill: SkillConfig | null) => {
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

  // Listen for Skills add menu events from AppLayout
  useEffect(() => {
    const handleAddFromDeviceArtifact = () => {
      void handleAddFromDevice('artifact');
    };

    const handleAddFromDeviceFolder = () => {
      void handleAddFromDevice('folder');
    };

    const handleAddFromDeviceLegacy = () => {
      void handleAddFromDevice();
    };

    window.addEventListener(
      'skills:addFromDeviceArtifact',
      handleAddFromDeviceArtifact as EventListener,
    );
    window.addEventListener(
      'skills:addFromDeviceFolder',
      handleAddFromDeviceFolder as EventListener,
    );
    window.addEventListener(
      'skills:addFromDevice',
      handleAddFromDeviceLegacy as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skills:addFromDeviceArtifact',
        handleAddFromDeviceArtifact as EventListener,
      );
      window.removeEventListener(
        'skills:addFromDeviceFolder',
        handleAddFromDeviceFolder as EventListener,
      );
      window.removeEventListener(
        'skills:addFromDevice',
        handleAddFromDeviceLegacy as EventListener,
      );
    };
  }, [handleAddFromDevice]);

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