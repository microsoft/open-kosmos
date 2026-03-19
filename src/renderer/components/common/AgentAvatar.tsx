import React, { useState, useMemo } from 'react';

interface AgentAvatarProps {
  /** Agent emoji */
  emoji?: string;
  /** Agent avatar URL */
  avatar?: string;
  /** Agent name (used to generate initials as fallback) */
  name?: string;
  /** Avatar size */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS class name */
  className?: string;
  /** Agent version (for cache busting, ensures latest image on version update) */
  version?: string;
}

/**
 * Generic component for rendering Agent avatars
 *
 * Rendering rules:
 * - If avatar URL is provided and loads successfully, renders the avatar image
 * - Otherwise renders emoji, falling back to initials
 */
export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  emoji = '🤖',
  avatar,
  name,
  size = 'md',
  className = '',
  version
}) => {
  const [imageError, setImageError] = useState(false);

  /**
   * Generate image URL with version parameter (for cache busting)
   * When the agent version is updated, URL parameter changes and browser fetches the latest image
   */
  const avatarUrlWithVersion = useMemo(() => {
    if (!avatar) return avatar;
    if (!version) return avatar;
    
    const separator = avatar.includes('?') ? '&' : '?';
    return `${avatar}${separator}_v=${encodeURIComponent(version)}`;
  }, [avatar, version]);

  /**
   * Generate initials from name as fallback
   */
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * Return image/container dimensions in pixels based on size
   */
  const getPixelSize = (): number => {
    switch (size) {
      case 'sm':
        return 20;  // Matches emoji text size
      case 'lg':
        return 32;
      case 'md':
      default:
        return 24;
    }
  };

  /**
   * Return emoji text size styles based on size
   */
  const getEmojiSizeStyles = (): string => {
    switch (size) {
      case 'sm':
        return 'text-xl';  // 20px
      case 'lg':
        return 'text-3xl'; // 30px
      case 'md':
      default:
        return 'text-2xl'; // 24px
    }
  };

  // Determine whether to render image avatar
  // Render image if avatar is provided and no image error
  const shouldRenderAvatar = avatar && !imageError;

  const pixelSize = getPixelSize();

  if (shouldRenderAvatar) {
    return (
      <img
        src={avatarUrlWithVersion}
        alt={name || 'Agent Avatar'}
        style={{ width: pixelSize, height: pixelSize }}
        className={`agent-avatar-img object-contain flex-shrink-0 ${className}`}
        onError={() => setImageError(true)}
      />
    );
  }

  // Render emoji when avatar is empty/failed to load
  return (
    <span className={`inline-flex items-center justify-center flex-shrink-0 ${getEmojiSizeStyles()} ${className}`}>
      {emoji || getInitials(name || 'AG')}
    </span>
  );
};

export default AgentAvatar;
