import React, { useState, useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { BRAND_NAME } from '@shared/constants/branding';
import { profileDataManager } from '@renderer/lib/userData';

// Windows title bar height constant (must match WindowsTitleBar.css)
const WINDOWS_TITLE_BAR_HEIGHT = 40;

// Load app icon dynamically based on brand
let appIcon: string;
try {
  const iconModule = require(`../../assets/${BRAND_NAME}/app.svg`);
  appIcon = iconModule.default || iconModule;
} catch (error) {
  console.error(`[FRE][Tutorial] Failed to load app icon for brand ${BRAND_NAME}:`, error);
  appIcon = '';
}

// Local video relative path (under userData/assets/videos/)
const LOCAL_VIDEO_RELATIVE_PATH = 'assets/videos/intro-fre-video.mp4';

export interface FreFirstAgentTutorialViewProps {
  /** Called when user clicks "Create Your First Project Agent" */
  onCreateAgent: () => void;
  /** Called when user clicks "I'll explore on my own" - should update freDone */
  onExploreOnOwn: () => void;
  /** Is Windows platform (for title bar offset) */
  isWindows: boolean;
}

/**
 * Sparkle Icon Component for button
 * Renders the sparkle/star icon used in buttons
 */
const SparkleIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = '#FFFFFF' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Main star shape */}
    <path
      d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Top right small sparkle */}
    <path
      d="M20 3L20 5"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M18 4L22 4"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Bottom left small sparkle */}
    <path
      d="M4 17L4 20"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M3 18L6 18"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * FRE First Agent Creation Tutorial View Component
 * Shows welcome dialog for users after setup completion
 * 
 * This view presents:
 * - Welcome message and product description
 * - Embedded video player
 * - Two action buttons: Create Agent or Explore on Own
 */
