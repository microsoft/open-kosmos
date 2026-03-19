import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Terminal } from 'lucide-react';
import NavItem from '../ui/navigation/NavItem';
import '../../styles/LeftNavigation.css';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import { useFeatureFlag } from '../../lib/featureFlags';

// MCP icon - from McpHeaderView
const McpIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.4899 5.57084C20.2797 6.58684 20.75 7.8635 20.75 9.25001C20.75 11.5333 19.4746 13.5187 17.5974 14.5327C16.9482 14.8833 16.1672 14.6672 15.6455 14.1455L9.8545 8.35451C9.3328 7.8328 9.11672 7.05181 9.46735 6.40265C10.4813 4.52541 12.4667 3.25001 14.75 3.25001C16.1366 3.25001 17.4133 3.72034 18.4293 4.51016L20.7198 2.21967C21.0127 1.92678 21.4876 1.92678 21.7805 2.21967C22.0733 2.51256 22.0733 2.98744 21.7805 3.28033L19.4899 5.57084ZM17.4733 12.8331C18.5535 12.0106 19.25 10.7106 19.25 9.25001C19.25 6.76473 17.2353 4.75001 14.75 4.75001C13.2894 4.75001 11.9894 5.44648 11.1669 6.52671C10.901 6.87593 10.9813 7.35998 11.2917 7.67036L16.3297 12.7083C16.64 13.0187 17.1241 13.0991 17.4733 12.8331ZM3.28045 21.7803L5.57085 19.4899C6.58685 20.2797 7.86351 20.75 9.25001 20.75C11.5333 20.75 13.5187 19.4746 14.5327 17.5973C14.8833 16.9482 14.6672 16.1672 14.1455 15.6455L8.3545 9.85448C7.8328 9.33278 7.0518 9.1167 6.40265 9.46733C4.5254 10.4813 3.25001 12.4667 3.25001 14.75C3.25001 16.1366 3.72034 17.4133 4.51017 18.4293L2.21979 20.7197C1.9269 21.0126 1.9269 21.4874 2.21979 21.7803C2.51269 22.0732 2.98756 22.0732 3.28045 21.7803ZM7.67035 11.2917L12.7083 16.3296C13.0187 16.64 13.0991 17.1241 12.8331 17.4733C12.0106 18.5535 10.7106 19.25 9.25001 19.25C6.76473 19.25 4.75001 17.2353 4.75001 14.75C4.75001 13.2894 5.44648 11.9894 6.52671 11.1669C6.87593 10.9009 7.35997 10.9813 7.67035 11.2917Z" fill="currentColor"/>
  </svg>
);

// Skills icon - from SkillsHeaderView
const SkillsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <mask id="mask0_settings_skills" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <path d="M10.5416 8.60759L11.642 6.37799C11.8907 5.874 12.6094 5.874 12.8581 6.37799L13.9585 8.60759L16.419 8.96512C16.9752 9.04594 17.1972 9.72944 16.7948 10.1217L15.0143 11.8572L15.4347 14.3078C15.5297 14.8617 14.9482 15.2842 14.4508 15.0226L12.25 13.8656L10.0493 15.0226C9.55182 15.2842 8.9704 14.8617 9.06541 14.3078L9.48571 11.8572L7.70527 10.1217C7.30281 9.72944 7.5249 9.04594 8.08108 8.96512L10.5416 8.60759ZM11.6 9.52747C11.5012 9.72761 11.3103 9.86633 11.0894 9.89842L9.6358 10.1096L10.6876 11.1349C10.8474 11.2907 10.9204 11.5152 10.8826 11.7351L10.6343 13.1829L11.9345 12.4993C12.132 12.3955 12.368 12.3955 12.5656 12.4993L13.8657 13.1829L13.6174 11.7351C13.5797 11.5152 13.6526 11.2907 13.8124 11.1349L14.8643 10.1096L13.4107 9.89842C13.1898 9.86633 12.9989 9.72761 12.9001 9.52747L12.25 8.21029L11.6 9.52747ZM6.5 2C5.11929 2 4 3.11929 4 4.5V19.5C4 20.8807 5.11929 22 6.5 22H19.75C20.1642 22 20.5 21.6642 20.5 21.25C20.5 20.8358 20.1642 20.5 19.75 20.5H6.5C5.94772 20.5 5.5 20.0523 5.5 19.5H19.75C20.1642 19.5 20.5 19.1642 20.5 18.75V4.5C20.5 3.11929 19.3807 2 18 2H6.5ZM19 18H5.5V4.5C5.5 3.94772 5.94772 3.5 6.5 3.5H18C18.5523 3.5 19 3.94772 19 4.5V18Z" fill="#242424"/>
    </mask>
    <g mask="url(#mask0_settings_skills)">
      <rect width="24" height="24" fill="currentColor"/>
    </g>
  </svg>
);

