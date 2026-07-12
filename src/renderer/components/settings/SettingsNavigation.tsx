import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Terminal, Globe, Archive, Brain, Code2, MonitorCog, SunMoon, Languages } from 'lucide-react';
import NavItem from '../ui/navigation/NavItem';
import HooksIcon from '../agentHooks/HooksIcon';
import '../../styles/LeftNavigation.css';
import { useFeatureFlag } from '../../lib/featureFlags';
import { LeftNavSizeAtom } from '@renderer/states/left-nav.atom';
import { useI18n } from '../../lib/i18n/useI18n';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';

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
      <path d="M10.5416 8.60759L11.642 6.37799C11.8907 5.874 12.6094 5.874 12.8581 6.37799L13.9585 8.60759L16.419 8.96512C16.9752 9.04594 17.1972 9.72944 16.7948 10.1217L15.0143 11.8572L15.4347 14.3078C15.5297 14.8617 14.9482 15.2842 14.4508 15.0226L12.25 13.8656L10.0493 15.0226C9.55182 15.2842 8.9704 14.8617 9.06541 14.3078L9.48571 11.8572L7.70527 10.1217C7.30281 9.72944 7.5249 9.04594 8.08108 8.96512L10.5416 8.60759ZM11.6 9.52747C11.5012 9.72761 11.3103 9.86633 11.0894 9.89842L9.6358 10.1096L10.6876 11.1349C10.8474 11.2907 10.9204 11.5152 10.8826 11.7351L10.6343 13.1829L11.9345 12.4993C12.132 12.3955 12.368 12.3955 12.5656 12.4993L13.8657 13.1829L13.6174 11.7351C13.5797 11.5152 13.6526 11.2907 13.8124 11.1349L14.8643 10.1096L13.4107 9.89842C13.1898 9.86633 12.9989 9.72761 12.9001 9.52747L12.25 8.21029L11.6 9.52747ZM6.5 2C5.11929 2 4 3.11929 4 4.5V19.5C4 20.8807 5.11929 22 6.5 22H19.75C20.1642 22 20.5 21.6642 20.5 21.25C20.5 20.8358 20.1642 20.5 19.75 20.5H6.5C5.94772 20.5 5.5 20.0523 5.5 19.5H19.75C20.1642 19.5 20.5 19.1642 20.5 18.75V4.5C20.5 3.11929 19.3807 2 18 2H6.5ZM19 18H5.5V4.5C5.5 3.94772 5.94772 3.5 6.5 3.5H18C18.5523 3.5 19 3.94772 19 4.5V18Z" fill="var(--color-neutral-800)"/>
    </mask>
    <g mask="url(#mask0_settings_skills)">
      <rect width="24" height="24" fill="currentColor"/>
    </g>
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

interface SettingsNavigationProps {
  onBack?: () => void;
}

