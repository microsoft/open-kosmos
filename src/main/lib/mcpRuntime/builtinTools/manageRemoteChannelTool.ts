/**
 * Remote Control Tool
 * Control remote channels via Agent chat (start/stop/bind/unbind/status)
 */

import { RemoteChannelManager } from '../../remoteChannel/channelManager';
import { profileCacheManager } from '../../userDataADO';
import { credentialStore } from '../../remoteChannel/credentialStore';
import { APP_NAME } from '../../../../shared/constants/branding';

const TEAMS_BOT_NAME = `${APP_NAME} Bot`;

export type RemoteControlAction = 'status' | 'start' | 'stop' | 'bind' | 'unbind';

interface RemoteControlArgs {
  action: RemoteControlAction;
  channel_id?: string;
  bind_code?: string;
}

interface RemoteControlResult {
  success: boolean;
  action: RemoteControlAction;
  channel_id: string;
  status: string;
  bound: boolean;
  bound_user_id?: string;
  config: {
    bound_chat_id?: string;
    configured: boolean;
  };
  message: string;
  error?: string;
  hint?: string;
}

export class ManageRemoteChannelTool {
  static async execute(args: RemoteControlArgs, options?: { signal?: AbortSignal }): Promise<RemoteControlResult> {
    const channelId = args.channel_id || 'teams';
    const action = args.action;

    // Validate action
    const validActions: RemoteControlAction[] = ['status', 'start', 'stop', 'bind', 'unbind'];
    if (!action || !validActions.includes(action)) {
      return {
        success: false,
        action,
        channel_id: channelId,
        status: 'unknown',
        bound: false,
        config: { configured: false },
        message: `Invalid action: must be one of ${validActions.join(', ')}`,
        error: 'INVALID_ACTION',
      };
    }

    try {
      const manager = RemoteChannelManager.getInstance();
      const alias = (profileCacheManager as any).currentUserAlias as string;

      if (!alias) {
        return {
          success: false,
          action,
          channel_id: channelId,
          status: 'unknown',
          bound: false,
          config: { configured: false },
          message: 'No active user session. Please sign in first.',
          error: 'NO_USER_SESSION',
        };
      }

      // Helper: gather full context snapshot
      const getContext = async () => {
        const statusInfo = manager.getChannelStatus(channelId);
        const profile = profileCacheManager.getCachedProfile(alias);
        const channelConfig = { boundChatId: profile?.remoteChannels?.[channelId]?.boundChatId };
        const token = await credentialStore.getCredential(alias, channelId, 'bindingToken');
        const userId = await credentialStore.getCredential(alias, channelId, 'boundUserId');

        return {
          status: statusInfo?.status || 'stopped',
          error: statusInfo?.error,
          bound: !!token,
          bound_user_id: userId || undefined,
          config: {
            bound_chat_id: channelConfig.boundChatId,
            configured: true,
          },
        };
      };

      switch (action) {
        case 'status': {
          const ctx = await getContext();
          return {
            success: true,
            action,
            channel_id: channelId,
            ...ctx,
            message: `Channel "${channelId}" is ${ctx.status}${ctx.bound ? `, bound to user ${ctx.bound_user_id || '(unknown)'}` : ', not bound'}.`,
          };
        }

        case 'start': {
          const ctx = await getContext();
          if (ctx.status === 'running' || ctx.status === 'starting' || ctx.status === 'reconnecting') {
            return {
              success: true,
              action,
              channel_id: channelId,
              ...ctx,
              message: `Channel "${channelId}" is already ${ctx.status}.`,
            };
          }

          await manager.startChannel(channelId);
          const afterCtx = await getContext();
          return {
            success: true,
            action,
            channel_id: channelId,
            ...afterCtx,
            message: `Channel "${channelId}" start initiated.`,
            hint: afterCtx.bound
              ? undefined
              : `Channel started but not bound to a Teams user. To bind: the user should send .bind to ${TEAMS_BOT_NAME} in Teams to get a 6-character code, then provide it here.`,
          };
        }

        case 'stop': {
          const ctx = await getContext();
          if (ctx.status === 'stopped') {
            return {
              success: true,
              action,
              channel_id: channelId,
              ...ctx,
              message: `Channel "${channelId}" is already stopped.`,
            };
          }

          await manager.stopChannel(channelId);
          const afterCtx = await getContext();
          return {
            success: true,
            action,
            channel_id: channelId,
            ...afterCtx,
            message: `Channel "${channelId}" stopped.`,
          };
        }

        case 'bind': {
          if (!args.bind_code || !args.bind_code.trim()) {
            const ctx = await getContext();
            return {
              success: false,
              action,
              channel_id: channelId,
              ...ctx,
              message: 'Bind code is required for the "bind" action.',
              error: 'MISSING_BIND_CODE',
              hint: `Ask the user to send .bind to ${TEAMS_BOT_NAME} in Teams to get a 6-character code.`,
            };
          }

          const ctx = await getContext();
          if (ctx.status !== 'running') {
            return {
              success: false,
              action,
              channel_id: channelId,
              ...ctx,
              message: `Cannot bind: channel is "${ctx.status}", must be "running" first.`,
              error: 'NOT_RUNNING',
              hint: 'Start the channel first, then try binding.',
            };
          }

          try {
            const result = await manager.bind(channelId, args.bind_code.trim());
            const afterCtx = await getContext();
            return {
              success: true,
              action,
              channel_id: channelId,
              ...afterCtx,
              bound_user_id: result.userId,
              message: `Successfully bound to Teams user.`,
            };
          } catch (bindError) {
            const afterCtx = await getContext();
            const errMsg = bindError instanceof Error ? bindError.message : String(bindError);
            return {
              success: false,
              action,
              channel_id: channelId,
              ...afterCtx,
              message: `Bind failed: ${errMsg}`,
              error: errMsg,
              hint: 'The code may be expired or invalid. Ask the user to send .bind again in Teams to get a new code.',
            };
          }
        }

        case 'unbind': {
          const ctx = await getContext();
          if (!ctx.bound) {
            return {
              success: false,
              action,
              channel_id: channelId,
              ...ctx,
              message: 'Channel is not currently bound.',
              error: 'NOT_BOUND',
            };
          }

          await manager.unbind(channelId);
          const afterCtx = await getContext();
          return {
            success: true,
            action,
            channel_id: channelId,
            ...afterCtx,
            message: 'Successfully unbound from Teams user.',
          };
        }

        default:
          return {
            success: false,
            action,
            channel_id: channelId,
            status: 'unknown',
            bound: false,
            config: { configured: false },
            message: `Unknown action: ${action}`,
            error: 'UNKNOWN_ACTION',
          };
      }
    } catch (error) {
      return {
        success: false,
        action,
        channel_id: channelId,
        status: 'unknown',
        bound: false,
        config: { configured: false },
        message: `Error executing manage_remote_channel: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