// Memory icon - from MemoryHeaderView
const MemoryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.5 2C16.1405 2 17.4964 3.21548 17.7178 4.79492C19.5765 5.08024 21 6.68645 21 8.625C21 9.72785 20.5383 10.7221 19.7988 11.4277C21.1042 12.0863 22 13.4381 22 15V15.25C22 17.2437 20.5412 18.8958 18.6328 19.1992C18.2015 20.8129 16.7319 21.9998 15.0059 22C13.7782 22 12.686 21.4091 12 20.4961C11.314 21.4091 10.2218 22 8.99414 22C7.26809 21.9998 5.79853 20.8129 5.36719 19.1992C3.45883 18.8958 2 17.2437 2 15.25V15C2 13.4384 2.89526 12.0865 4.2002 11.4277C3.46102 10.7221 3 9.7276 3 8.625C3 6.68645 4.42349 5.08024 6.28223 4.79492C6.50358 3.21548 7.85955 2 9.5 2C10.5054 2 11.4038 2.45677 12 3.17383C12.5962 2.45677 13.4946 2 14.5 2ZM9.5 3.5C8.5335 3.5 7.75 4.2835 7.75 5.25V5.5C7.75 5.91421 7.41421 6.25 7 6.25H6.875C5.56332 6.25 4.5 7.31332 4.5 8.625C4.5 9.93668 5.56332 11 6.875 11H7.25C7.66421 11 8 11.3358 8 11.75C8 12.1642 7.66421 12.5 7.25 12.5H6.875C6.84659 12.5 6.8183 12.4977 6.79004 12.4971C6.77675 12.4978 6.76346 12.5 6.75 12.5H6C4.61929 12.5 3.5 13.6193 3.5 15V15.25C3.5 16.6307 4.61929 17.75 6 17.75C6.33862 17.7509 6.62814 17.9771 6.71875 18.292L6.74512 18.4316H6.74707C6.85289 19.5956 7.83586 20.4998 8.99414 20.5C10.2385 20.5 11.25 19.4909 11.25 18.25V5.24121C11.2453 4.27876 10.4636 3.5 9.5 3.5ZM14.5 3.5C13.5364 3.5 12.7547 4.27876 12.75 5.24121V18.25C12.75 19.4909 13.7615 20.5 15.0059 20.5C16.1641 20.4998 17.1471 19.5956 17.2529 18.4316H17.2549L17.2812 18.292C17.3719 17.9771 17.6614 17.7509 18 17.75C19.3807 17.75 20.5 16.6307 20.5 15.25V15C20.5 13.6193 19.3807 12.5 18 12.5H17.25C17.2362 12.5 17.2226 12.4978 17.209 12.4971C17.181 12.4977 17.1531 12.5 17.125 12.5H16.75C16.3358 12.5 16 12.1642 16 11.75C16 11.3358 16.3358 11 16.75 11H17.125C18.4367 11 19.5 9.93668 19.5 8.625C19.5 7.31332 18.4367 6.25 17.125 6.25H17C16.5858 6.25 16.25 5.91421 16.25 5.5V5.25C16.25 4.2835 15.4665 3.5 14.5 3.5Z" fill="currentColor"/>
  </svg>
);

// About icon
const AboutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM3.5 12C3.5 7.30558 7.30558 3.5 12 3.5C16.6944 3.5 20.5 7.30558 20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C7.30558 20.5 3.5 16.6944 3.5 12ZM12 7.75C12.4142 7.75 12.75 8.08579 12.75 8.5V12.75C12.75 13.1642 12.4142 13.5 12 13.5C11.5858 13.5 11.25 13.1642 11.25 12.75V8.5C11.25 8.08579 11.5858 7.75 12 7.75ZM13 16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16C11 15.4477 11.4477 15 12 15C12.5523 15 13 15.4477 13 16Z" fill="currentColor"/>
  </svg>
);

// Voice/Microphone icon
const VoiceIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C10.3431 2 9 3.34315 9 5V12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12V5C15 3.34315 13.6569 2 12 2ZM10.5 5C10.5 4.17157 11.1716 3.5 12 3.5C12.8284 3.5 13.5 4.17157 13.5 5V12C13.5 12.8284 12.8284 13.5 12 13.5C11.1716 13.5 10.5 12.8284 10.5 12V5ZM6.25 10C6.66421 10 7 10.3358 7 10.75V12C7 14.7614 9.23858 17 12 17C14.7614 17 17 14.7614 17 12V10.75C17 10.3358 17.3358 10 17.75 10C18.1642 10 18.5 10.3358 18.5 10.75V12C18.5 15.3137 16.0376 18.0299 12.75 18.4435V21.25C12.75 21.6642 12.4142 22 12 22C11.5858 22 11.25 21.6642 11.25 21.25V18.4435C7.96243 18.0299 5.5 15.3137 5.5 12V10.75C5.5 10.3358 5.83579 10 6.25 10Z" fill="currentColor"/>
  </svg>
);

// Browser icon - for Browser Control settings
const BrowserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M21.17 8H12" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3.95 6.06L8.54 14" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10.88 21.94L15.46 14" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

interface SettingsNavigationProps {
  onBack?: () => void;
}

