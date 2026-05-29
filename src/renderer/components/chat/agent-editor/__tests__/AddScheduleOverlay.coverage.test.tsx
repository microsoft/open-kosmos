/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ---- mocks ----

vi.mock('../../../ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockCreateJob = vi.fn()
const mockUpdateJob = vi.fn()
vi.mock('../../../../ipc/scheduler', () => ({
  schedulerApi: {
    createJob: (...args: unknown[]) => mockCreateJob(...args),
    updateJob: (...args: unknown[]) => mockUpdateJob(...args),
  },
}))

vi.mock('../../../../lib/scheduler/cronDescriptions', () => ({
  buildDailyMultiTimesCronExpression: (times: string) => ({
    cronExpression: `MULTI:${times}`,
    error: null,
  }),
  describeCronExpression: (cron: string) => `described: ${cron}`,
  parseDailyMultiTimesCronExpression: (_: string) => null,
}))


import AddScheduleOverlay from '../AddScheduleOverlay'
import type { AddScheduleOverlayAgentOption } from '../AddScheduleOverlay'
import type { SchedulerJob } from '@shared/ipc/scheduler'

// ---- helpers ----

const agents: AddScheduleOverlayAgentOption[] = [
  { id: 'agent-1', name: 'Agent One' },
  { id: 'agent-2', name: 'Agent Two' },
]

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    agents,
    defaultAgentId: 'agent-1',
    ...overrides,
  }
}

