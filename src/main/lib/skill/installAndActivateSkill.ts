import { applySkillToAgents } from './applySkillToAgents';
import { getSkillAvailability } from './skillAvailability';
import { addSkillFromDevice } from './skillDeviceImporter';
import { profileCacheManager } from '../userDataADO';

type SkillSource =
  | { type: 'device-path'; value: string };

type ActivationMode = 'current-agent' | 'selected-agents' | 'all-agents' | 'install-only';

interface SkillActivationTarget {
  chatId: string;
  agentName: string;
}

export interface InstallAndActivateSkillArgs {
  userAlias: string;
  source: SkillSource;
  overwrite?: boolean;
  requestSource?: string;
  activation: {
    mode: ActivationMode;
    chatId?: string;
    agentName?: string;
    targets?: SkillActivationTarget[];
  };
  confirmOverwrite?: (skillName: string) => Promise<boolean>;
}

export type SkillActivationResolution =
  | 'installed_and_callable'
  | 'installed_but_not_applied'
  | 'installed_but_needs_target_selection'
  | 'already_callable'
  | 'failed';

export interface InstallAndActivateSkillResult {
  success: boolean;
  skillName: string;
  install: {
    performed: boolean;
    success: boolean;
    isOverwrite: boolean;
  };
  activation: {
    attempted: boolean;
    success: boolean;
    appliedTargets: SkillActivationTarget[];
    skippedTargets: Array<SkillActivationTarget & { reason: string }>;
  };
  currentChat: {
    chatId?: string;
    agentName?: string;
    callable: boolean;
  };
  resolution: SkillActivationResolution;
  message: string;
  error?: string;
  skillVersion?: string;
  inputType?: 'zip' | 'skill' | 'folder';
}

function resolveCurrentAgentTarget(userAlias: string, chatId?: string, agentName?: string): SkillActivationTarget | null {
  if (!chatId) {
    return null;
  }

  const chatConfig = profileCacheManager.getChatConfig(userAlias, chatId);
  if (!chatConfig) {
    return null;
  }

  if (chatConfig.chat_type === 'single_agent' && chatConfig.agent?.name) {
    return { chatId, agentName: chatConfig.agent.name };
  }

  if (chatConfig.chat_type === 'multi_agent' && agentName) {
    const match = chatConfig.agents?.find(agent => agent.name === agentName);
    if (match) {
      return { chatId, agentName: match.name };
    }
  }

  return null;
}

function buildResult(args: {
  success: boolean;
  skillName: string;
  installSuccess: boolean;
  isOverwrite?: boolean;
  resolution: SkillActivationResolution;
  message: string;
  error?: string;
  skillVersion?: string;
  inputType?: 'zip' | 'skill' | 'folder';
  attempted?: boolean;
  appliedTargets?: SkillActivationTarget[];
  skippedTargets?: Array<SkillActivationTarget & { reason: string }>;
  currentChatId?: string;
  currentAgentName?: string;
  callable?: boolean;
}): InstallAndActivateSkillResult {
  return {
    success: args.success,
    skillName: args.skillName,
    install: {
      performed: true,
      success: args.installSuccess,
      isOverwrite: args.isOverwrite || false,
    },
    activation: {
      attempted: args.attempted || false,
      success: args.appliedTargets ? args.appliedTargets.length > 0 && !(args.skippedTargets || []).some(item => item.reason === 'UPDATE_FAILED') : false,
      appliedTargets: args.appliedTargets || [],
      skippedTargets: args.skippedTargets || [],
    },
    currentChat: {
      chatId: args.currentChatId,
      agentName: args.currentAgentName,
      callable: !!args.callable,
    },
    resolution: args.resolution,
    message: args.message,
    error: args.error,
    skillVersion: args.skillVersion,
    inputType: args.inputType,
  };
}

