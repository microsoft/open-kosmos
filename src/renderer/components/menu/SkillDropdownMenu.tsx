import React, { useLayoutEffect } from 'react';
import { FolderOpen, Trash2, RefreshCw } from 'lucide-react';
import { useToast } from '../ui/ToastProvider';
import { useProfileDataRefresh } from '../userData/userDataProvider';
import { isBuiltinSkill } from '../../../shared/constants/builtinSkills';
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition';
import { useI18n } from '../../lib/i18n/useI18n';

interface SkillDropdownMenuProps {
  skillMenuRef: React.RefObject<HTMLDivElement>;
  skillName: string;
  position: AnchoredDropdownPosition;
  onClose: () => void;
}

const SkillDropdownMenu: React.FC<SkillDropdownMenuProps> = ({
  skillMenuRef,
  skillName,
  position,
  onClose
}) => {
  const { showSuccess, showError, showToast } = useToast();
  const { refresh } = useProfileDataRefresh();
  const { t } = useI18n();
  const [isDev, setIsDev] = React.useState(false);

  const isBuiltin = isBuiltinSkill(skillName);

  // Detect dev mode
  React.useEffect(() => {
    const checkDevMode = async () => {
      if (window.electronAPI?.isDev) {
        const devMode = await window.electronAPI.isDev();
        setIsDev(devMode);
      }
    };
    checkDevMode();
  }, []);

  // Get platform info
  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  // Determine menu text based on platform
  const getOpenInExplorerText = () => {
    if (isWindows) {
      return t('common.openInFileExplorer');
    } else if (isMac) {
      return t('common.openInFinder');
    } else {
      return t('common.openInFileManager');
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Trigger delete confirmation event instead of deleting directly
    window.dispatchEvent(new CustomEvent('skill:delete', {
      detail: { skillName }
    }));

    onClose();
  };

  const handleUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      // Check if API is available
      if (!window.electronAPI?.skills?.updateSkillFromDevice) {
        showError(t('skills.menu.updateApiUnavailable'));
        return;
      }

      // Call main process IPC handler to select and update zip file
      const result = await window.electronAPI.skills.updateSkillFromDevice(skillName);

      if (result.success) {
        showSuccess(t('skills.menu.updatedSuccess', { name: result.skillName }));

        // Refresh skills list
        setTimeout(() => {
          refresh().catch(() => {});
        }, 500);

        // Trigger skill-folder-explorer refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);
      } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
        // Validation failure uses persistent toast, displaying the error message directly (already includes "Validation failed: " prefix)
        showToast(result.error, 'error', undefined, { persistent: true });
      }
      // When result.error === 'File selection canceled' or 'User cancelled the operation', show no toast
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('skills.menu.updateFromDeviceFailed', { error: errorMessage }));
    }

    onClose();
  };

  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (skillMenuRef.current) {
      adjustAnchoredDropdownToViewport(skillMenuRef.current, position);
    }
  }, [position]);

  const handleOpenInExplorer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      // Open Skill folder via IPC
      if (!window.electronAPI?.skills?.openSkillFolder) {
        showError(t('skills.menu.openFolderApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.skills.openSkillFolder(skillName);

      if (!result.success) {
        showError(t('skills.menu.openFolderFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('skills.menu.openFolderFailed', { error: errorMessage }));
    }

    onClose();
  };

  return (
    <div
      ref={skillMenuRef}
      className="dropdown-menu skill-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      {/* Only show "Open in File Explorer/Finder/File Manager" in dev mode */}
      {isDev && (
        <button
          className="dropdown-menu-item"
          onClick={handleOpenInExplorer}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><FolderOpen size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{getOpenInExplorerText()}</span>
        </button>
      )}
      {!isBuiltin && (
        <button
          className="dropdown-menu-item"
          onClick={handleUpdate}
          role="menuitem"
          title={t('skills.menu.updateFromDeviceTitle')}
        >
          <span className="dropdown-menu-item-icon"><RefreshCw size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{t('skills.menu.updateFromDevice')}</span>
        </button>
      )}
      {/* Built-in skills cannot be deleted */}
      {!isBuiltin && (
        <button
          className="dropdown-menu-item danger"
          onClick={handleDelete}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Trash2 size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">{t('common.delete')}</span>
        </button>
      )}
    </div>
  );
};

export default SkillDropdownMenu;