function fillRequiredFields(nameVal = 'Test Schedule', descVal = 'Test desc', msgVal = 'Test message') {
  fireEvent.change(screen.getByPlaceholderText('Daily standup summary'), { target: { value: nameVal } })
  fireEvent.change(screen.getByPlaceholderText(/Summarize the latest/), { target: { value: descVal } })
  fireEvent.change(screen.getByPlaceholderText(/Write the exact prompt/), { target: { value: msgVal } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- tests ----

describe('AddScheduleOverlay', () => {
  it('renders nothing when closed', () => {
    render(<AddScheduleOverlay {...defaultProps({ open: false })} />)
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when open', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getAllByText('Add New Schedule').length).toBeGreaterThan(0)
  })

  it('shows Edit Schedule title in edit mode', () => {
    const editingJob = {
      id: 'job-1',
      name: 'My job',
      description: 'Desc',
      message: 'Msg',
      agentId: 'agent-1',
      scheduleType: 'once' as const,
      status: 'pending' as const,
      enabled: true,
      notifyOnCompletion: true,
    } as SchedulerJob
    render(<AddScheduleOverlay {...defaultProps({ editingJob })} />)
    expect(screen.getByText('Edit Schedule')).toBeInTheDocument()
  })

  it('shows agent name in selector', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    expect(screen.getByText('Agent One')).toBeInTheDocument()
  })

  it('shows locked agent note when lockAgent=true', () => {
    render(<AddScheduleOverlay {...defaultProps({ lockAgent: true })} />)
    expect(screen.getByText(/agent is locked/i)).toBeInTheDocument()
  })

  it('add button is disabled when required fields are empty', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    const addBtn = screen.getByTitle('Create schedule')
    expect(addBtn).toBeDisabled()
  })

  it('add button is enabled when all required fields are filled', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fillRequiredFields() })
    expect(screen.getByTitle('Create schedule')).not.toBeDisabled()
  })

  it('calls onOpenChange(false) when Cancel clicked', async () => {
    const onOpenChange = vi.fn()
    render(<AddScheduleOverlay {...defaultProps({ onOpenChange })} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates a one-time schedule on submit', async () => {
    mockCreateJob.mockResolvedValue({ success: true })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(<AddScheduleOverlay {...defaultProps({ onCreated, onOpenChange })} />)

    await act(async () => { fillRequiredFields() })
    await act(async () => { fireEvent.click(screen.getByTitle('Create schedule')) })

    expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Schedule',
      scheduleType: 'once',
    }))
    expect(onCreated).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows error when create fails', async () => {
    mockCreateJob.mockResolvedValue({ success: false, error: 'Server error' })
    render(<AddScheduleOverlay {...defaultProps()} />)

    await act(async () => { fillRequiredFields() })
    await act(async () => { fireEvent.click(screen.getByTitle('Create schedule')) })

    expect(screen.getByText('Server error')).toBeInTheDocument()
  })

  it('switches to recurring mode', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Recurring Schedule'))
    })
    expect(screen.getByText('Recurring Pattern')).toBeInTheDocument()
  })

  it('creates a recurring schedule', async () => {
    mockCreateJob.mockResolvedValue({ success: true })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(<AddScheduleOverlay {...defaultProps({ onCreated, onOpenChange })} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Recurring Schedule'))
      fillRequiredFields()
    })
    await act(async () => { fireEvent.click(screen.getByTitle('Create schedule')) })

    expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({
      scheduleType: 'cron',
    }))
    expect(onCreated).toHaveBeenCalled()
  })

  it('updates a schedule in edit mode', async () => {
    mockUpdateJob.mockResolvedValue({ success: true })
    const onUpdated = vi.fn()
    const onOpenChange = vi.fn()
    const editingJob = {
      id: 'job-1',
      name: 'Old name',
      description: 'Old desc',
      message: 'Old msg',
      agentId: 'agent-1',
      scheduleType: 'once' as const,
      status: 'pending' as const,
      enabled: true,
      notifyOnCompletion: true,
    } as SchedulerJob

    render(<AddScheduleOverlay {...defaultProps({ editingJob, onUpdated, onOpenChange })} />)

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Daily standup summary'), { target: { value: 'New name' } })
    })
    await act(async () => { fireEvent.click(screen.getByTitle('Update schedule')) })

    expect(mockUpdateJob).toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows agent dropdown when button clicked', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    // Click the agent button (model-button) — find the span with agent name and click parent button
    const agentBtn = screen.getByTitle('Select Agent')
    await act(async () => { fireEvent.click(agentBtn) })
    expect(screen.getByText('Agent Two')).toBeInTheDocument()
  })

  it('selects different agent from dropdown', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    const agentBtn = screen.getByTitle('Select Agent')
    await act(async () => { fireEvent.click(agentBtn) })

    const agentTwoOption = screen.getAllByText('Agent Two')
    await act(async () => { fireEvent.click(agentTwoOption[0]) })

    // After selection dropdown closes, agent two is selected
    expect(screen.queryByText('Agent One')).not.toBeInTheDocument()
  })

  it('initializes with initialValues when not editing', () => {
    render(
      <AddScheduleOverlay
        {...defaultProps({
          initialValues: { name: 'Prefilled name', mode: 'recurring', recurringPreset: 'weekly' },
        })}
      />,
    )
    expect((screen.getByPlaceholderText('Daily standup summary') as HTMLInputElement).value).toBe('Prefilled name')
  })

  it('shows recurring weekly options when weekly preset selected', async () => {
    render(<AddScheduleOverlay {...defaultProps({ initialValues: { mode: 'recurring' } })} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Weekly')) })
    expect(screen.getByText('Day of Week')).toBeInTheDocument()
  })

  it('shows recurring monthly options when monthly preset selected', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Monthly')) })
    expect(screen.getByText('Day of Month')).toBeInTheDocument()
  })

  it('shows "Every N" options when every_n_days preset selected', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Every N Days')) })
    expect(screen.getByText('Repeat Every')).toBeInTheDocument()
  })

  it('shows daily multi-time chip UI when Daily Multi-Time selected', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Daily Multi-Time')) })
    expect(screen.getByText('Times of Day')).toBeInTheDocument()
    expect(screen.getByText('Add Time')).toBeInTheDocument()
  })

  it('removes a time chip', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Daily Multi-Time')) })

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await act(async () => { fireEvent.click(removeButtons[0]) })
    // One fewer chip
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(removeButtons.length - 1)
  })

  it('adds a time chip with valid time', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Daily Multi-Time')) })

    const allEmpty = screen.getAllByDisplayValue('')
    const timeEl = allEmpty.find((el) => (el as HTMLInputElement).type === 'time')!
    await act(async () => {
      fireEvent.change(timeEl, { target: { value: '10:30' } })
    })
    await act(async () => { fireEvent.click(screen.getByText('Add Time')) })
    expect(screen.getByText('10:30')).toBeInTheDocument()
  })

  it('shows validation message when Add Time clicked with empty draft', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    await act(async () => { fireEvent.click(screen.getByText('Daily Multi-Time')) })

    const allEmpty = screen.getAllByDisplayValue('')
    const timeEl = allEmpty.find((el) => (el as HTMLInputElement).type === 'time')!

    // Test duplicate time message
    const existingTime = '04:00'
    await act(async () => {
      fireEvent.change(timeEl, { target: { value: existingTime } })
    })
    await act(async () => { fireEvent.click(screen.getByText('Add Time')) })
    expect(screen.getByText(/already in the list/i)).toBeInTheDocument()
  })

  it('shows toggle for notifyOnCompletion', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    expect(screen.getByText('Notify on completion')).toBeInTheDocument()
    const toggle = screen.getByRole('checkbox')
    expect(toggle).toBeChecked()
  })

  it('handles exception during submit gracefully', async () => {
    mockCreateJob.mockRejectedValue(new Error('network failure'))
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fillRequiredFields() })
    await act(async () => { fireEvent.click(screen.getByTitle('Create schedule')) })
    expect(screen.getByText('network failure')).toBeInTheDocument()
  })

  it('cron preview shown in recurring mode', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    expect(screen.getByText(/cron preview/i)).toBeInTheDocument()
  })

  it('shows cron summary line', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    await act(async () => { fireEvent.click(screen.getByText('Recurring Schedule')) })
    expect(screen.getByText(/summary:/i)).toBeInTheDocument()
  })
})
