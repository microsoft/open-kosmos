import React from 'react'

import type { SchedulerManualRunResult } from '@shared/ipc/scheduler'

import type { ToastMessage } from '../../components/ui/Toast'

type NavigateFn = (to: string) => void

interface NavigateOptions {
  state?: {
    intent?: 'open-session'
    source?: string
    targetChatId?: string
    targetSessionId?: string
    openSchedulesSidepane?: boolean
  }
}

type NavigateWithOptionsFn = (to: string, options?: NavigateOptions) => void

type ShowToastFn = (
  message: string | React.ReactNode,
  type?: ToastMessage['type'],
  duration?: number,
  options?: Partial<Pick<ToastMessage, 'persistent' | 'actions' | 'onDismiss'>>,
) => string

type ShowSuccessFn = (message: string | React.ReactNode, duration?: number) => void

interface ShowScheduledRunStartedToastParams {
  result?: SchedulerManualRunResult
  agentId?: string
  navigate: NavigateWithOptionsFn
  showToast: ShowToastFn
  showSuccess: ShowSuccessFn
}

export function showScheduledRunStartedToast({
  result,
  agentId,
  navigate,
  showToast,
  showSuccess,
}: ShowScheduledRunStartedToastParams): void {
  if (agentId && result?.chatSessionId) {
    showToast('Scheduled run started.', 'success', undefined, {
      persistent: true,
      actions: [
        {
          label: 'Open schedule run',
          variant: 'primary',
          onClick: () => {
            navigate(`/agent/chat/${agentId}/${result.chatSessionId}`, {
              state: {
                intent: 'open-session',
                source: 'schedule-run-toast',
                targetChatId: agentId,
                targetSessionId: result.chatSessionId,
                openSchedulesSidepane: true,
              },
            })
          },
        },
      ],
    })
    return
  }

  showSuccess('Scheduled run started.')
}

export default showScheduledRunStartedToast