const SettingsNavigation: React.FC<SettingsNavigationProps> = ({ onBack }) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Memory controlled by feature flag (Dev environment and non-Windows ARM)
  const memoryEnabled = useFeatureFlag('kosmosFeatureMemory');

  // Chrome Extension / Browser Control entry (controlled by feature flag, Dev + Windows only)
  const browserControlEnabled = useFeatureFlag('browserControl');

  // Voice Input controlled by feature flag
  const voiceInputEnabled = useFeatureFlag('kosmosFeatureVoiceInput');

  const screenshotEnabled = useFeatureFlag('kosmosFeatureScreenshot');

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      // Default: navigate back to agent page
      navigate('/agent/chat');
    }
  };

  const getActiveView = () => {
    const path = location.pathname;
    if (path.includes('/settings/runtime')) return 'runtime';
    if (path.includes('/settings/mcp')) return 'mcp';
    if (path.includes('/settings/skills')) return 'skills';
    if (path.includes('/settings/memory')) return 'memory';
    if (path.includes('/settings/voice-input')) return 'voice-input';
    if (path.includes('/settings/screenshot')) return 'screenshot';
    if (path.includes('/settings/about')) return 'about';
    if (path.includes('/settings/browser-control')) return 'browser-control';
    return 'mcp'; // Default to mcp
  };

  const activeView = getActiveView();

  return (
    <nav
      className="left-navigation"
      role="navigation"
      aria-label="Settings navigation"
    >
      {/* Settings Navigation Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          padding: '0px',
          gap: '16px',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Header with Settings title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            height: '52px',
            paddingBottom: '12px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          <h2
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#111827',
              margin: 0,
            }}
          >
            Settings
          </h2>
        </div>

        {/* Navigation Items */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '8px',
            width: '100%',
            flex: 1,
          }}
        >
          <NavItem
            icon={<McpIcon />}
            label="MCP"
            isActive={activeView === 'mcp'}
            onClick={() => navigate('/settings/mcp')}
            ariaLabel="MCP Servers and Tools"
          />
          
          <NavItem
            icon={<SkillsIcon />}
            label="Skills"
            isActive={activeView === 'skills'}
            onClick={() => navigate('/settings/skills')}
            ariaLabel="Skills Management"
          />
          
          {/* Memory entry only shown in Dev environment */}
          {memoryEnabled && (
            <NavItem
              icon={<MemoryIcon />}
              label="Memory"
              isActive={activeView === 'memory'}
              onClick={() => navigate('/settings/memory')}
              ariaLabel="Memory Management"
            />
          )}

          <NavItem
            icon={<Terminal size={20} />}
            label="Runtime"
            isActive={activeView === 'runtime'}
            onClick={() => navigate('/settings/runtime')}
            ariaLabel="Runtime Environment"
          />
          
          {/* Browser Control entry controlled by feature flag */}
          {browserControlEnabled && (
            <NavItem
              icon={<BrowserIcon />}
              label="Browser Control"
              isActive={activeView === 'browser-control'}
              onClick={() => navigate('/settings/browser-control')}
              ariaLabel="Browser Control Settings"
            />
          )}

          {/* Voice Input entry controlled by feature flag */}
          {voiceInputEnabled && (
            <NavItem
              icon={<VoiceIcon />}
              label="Voice Input"
              isActive={activeView === 'voice-input'}
              onClick={() => navigate('/settings/voice-input')}
              ariaLabel="Voice Input Settings"
            />
          )}

          {screenshotEnabled && (
            <NavItem
              icon={<Camera size={18} />}
              label="Screenshot"
              isActive={activeView === 'screenshot'}
              onClick={() => navigate('/settings/screenshot')}
              ariaLabel="Screenshot Settings"
            />
          )}

          <NavItem
            icon={<AboutIcon />}
            label={`About ${BRAND_CONFIG.productName || APP_NAME}`}
            isActive={activeView === 'about'}
            onClick={() => navigate('/settings/about')}
            ariaLabel={`About ${BRAND_CONFIG.productName || APP_NAME}`}
          />
        </div>

        {/* Bottom Back Button */}
        <div
          style={{
            width: '100%',
            paddingTop: '16px',
            borderTop: '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          <NavItem
            icon={
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.3544 15.8529C12.1594 16.0485 11.8429 16.0491 11.6472 15.8542L6.16276 10.3892C5.94705 10.1743 5.94705 9.82495 6.16276 9.61L11.6472 4.14502C11.8429 3.95011 12.1594 3.95067 12.3544 4.14628C12.5493 4.34189 12.5487 4.65848 12.3531 4.85339L7.18851 9.99961L12.3531 15.1458C12.5487 15.3407 12.5493 15.6573 12.3544 15.8529Z" fill="currentColor"></path>
              </svg>
            }
            label="Back"
            isActive={false}
            onClick={handleBack}
            ariaLabel="Go Back"
          />
        </div>
      </div>
    </nav>
  );
};

export default SettingsNavigation;