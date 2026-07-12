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
  chatId?: string
  navigate: NavigateWithOptionsFn
  showToast: ShowToastFn
  showSuccess: ShowSuccessFn
  t?: (key: 'chat.schedule.runStarted' | 'chat.schedule.openRun') => string
}

const defaultTranslate: NonNullable<ShowScheduledRunStartedToastParams['t']> = (key) => {
  if (key === 'chat.schedule.openRun') return 'Open schedule run'
  return 'Scheduled run started.'
}

export function showScheduledRunStartedToast({
  result,
  chatId,
  navigate,
  showToast,
  showSuccess,
  t = defaultTranslate,
}: ShowScheduledRunStartedToastParams): void {
  if (chatId && result?.chatSessionId) {
    showToast(t('chat.schedule.runStarted'), 'success', 5000, {
      actions: [
        {
          label: t('chat.schedule.openRun'),
          variant: 'primary',
          onClick: () => {
            navigate(`/agent/chat/${chatId}/${result.chatSessionId}`, {
              state: {
                intent: 'open-session',
                source: 'schedule-run-toast',
                targetChatId: chatId,
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

  showSuccess(t('chat.schedule.runStarted'))
}

export default showScheduledRunStartedToast