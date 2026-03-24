import React, { useState, useEffect } from 'react';
import { BRAND_CONFIG, APP_NAME } from '@shared/constants/branding';
import { profileDataManager } from '@renderer/lib/userData';

// Windows title bar height constant (must match WindowsTitleBar.css)
const WINDOWS_TITLE_BAR_HEIGHT = 40;

// Get display name from BRAND_CONFIG, fallback to APP_NAME
const getDisplayName = () => BRAND_CONFIG?.windowTitle || BRAND_CONFIG?.shortcutName || APP_NAME;

/**
 * Agent configuration from agent_lib.json with needs_fre_promotion: true
 */
export interface FrePromotedAgent {
  name: string;
  version: string;
  description: string;
  team?: string;
  contact?: string;
  requirements?: {
    software?: Record<string, string>;
    mcp?: string[];
    skills?: string[];
  };
  configuration?: {
    emoji?: string;
    avatar?: string;
    name?: string;
    workspace?: string;
    model?: string;
    mcp_servers?: Array<{
      name: string;
      tools?: string[];
    }>;
    system_prompt?: string;
    context_enhancement?: any;
    skills?: string[];
    zero_states?: {
      greeting?: string;
      quick_starts?: any[];
    };
  };
  prompts?: {
    setup_agent?: string;
    update_agent?: string;
    setup_requirements?: string;
  };
}

export interface FreWelcomeViewProps {
  onSelectAgent: (agent: FrePromotedAgent) => void;
  onSkip: () => void;
  isWindows: boolean;
}

/**
 * FRE Welcome View Component
 * Displayed when OpenKosmos brand starts and freDone=false
 * Shows promoted agents for user to choose from
 */
