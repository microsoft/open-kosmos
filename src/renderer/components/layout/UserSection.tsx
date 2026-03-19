import React from 'react';
import { AuthData } from '../../types/authTypes';
import '../../styles/UserSection.css';

interface UserSectionProps {
  authData: AuthData | null;
  onLogout: () => void;
  onUserMenuToggle: () => void;
  isUserMenuOpen: boolean;
}

const UserSection: React.FC<UserSectionProps> = ({
  authData,
  onUserMenuToggle,
}) => {
  const user = authData?.ghcAuth?.user;
  const userDisplayName = user?.name || user?.login || authData?.ghcAuth?.alias || 'Unknown User';
  const userAvatarUrl = user?.avatarUrl;

  return (
    <div className="user-section">
      {/* Profile Button */}
      <button
        className="profile-icon-button"
        onClick={onUserMenuToggle}
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
    </div>
  );
};

export default UserSection;