const SettingsNavigation: React.FC<SettingsNavigationProps> = ({ onBack }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();

  // Voice Input feature controlled by feature flag
  const voiceInputEnabled = useFeatureFlag('openkosmosFeatureVoiceInput');

  const screenshotEnabled = useFeatureFlag('openkosmosFeatureScreenshot');

  // Sync feature controlled by feature flag
  const syncEnabled = useFeatureFlag('openkosmosUseSync');

  const { width } = LeftNavSizeAtom.useData();

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
    if (path.includes('/settings/appearance')) return 'appearance';
    if (path.includes('/settings/runtime')) return 'runtime';
    if (path.includes('/settings/mcp')) return 'mcp';
    if (path.includes('/settings/skills')) return 'skills';
    if (path.includes('/settings/agent-hooks')) return 'agent-hooks';
    if (path.includes('/settings/voice-input')) return 'voice-input';
    if (path.includes('/settings/screenshot')) return 'screenshot';
    if (path.includes('/settings/browser')) return 'browser';
    if (path.includes('/settings/memex')) return 'memex';
    if (path.includes('/settings/computer-use')) return 'computer-use';
    if (path.includes('/settings/sync')) return 'sync';
    if (path.includes('/settings/language')) return 'language';
    if (path.includes('/settings/about')) return 'about';
    if (path.includes('/settings/coding-cli')) return 'coding-cli';
    if (path.includes('/settings/archived-agents')) return 'archived-agents';
    return 'mcp'; // Default: show mcp
  };

  const activeView = getActiveView();
  const productName = BRAND_CONFIG.productName || APP_NAME;

  const dividerStyle = (position: 'top' | 'bottom'): React.CSSProperties => ({
    backgroundImage: 'linear-gradient(to right, var(--settings-nav-divider-line) 0%, var(--settings-nav-divider-line) 75%, transparent 100%)',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 1px',
    backgroundPosition: position,
  });

  return (
    <nav
      className="left-navigation"
      role="navigation"
      aria-label={t('settings.navigation.ariaLabel')}
      style={{ width }}
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
            ...dividerStyle('bottom'),
          }}
        >
          <h2
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: 'var(--settings-nav-heading-fg)',
              margin: 0,
            }}
          >
            {t('common.settings')}
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
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarWidth: 'none',
          }}
        >
          <NavItem
            icon={<SunMoon size={18} />}
            label={t('settings.navigation.appearance')}
            isActive={activeView === 'appearance'}
            onClick={() => navigate('/settings/appearance')}
            ariaLabel={t('settings.navigation.appearanceAriaLabel')}
          />

          <NavItem
            icon={<McpIcon />}
            label="MCP"
            isActive={activeView === 'mcp'}
            onClick={() => navigate('/settings/mcp')}
            ariaLabel={t('settings.navigation.mcpAriaLabel')}
          />

          <NavItem
            icon={<SkillsIcon />}
            label={t('settings.navigation.skills')}
            isActive={activeView === 'skills'}
            onClick={() => navigate('/settings/skills')}
            ariaLabel={t('settings.navigation.skillsAriaLabel')}
          />

          <NavItem
            icon={<HooksIcon size={20} />}
            label={t('settings.navigation.hooks')}
            isActive={activeView === 'agent-hooks'}
            onClick={() => navigate('/settings/agent-hooks')}
            ariaLabel={t('settings.navigation.hooksAriaLabel')}
          />

          <NavItem
            icon={<Terminal size={20} />}
            label={t('settings.navigation.runtime')}
            isActive={activeView === 'runtime'}
            onClick={() => navigate('/settings/runtime')}
            ariaLabel={t('settings.navigation.runtimeAriaLabel')}
          />

          {/* Coding CLI entry — gated at runtime by the per-profile master switch */}
          <NavItem
            icon={<Code2 size={18} />}
            label={t('settings.navigation.codingCli')}
            isActive={activeView === 'coding-cli'}
            onClick={() => navigate('/settings/coding-cli')}
            ariaLabel={t('settings.navigation.codingCliAriaLabel')}
          />

          {/* Voice Input entry controlled by feature flag */}
          {voiceInputEnabled && (
            <NavItem
              icon={<VoiceIcon />}
              label={t('settings.navigation.voiceInput')}
              isActive={activeView === 'voice-input'}
              onClick={() => navigate('/settings/voice-input')}
              ariaLabel={t('settings.navigation.voiceInputAriaLabel')}
            />
          )}

          {screenshotEnabled && (
            <NavItem
              icon={<Camera size={18} />}
              label={t('settings.navigation.screenshot')}
              isActive={activeView === 'screenshot'}
              onClick={() => navigate('/settings/screenshot')}
              ariaLabel={t('settings.navigation.screenshotAriaLabel')}
            />
          )}

          <NavItem
            icon={<Globe size={18} />}
            label={t('settings.navigation.browser')}
            isActive={activeView === 'browser'}
            onClick={() => navigate('/settings/browser')}
            ariaLabel={t('settings.navigation.browserAriaLabel')}
          />

          <NavItem
            icon={<Brain size={18} />}
            label={t('settings.navigation.memex')}
            isActive={activeView === 'memex'}
            onClick={() => navigate('/settings/memex')}
            ariaLabel={t('settings.navigation.memexAriaLabel')}
          />

          <NavItem
            icon={<MonitorCog size={18} />}
            label={t('settings.navigation.computerUse')}
            isActive={activeView === 'computer-use'}
            onClick={() => navigate('/settings/computer-use')}
            ariaLabel={t('settings.navigation.computerUseAriaLabel')}
          />

          {/* Sync entry controlled by feature flag */}
          {syncEnabled && (
            <NavItem
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 16L7 4M7 4L3 8M7 4L11 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 8L17 20M17 20L21 16M17 20L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              }
              label={t('settings.navigation.sync')}
              isActive={activeView === 'sync'}
              onClick={() => navigate('/settings/sync')}
              ariaLabel={t('settings.navigation.syncAriaLabel')}
            />
          )}

          <NavItem
            icon={<Archive size={20} />}
            label={t('settings.navigation.archivedAgents')}
            isActive={activeView === 'archived-agents'}
            onClick={() => navigate('/settings/archived-agents')}
            ariaLabel={t('settings.navigation.archivedAgentsAriaLabel')}
          />

          <NavItem
            icon={<Languages size={18} />}
            label={t('settings.navigation.language')}
            isActive={activeView === 'language'}
            onClick={() => navigate('/settings/language')}
            ariaLabel={t('settings.navigation.languageAriaLabel')}
          />

          <NavItem
            icon={<AboutIcon />}
            label={t('settings.navigation.about', { productName })}
            isActive={activeView === 'about'}
            onClick={() => navigate('/settings/about')}
            ariaLabel={t('settings.navigation.aboutAriaLabel')}
          />
        </div>

        {/* Bottom Back Button */}
        <div
          style={{
            width: '100%',
            paddingTop: '16px',
            ...dividerStyle('top'),
          }}
        >
          <NavItem
            icon={
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.3544 15.8529C12.1594 16.0485 11.8429 16.0491 11.6472 15.8542L6.16276 10.3892C5.94705 10.1743 5.94705 9.82495 6.16276 9.61L11.6472 4.14502C11.8429 3.95011 12.1594 3.95067 12.3544 4.14628C12.5493 4.34189 12.5487 4.65848 12.3531 4.85339L7.18851 9.99961L12.3531 15.1458C12.5487 15.3407 12.5493 15.6573 12.3544 15.8529Z" fill="currentColor"></path>
              </svg>
            }
            label={t('common.back')}
            isActive={false}
            onClick={handleBack}
            ariaLabel={t('common.back')}
          />
        </div>
      </div>
    </nav>
  );
};

export default SettingsNavigation;