const FreWelcomeView: React.FC<FreWelcomeViewProps> = ({
  onSelectAgent,
  onSkip,
  isWindows,
}) => {
  const [promotedAgents, setPromotedAgents] = useState<FrePromotedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredAgentIndex, setHoveredAgentIndex] = useState<number | null>(null);

  // Get user's display name from profile
  const getUserDisplayName = (): string => {
    try {
      // First try to get alias from profileDataManager
      const alias = profileDataManager.getCurrentUserAlias();
      if (alias) {
        return alias;
      }
      
      // Fallback to profile.alias
      const profile = profileDataManager.getProfile();
      if (profile && (profile as any).alias) {
        return (profile as any).alias as string;
      }
    } catch (e) {
      // Ignore errors
    }
    return 'there';
  };

  const userDisplayName = getUserDisplayName();

  // Fetch promoted agents on mount
  useEffect(() => {
    fetchPromotedAgents();
  }, []);

  const fetchPromotedAgents = async () => {
    console.log('[FreWelcomeView] Agent library not available (CDN removed), no promoted agents');
    setIsLoading(false);
    setPromotedAgents([]);
  };

  // Render agent card
  const renderAgentCard = (agent: FrePromotedAgent, index: number) => {
    const isHovered = hoveredAgentIndex === index;
    const logo = agent.configuration?.avatar || '';
    const name = agent.configuration?.name || agent.name;
    const team = agent.team || '';

    return (
      <div
        key={agent.name}
        onClick={() => onSelectAgent(agent)}
        onMouseEnter={() => setHoveredAgentIndex(index)}
        onMouseLeave={() => setHoveredAgentIndex(null)}
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 12px 20px',
          gap: '12px',
          width: '240px',
          height: '334px',
          background: '#FFFFFF',
          border: isHovered ? '1px solid rgba(0, 0, 0, 0.24)' : '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: '36px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          transform: isHovered ? 'translateY(-4px)' : 'none',
          boxShadow: isHovered 
            ? '0 8px 24px rgba(0, 0, 0, 0.12)' 
            : '0 2px 8px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* Logo Container */}
        <div
          style={{
            width: '216px',
            height: '216px',
            position: 'relative',
          }}
        >
          {/* Background */}
          <div
            style={{
              position: 'absolute',
              width: '216px',
              height: '216px',
              left: 0,
              top: 0,
              background: '#F8F4F1',
              borderRadius: '24px',
            }}
          />
          {/* Logo Image */}
          {logo ? (
            <img
              src={logo}
              alt={name}
              style={{
                position: 'absolute',
                width: '128px',
                height: '128px',
                left: 'calc(50% - 64px)',
                top: 'calc(50% - 64px)',
                objectFit: 'contain',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                width: '128px',
                height: '128px',
                left: 'calc(50% - 64px)',
                top: 'calc(50% - 64px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '64px',
              }}
            >
              {agent.configuration?.emoji || '🤖'}
            </div>
          )}
        </div>

        {/* Text Info Container */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: 0,
            gap: '8px',
            width: '200px',
            height: '74px',
          }}
        >
          {/* Agent Name */}
          <div
            style={{
              width: '200px',
              height: '26px',
              fontFamily: "'Segoe UI Variable', 'Segoe UI', sans-serif",
              fontStyle: 'normal',
              fontWeight: 650,
              fontSize: '18px',
              lineHeight: '26px',
              color: '#272320',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          {/* Team Info */}
          <div
            style={{
              width: '200px',
              height: '40px',
              fontFamily: "'Segoe UI Variable', 'Segoe UI', sans-serif",
              fontStyle: 'normal',
              fontWeight: 410,
              fontSize: '14px',
              lineHeight: '20px',
              color: '#272320',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            A {team} production
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: isWindows ? WINDOWS_TITLE_BAR_HEIGHT : 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(135deg, rgba(255, 251, 248, 0.98) 0%, rgba(255, 255, 255, 0.98) 50%, rgba(248, 244, 241, 0.98) 100%)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      {/* CSS for animations */}
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>

      {/* Main Content Container - Centered and sized per Figma (766x616) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 0,
          gap: '40px',
          width: '766px',
          maxWidth: '90vw',
          animation: 'fadeIn 0.6s ease-out',
        }}
      >
        {/* Top Section: Title + Subtitle + Agent Cards */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 0,
            gap: '64px',
            width: '766px',
            maxWidth: '100%',
          }}
        >
          {/* Title and Subtitle */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 0,
              gap: '8px',
              width: '766px',
              maxWidth: '100%',
            }}
          >
            {/* Main Title */}
            <h1
              style={{
                fontFamily: "'Abhaya Libre', Georgia, serif",
                fontStyle: 'normal',
                fontWeight: 700,
                fontSize: '28px',
                lineHeight: '33px',
                textAlign: 'center',
                color: '#322D29',
                margin: 0,
              }}
            >
              Hi {userDisplayName}, welcome to OpenKosmos AI Studio!
            </h1>

            {/* Subtitle */}
            <p
              style={{
                maxWidth: '500px',
                fontFamily: "'Abhaya Libre', Georgia, serif",
                fontStyle: 'normal',
                fontWeight: 400,
                fontSize: '20px',
                lineHeight: '24px',
                textAlign: 'center',
                color: '#322D29',
                margin: 0,
              }}
            >
              Not sure where to start? Try a recommended agent, or skip and explore on your own
            </p>
          </div>

          {/* Agent Cards Container */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              gap: '40px',
              minHeight: '334px',
            }}
          >
            {isLoading ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '520px',
                  height: '334px',
                  color: '#6b7280',
                  fontSize: '16px',
                }}
              >
                Loading agents...
              </div>
            ) : error ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px',
                  width: '520px',
                  height: '334px',
                }}
              >
                <div
                  style={{
                    color: '#ef4444',
                    fontSize: '14px',
                    textAlign: 'center',
                    padding: '12px 20px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                  }}
                >
                  Failed to load agents: {error}
                </div>
                <button
                  onClick={fetchPromotedAgents}
                  style={{
                    padding: '10px 24px',
                    background: '#0ea5e9',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            ) : promotedAgents.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '520px',
                  height: '334px',
                  color: '#6b7280',
                  fontSize: '16px',
                }}
              >
                No agents available
              </div>
            ) : (
              promotedAgents.map((agent, index) => renderAgentCard(agent, index))
            )}
          </div>
        </div>

        {/* Skip Button */}
        <button
          onClick={onSkip}
          style={{
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 24px',
            gap: '6px',
            minWidth: '120px',
            height: '48px',
            minHeight: '48px',
            borderRadius: '24px',
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 1)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.06)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span
            style={{
              fontFamily: "'Segoe UI Variable', 'Segoe UI', sans-serif",
              fontStyle: 'normal',
              fontWeight: 450,
              fontSize: '14px',
              lineHeight: '20px',
              color: '#272320',
            }}
          >
            Skip for now
          </span>
        </button>
      </div>
    </div>
  );
};

export default FreWelcomeView;