const FreFirstAgentTutorialView: React.FC<FreFirstAgentTutorialViewProps> = ({
  onCreateAgent,
  onExploreOnOwn,
  isWindows,
}) => {
  // State for local video URL
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoError, setVideoError] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Feature list items - hidden in current design
  const features: string[] = [];

  // Load local video URL on mount
  useEffect(() => {
    const loadVideoUrl = async () => {
      try {
        // Get userData path from main process
        const userDataPath = await window.electronAPI?.getUserDataPath?.();
        if (userDataPath) {
          // Construct file:// URL for local video
          // On Windows, convert backslashes to forward slashes
          const fullPath = `${userDataPath}/${LOCAL_VIDEO_RELATIVE_PATH}`;
          const normalizedPath = fullPath.replace(/\\/g, '/');
          
          // Build file:// URL with proper handling for Windows drive letters
          // Windows paths like "C:/..." need file:/// prefix (3 slashes)
          // Mac/Linux paths like "/Users/..." need file:// prefix (2 slashes)
          const isWindowsAbsolutePath = /^[A-Za-z]:/.test(normalizedPath);
          
          // Encode path segments but preserve drive letter colon on Windows
          let encodedPath: string;
          if (isWindowsAbsolutePath) {
            // For Windows: keep drive letter (e.g., "C:") unencoded, encode the rest
            const driveLetter = normalizedPath.substring(0, 2); // "C:"
            const restOfPath = normalizedPath.substring(2); // "/Users/..."
            const encodedRest = restOfPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
            encodedPath = driveLetter + encodedRest;
          } else {
            // For Mac/Linux: encode all segments
            encodedPath = normalizedPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
          }
          
          // Windows needs file:/// (3 slashes), Mac/Linux needs file:// (2 slashes)
          const fileUrl = isWindowsAbsolutePath ? `file:///${encodedPath}` : `file://${encodedPath}`;
          console.log('[FRE][Tutorial] Local video URL:', fileUrl);
          setVideoUrl(fileUrl);
        } else {
          console.error('[FRE][Tutorial] Failed to get userData path');
          setVideoError(true);
        }
      } catch (error) {
        console.error('[FRE][Tutorial] Error loading video URL:', error);
        setVideoError(true);
      }
    };

    loadVideoUrl();
  }, []);

  // Handle "Create Your First Project Agent" button
  const handleCreateAgent = () => {
    console.log('[FRE][Tutorial] Create Agent button clicked');
    // Business logic is left empty for now
    onCreateAgent();
  };

  // Handle "I'll explore on my own" button
  const handleExploreOnOwn = async () => {
    console.log('[FRE][Tutorial] Explore on own button clicked');
    
    // Update freDone to true
    try {
      const userAlias = profileDataManager.getCurrentUserAlias();
      if (userAlias && window.electronAPI?.profile?.updateFreDone) {
        await window.electronAPI.profile.updateFreDone(userAlias, true);
        console.log('[FRE][Tutorial] freDone updated to true');
      }
    } catch (error) {
      console.error('[FRE][Tutorial] Error updating freDone:', error);
    }
    
    onExploreOnOwn();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        WebkitAppRegion: 'no-drag',
        paddingTop: isWindows ? `${WINDOWS_TITLE_BAR_HEIGHT}px` : 0,
      } as React.CSSProperties}
    >
      {/* Main Dialog Container */}
      <div
        style={{
          position: 'relative',
          width: '1180px',
          height: '647px',
          background: '#FFFFFF',
          boxShadow: '0px 16px 64px rgba(0, 0, 0, 0.25)',
          borderRadius: '24px',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* Left Side - Video Section */}
        <div
          style={{
            width: '776.8px',
            height: '100%',
            background: 'linear-gradient(180deg, #F5F1ED 0%, #E8E3DF 100%)',
            position: 'relative',
            flexShrink: 0,
            borderRadius: '24px 0 0 24px',
          }}
        >
          {/* Video Container with HTML5 video player */}
          <div
            style={{
              position: 'absolute',
              width: '712.8px',
              height: '400.8px',
              left: '32px',
              top: '123px',
              background: '#272320',
              borderRadius: '16px',
              overflow: 'hidden',
            }}
          >
            {/* Local Video Player */}
            {videoUrl && !videoError ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                onError={(e) => {
                  console.error('[FRE][Tutorial] Video load error:', e);
                  setVideoError(true);
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  borderRadius: '16px',
                  display: 'block',
                  objectFit: 'cover',
                }}
              />
            ) : (
              /* Fallback when video not available */
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '12px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <Sparkles size={48} />
                <span style={{ fontSize: '14px' }}>
                  {videoError ? 'Video unavailable' : 'Loading video...'}
                </span>
              </div>
            )}
            
            {/* Border overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: '1px solid rgba(0, 0, 0, 0.15)',
                borderRadius: '16px',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
        
        {/* Right Side - Content Section */}
        <div
          style={{
            flex: 1,
            padding: '40px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {/* App Icon */}
          <div
            style={{
              width: '48px',
              height: '48px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {appIcon ? (
              <img
                src={appIcon}
                alt="Kosmos"
                style={{
                  width: '48px',
                  height: '48px',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <Sparkles size={32} color="#272320" />
            )}
          </div>
          
          {/* Title - Three lines */}
          <div
            style={{
              marginBottom: '12px',
            }}
          >
            <h1
              style={{
                fontFamily: "'Segoe UI', sans-serif",
                fontWeight: 600,
                fontSize: '26px',
                lineHeight: '32px',
                color: '#272320',
                margin: 0,
              }}
            >
              Your Context.
            </h1>
            <h1
              style={{
                fontFamily: "'Segoe UI', sans-serif",
                fontWeight: 600,
                fontSize: '26px',
                lineHeight: '32px',
                color: '#272320',
                margin: 0,
              }}
            >
              Your Agent.
            </h1>
            <h1
              style={{
                fontFamily: "'Segoe UI', sans-serif",
                fontWeight: 600,
                fontSize: '26px',
                lineHeight: '32px',
                color: '#272320',
                margin: 0,
              }}
            >
              Your Best Work.
            </h1>
          </div>
          
          {/* Description */}
          <p
            style={{
              fontFamily: "'Segoe UI', sans-serif",
              fontWeight: 400,
              fontSize: '15px',
              lineHeight: '24px',
              color: '#4C4642',
              margin: 0,
              marginBottom: '24px',
              maxWidth: '323px',
            }}
          >
            The first AI workspace built specifically for Product Managers. Give your project docs as context, get a persistent Coworker that understands you, reasons with you and works for you.
          </p>
          
          {/* Feature List */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginBottom: 'auto',
            }}
          >
            {features.map((feature, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                {/* Black Dot - aligned with system color */}
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    background: '#272320',
                    borderRadius: '50%',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "'Segoe UI', sans-serif",
                    fontWeight: 400,
                    fontSize: '14px',
                    lineHeight: '21px',
                    color: '#4C4642',
                  }}
                >
                  {feature}
                </span>
              </div>
            ))}
          </div>
          
          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginTop: '24px',
            }}
          >
            {/* Primary Button - Create Your First Project Agent (System Primary Style) */}
            <button
              onClick={handleCreateAgent}
              style={{
                width: '100%',
                height: '56px',
                background: '#272320',
                border: 'none',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.8)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#272320';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.9)';
                e.currentTarget.style.transform = 'translateY(1px)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.8)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <SparkleIcon size={20} color="#FFFFFF" />
              <span
                style={{
                  fontFamily: "'Segoe UI', sans-serif",
                  fontWeight: 600,
                  fontSize: '16px',
                  lineHeight: '24px',
                  color: '#FFFFFF',
                }}
              >
                Create Your First Project Agent
              </span>
            </button>
            
            {/* Secondary Button - I'll explore on my own (System Secondary Style) */}
            <button
              onClick={handleExploreOnOwn}
              style={{
                width: '100%',
                height: '48px',
                background: '#FFFFFF',
                border: '1px solid #272320',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#FFFFFF';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.1)';
                e.currentTarget.style.transform = 'translateY(1px)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.background = 'rgba(39, 35, 32, 0.05)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span
                style={{
                  fontFamily: "'Segoe UI', sans-serif",
                  fontWeight: 600,
                  fontSize: '15px',
                  lineHeight: '22px',
                  color: '#272320',
                }}
              >
                I'll explore on my own
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FreFirstAgentTutorialView;
