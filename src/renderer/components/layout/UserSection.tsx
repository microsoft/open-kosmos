import React from 'react';
import { RotateCw } from 'lucide-react';
import { userMenuVisibleAtom } from './UserMenu';
import DoctorStatusIndicator from '../doctor/DoctorStatusIndicator';
import DoctorInquiry from '../doctor/DoctorInquiry';
import '../../styles/UserSection.css';
import { BuddyEntryButton } from '../buddy';
import { useUpdate } from '../autoUpdate/UpdateProvider';
import { useAuthContext } from '../auth/AuthProvider';


const UserSection: React.FC = () => {
  const { authData } = useAuthContext();
  const user = authData?.ghcAuth?.user;
  const userDisplayName = user?.name || user?.login || authData?.ghcAuth?.alias || 'Unknown User';
  const userAvatarUrl = user?.avatarUrl;
  const setUserMenuVisible = userMenuVisibleAtom.useChange();
  const { status, installUpdate, isDialogOpen } = useUpdate();

  const showUpdateButton = status === 'downloaded' && !isDialogOpen;
  const onInstallUpdate = async () => {
    try {
      await installUpdate();
    } catch (error) {}
  };

  return (
    <div className="user-section">
      {/* Profile Button */}
      <button
        className="profile-icon-button"
        onClick={() => setUserMenuVisible((prev) => !prev)}
        title={userDisplayName}
        aria-label="User menu"
        type="button"
      >
        {userAvatarUrl ? (
          <img
            src={userAvatarUrl}
            alt={userDisplayName}
            className="profile-avatar"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="profile-fallback" aria-hidden="true">
            👤
          </span>
        )}
      </button>

      {/* Buddy Egg Icon */}
      <BuddyEntryButton />

      {/* Install Update Button */}
      {showUpdateButton && (
        <button
          className="restart-update-button"
          onClick={onInstallUpdate}
          title="Click to install the latest update"
          aria-label="Install Update Now"
          type="button"
        >
          <RotateCw className="restart-update-icon" />
          <span className="restart-update-text">Install Update Now</span>
        </button>
      )}

      {/* Doctor Status Indicator — right-aligned */}
      <div style={{ marginLeft: 'auto', display: 'inline-flex' }}>
        <DoctorStatusIndicator />
      </div>

      {/* Doctor inquiry dialog (mounted globally so state survives menu close) */}
      <DoctorInquiry />
    </div>
  );
};

export default UserSection;