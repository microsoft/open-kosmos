import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { useMCPServers } from '../userData/userDataProvider';
import ContextBadge from './ContextBadge';
import { profileDataManager } from '../../lib/userData';
import { resolveChatAgent } from '../../lib/agent';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';
import { useI18n } from '../../lib/i18n/useI18n';

interface StatusBadgesProps {
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
}

interface AvailableToolsBadgeProps {
  onOpenMcpTools?: () => void;
}

const AvailableToolsBadge: React.FC<AvailableToolsBadgeProps> = ({
  onOpenMcpTools
}) => {
  const { t } = useI18n();
  const { servers } = useMCPServers();

  // Get currentChatId from agentChatSessionCacheManager.
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  const [toolsCount, setToolsCount] = useState(0);

  // Subscribe to currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);

  // 🆕 Refactor: use mcpClientCacheManager to get available tools
  const getAvailableToolsCount = (chatId: string): number => {
    const chat = profileDataManager.getChatConfigs().find(c => c.chat_id === chatId);
    const agent = resolveChatAgent(chat);
    if (!chat || !agent) {
      return 0;
    }
    const agentMcpServers = agent.mcp_servers || [];
    const tools = mcpClientCacheManager.getAgentSpecificTools(agentMcpServers);
    return tools.length;
  };

  // Listen to currentChatId and server changes, then calculate the tool count.
  useEffect(() => {
    if (!currentChatId) {
      setToolsCount(0);
      return;
    }

    const count = getAvailableToolsCount(currentChatId);
    setToolsCount(count);
  }, [currentChatId, servers]); // Recalculate when servers change

  // Listen to ProfileDataManager changes, including agent.mcp_servers updates.
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((newData) => {
      if (!currentChatId) {
        return;
      }

      // Recalculate tool count
      const count = getAvailableToolsCount(currentChatId);
      setToolsCount(count);
    });

    return unsubscribe;
  }, [currentChatId]);

  return (
    <Badge
      variant="normal"
      className={`text-xs ${onOpenMcpTools ? 'cursor-pointer' : 'cursor-help'}`}
      title={onOpenMcpTools
        ? t('status.tools.titleManage', { count: toolsCount })
        : t('status.tools.title', { count: toolsCount })}
      onClick={onOpenMcpTools}
    >
      {t('status.tools.label', { count: toolsCount })}
    </Badge>
  );
};

interface AvailableSkillsBadgeProps {
  onOpenSkills?: () => void;
}

const AvailableSkillsBadge: React.FC<AvailableSkillsBadgeProps> = ({
  onOpenSkills
}) => {
  const { t } = useI18n();
  // Get currentChatId from agentChatSessionCacheManager.
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  const [skillsCount, setSkillsCount] = useState(0);

  // Subscribe to currentChatId changes
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);

  // 🆕 Refactor: get actual available skills count (similar to mcpClientCacheManager.getAgentSpecificTools logic)
  // Only count skills that actually exist in the global skills list
  const getAvailableSkillsCount = (chatId: string): number => {
    const chat = profileDataManager.getChatConfigs().find(c => c.chat_id === chatId);
    const agent = resolveChatAgent(chat);
    if (!chat || !agent) {
      return 0;
    }
    const agentSkillNames = agent.skills || [];
    const globalSkills = profileDataManager.getSkills();

    // Filter out missing skills, matching getCurrentAgentSkills behavior.
    const availableSkills = agentSkillNames.filter(skillName =>
      globalSkills.some(s => s.name === skillName)
    );
    return availableSkills.length;
  };

  // Listen to currentChatId changes and get the current Agent's skills.
  useEffect(() => {
    if (!currentChatId) {
      setSkillsCount(0);
      return;
    }

    // Get actual available skills count
    const count = getAvailableSkillsCount(currentChatId);
    setSkillsCount(count);
  }, [currentChatId]);

  // Listen to ProfileDataManager changes, including agent.skills and global skills list updates.
  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe((newData) => {
      if (!currentChatId) return;

      // Recalculate actual available skills count
      const count = getAvailableSkillsCount(currentChatId);
      setSkillsCount(count);
    });

    return unsubscribe;
  }, [currentChatId]);

  return (
    <Badge
      variant="normal"
      className={`text-xs ${onOpenSkills ? 'cursor-pointer' : 'cursor-help'}`}
      title={onOpenSkills
        ? t('status.skills.titleManage', { count: skillsCount })
        : t('status.skills.title', { count: skillsCount })}
      onClick={onOpenSkills}
    >
      {t('status.skills.label', { count: skillsCount })}
    </Badge>
  );
};

export const StatusBadges: React.FC<StatusBadgesProps> = ({
  onOpenMcpTools,
  onOpenSkills
}) => {
  return (
    <div className="status-badges">
      <AvailableSkillsBadge
        onOpenSkills={onOpenSkills}
      />
      <AvailableToolsBadge
        onOpenMcpTools={onOpenMcpTools}
      />
      <ContextBadge />
    </div>
  );
};

export default StatusBadges;