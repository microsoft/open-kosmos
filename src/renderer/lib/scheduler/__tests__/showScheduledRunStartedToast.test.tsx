import { showScheduledRunStartedToast } from '../showScheduledRunStartedToast'

describe('showScheduledRunStartedToast', () => {
  it('shows a persistent toast with an open-session action when chatSessionId is available', () => {
    const navigate = vi.fn()
    const showToast = vi.fn()
    const showSuccess = vi.fn()

    showScheduledRunStartedToast({
      result: { chatSessionId: 'session-42' },
      agentId: 'chat-123',
      navigate,
      showToast,
      showSuccess,
    })

    expect(showToast).toHaveBeenCalledWith(
      'Scheduled run started.',
      'success',
      undefined,
      expect.objectContaining({
        persistent: true,
        actions: [
          expect.objectContaining({
            label: 'Open schedule run',
            variant: 'primary',
          }),
        ],
      }),
    )
    expect(showSuccess).not.toHaveBeenCalled()

    const toastOptions = showToast.mock.calls[0][3]
    toastOptions.actions[0].onClick()

    expect(navigate).toHaveBeenCalledWith('/agent/chat/chat-123/session-42', {
      state: {
        intent: 'open-session',
        source: 'schedule-run-toast',
        targetChatId: 'chat-123',
        targetSessionId: 'session-42',
        openSchedulesSidepane: true,
      },
    })
  })

  it('falls back to a plain success toast without a session id', () => {
    const navigate = vi.fn()
    const showToast = vi.fn()
    const showSuccess = vi.fn()

    showScheduledRunStartedToast({
      result: {},
      agentId: 'chat-123',
      navigate,
      showToast,
      showSuccess,
    })

    expect(showSuccess).toHaveBeenCalledWith('Scheduled run started.')
    expect(showToast).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})