export async function installAndActivateSkill(
  args: InstallAndActivateSkillArgs,
): Promise<InstallAndActivateSkillResult> {
  let skillName = '';
  let skillVersion: string | undefined;
  let inputType: 'zip' | 'skill' | 'folder' | undefined;
  let isOverwrite = false;

  try {
    if (args.source.type === 'device-path') {
      const installResult = await addSkillFromDevice(args.source.value, args.userAlias, args.confirmOverwrite);
      if (!installResult.success || !installResult.skillName) {
        return buildResult({
          success: false,
          skillName: installResult.skillName || '',
          installSuccess: false,
          resolution: 'failed',
          message: installResult.error || 'Failed to install skill from device.',
          error: installResult.error || 'INSTALL_FAILED',
        });
      }

      skillName = installResult.skillName;
      skillVersion = installResult.skillVersion;
      inputType = installResult.inputType;
      isOverwrite = !!installResult.isOverwrite;
    }

    const availabilityBeforeApply = getSkillAvailability({
      userAlias: args.userAlias,
      skillName,
      chatId: args.activation.chatId,
      agentName: args.activation.agentName,
    });

    if (args.activation.mode === 'install-only') {
      return buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        currentChatId: args.activation.chatId,
        currentAgentName: availabilityBeforeApply.currentAgentName,
        callable: availabilityBeforeApply.callableInCurrentChat,
        resolution: availabilityBeforeApply.callableInCurrentChat ? 'already_callable' : 'installed_but_not_applied',
        message: availabilityBeforeApply.callableInCurrentChat
          ? `Skill "${skillName}" is already available for the current agent${availabilityBeforeApply.currentAgentName ? ` (${availabilityBeforeApply.currentAgentName})` : ''}.`
          : `Successfully added skill "${skillName}" to the profile skill library.`,
      });
    }

    let targets: SkillActivationTarget[] | undefined;
    if (args.activation.mode === 'current-agent') {
      const currentTarget = resolveCurrentAgentTarget(args.userAlias, args.activation.chatId, args.activation.agentName);
      if (!currentTarget) {
        return buildResult({
          success: true,
          skillName,
          skillVersion,
          inputType,
          installSuccess: true,
          isOverwrite,
          currentChatId: args.activation.chatId,
          currentAgentName: availabilityBeforeApply.currentAgentName,
          callable: false,
          resolution: 'installed_but_needs_target_selection',
          message: `Skill "${skillName}" has been installed, but I could not determine which agent should use it in the current chat.`,
        });
      }
      targets = [currentTarget];
    } else if (args.activation.mode === 'selected-agents') {
      targets = args.activation.targets;
    } else if (args.activation.mode === 'all-agents') {
      const profile = profileCacheManager.getCachedProfile(args.userAlias);
      targets = (profile?.chats || []).flatMap(chat => {
        if (chat.chat_type === 'single_agent' && chat.agent?.name) {
          return [{ chatId: chat.chat_id, agentName: chat.agent.name }];
        }

        return (chat.agents || []).map(agent => ({ chatId: chat.chat_id, agentName: agent.name }));
      });
    }

    if (!targets || targets.length === 0) {
      return buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        currentChatId: args.activation.chatId,
        currentAgentName: availabilityBeforeApply.currentAgentName,
        callable: availabilityBeforeApply.callableInCurrentChat,
        resolution: 'installed_but_not_applied',
        message: `Skill "${skillName}" has been installed, but no activation targets were resolved.`,
      });
    }

    const applyResult = await applySkillToAgents(args.userAlias, {
      skillName,
      targets,
      requestSource: args.requestSource,
    });

    const availabilityAfterApply = getSkillAvailability({
      userAlias: args.userAlias,
      skillName,
      chatId: args.activation.chatId,
      agentName: args.activation.agentName,
    });

    if (availabilityAfterApply.callableInCurrentChat) {
      return buildResult({
        success: true,
        skillName,
        skillVersion,
        inputType,
        installSuccess: true,
        isOverwrite,
        attempted: true,
        appliedTargets: applyResult.appliedTargets,
        skippedTargets: applyResult.skippedTargets,
        currentChatId: args.activation.chatId,
        currentAgentName: availabilityAfterApply.currentAgentName,
        callable: true,
        resolution: availabilityBeforeApply.callableInCurrentChat ? 'already_callable' : 'installed_and_callable',
        message: availabilityBeforeApply.callableInCurrentChat
          ? `Skill "${skillName}" is already available for the current agent${availabilityAfterApply.currentAgentName ? ` (${availabilityAfterApply.currentAgentName})` : ''}.`
          : `Skill "${skillName}" has been installed and applied to ${availabilityAfterApply.currentAgentName || 'the current agent'}.`,
      });
    }

    return buildResult({
      success: applyResult.success,
      skillName,
      skillVersion,
      inputType,
      installSuccess: true,
      isOverwrite,
      attempted: true,
      appliedTargets: applyResult.appliedTargets,
      skippedTargets: applyResult.skippedTargets,
      currentChatId: args.activation.chatId,
      currentAgentName: availabilityAfterApply.currentAgentName,
      callable: false,
      resolution: 'installed_but_not_applied',
      message: applyResult.appliedCount > 0
        ? `Skill "${skillName}" was installed, but it is not yet callable in the current chat.`
        : applyResult.message,
      error: applyResult.error,
    });
  } catch (error) {
    return buildResult({
      success: false,
      skillName,
      skillVersion,
      inputType,
      installSuccess: false,
      isOverwrite,
      resolution: 'failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  }
}
