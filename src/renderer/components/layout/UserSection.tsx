import React from 'react';
import { userMenuVisibleAtom } from './UserMenu';
import '../../styles/UserSection.css';
import { BuddyEntryButton } from '../buddy';
import { useAuthContext } from '../auth/AuthProvider';


const UserSection: React.FC = () => {
  const { authData } = useAuthContext();
  const user = authData?.ghcAuth?.user;
  const userDisplayName = user?.name || user?.login || authData?.ghcAuth?.alias || 'Unknown User';
  const userAvatarUrl = user?.avatarUrl;
  const setUserMenuVisible = userMenuVisibleAtom.useChange();

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
    </div>
  );
};

export default UserSection;
