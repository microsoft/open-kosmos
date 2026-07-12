// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  updateJob: vi.fn(),
}))

vi.mock('../../../ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../../../ipc/scheduler', () => ({
  schedulerApi: {
    createJob: (...args: unknown[]) => mocks.createJob(...args),
    updateJob: (...args: unknown[]) => mocks.updateJob(...args),
  },
}))

vi.mock('../../../../lib/scheduler/cronDescriptions', () => ({
  buildDailyMultiTimesCronExpression: (times: string) => {
    const list = times.split(',').map((time) => time.trim()).filter(Boolean)
    if (list.length === 0) return { cronExpression: undefined, error: 'At least one time is required.' }
    const minute = list[0]?.split(':')[1]
    if (list.some((time) => time.split(':')[1] !== minute)) {
      return { cronExpression: undefined, error: 'Times must share the same minute.' }
    }
    return { cronExpression: `MULTI:${list.join('|')}`, error: null }
  },
  describeCronExpression: (cron: string) => `described: ${cron}`,
  parseDailyMultiTimesCronExpression: (cron: string) => cron === 'MULTI_PARSED' ? ['03:15', '09:15'] : null,
}))

import AddScheduleOverlay from '../AddScheduleOverlay'
import type { AddScheduleOverlayChatOption } from '../AddScheduleOverlay'
import type { SchedulerJob } from '@shared/ipc/scheduler'

const chatOptions: AddScheduleOverlayChatOption[] = [
  { id: 'agent-1', name: 'Agent One' },
  { id: 'agent-2', name: 'Agent Two' },
]

const defaultProps = (overrides: Record<string, unknown> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  chatOptions,
  defaultChatId: 'agent-1',
  ...overrides,
})

const fillRequiredFields = (name = '  Test Schedule  ', description = '  Test description  ', message = '  Test message  ') => {
  fireEvent.change(screen.getByPlaceholderText('Daily standup summary'), { target: { value: name } })
  fireEvent.change(screen.getByPlaceholderText(/Summarize the latest/), { target: { value: description } })
  fireEvent.change(screen.getByPlaceholderText(/Write the exact prompt/), { target: { value: message } })
}

const clickRecurring = () => fireEvent.click(screen.getByRole('button', { name: /recurring schedule/i }))
const clickOnce = () => fireEvent.click(screen.getByRole('button', { name: /one-time schedule/i }))
const saveButton = () => screen.getByTitle(/create schedule|update schedule/i)
const inputNear = (label: string, selector: string) => {
  const labelNode = screen.getByText(label)
  return labelNode.parentElement!.querySelector(selector) as HTMLInputElement | HTMLSelectElement
}

const baseEditingJob = (overrides: Partial<SchedulerJob> = {}) => ({
  id: 'job-1',
  name: 'Existing schedule',
  description: 'Existing description',
  message: 'Existing message',
  chat_id: 'agent-1',
  scheduleType: 'cron' as const,
  cronExpression: '0 9 * * *',
  status: 'pending' as const,
  enabled: true,
  ...overrides,
}) as SchedulerJob

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createJob.mockResolvedValue({ success: true })
  mocks.updateJob.mockResolvedValue({ success: true })
})

describe('AddScheduleOverlay uncovered branch coverage', () => {
  it('creates a one-time schedule with selected agent and changed run time', async () => {
    const onCreated = vi.fn()
    render(<AddScheduleOverlay {...defaultProps({ onCreated })} />)

    fillRequiredFields()
    fireEvent.click(screen.getByTitle('Select Agent'))
    fireEvent.click(within(screen.getByText('Agent Two').closest('button')!).getByText('Agent Two'))
    fireEvent.change(inputNear('Run At', 'input'), { target: { value: '2030-01-02T03:04' } })
    await act(async () => { fireEvent.click(saveButton()) })

    const expectedRunAt = new Date('2030-01-02T03:04').toISOString()
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Schedule',
      description: 'Test description',
      message: 'Test message',
      chat_id: 'agent-2',
      scheduleType: 'once',
      runAt: expectedRunAt,
      cronExpression: undefined,
    }))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ runAt: expectedRunAt, chat_id: 'agent-2' }))
  })

  it('disables submit when a one-time schedule has an empty date', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    fillRequiredFields()
    fireEvent.change(inputNear('Run At', 'input'), { target: { value: '' } })
    expect(saveButton()).toBeDisabled()
  })

  it('switches from recurring back to one-time mode', () => {
    render(<AddScheduleOverlay {...defaultProps({ initialValues: { mode: 'recurring' } })} />)
    expect(screen.getByText('Recurring Pattern')).toBeInTheDocument()
    clickOnce()
    expect(screen.getByText('Run At')).toBeInTheDocument()
  })

  it.each([
    ['Daily', undefined, '30 6 * * *'],
    ['Weekly', () => fireEvent.change(inputNear('Day of Week', 'select'), { target: { value: '2' } }), '30 6 * * 2'],
    ['Monthly', () => fireEvent.change(inputNear('Day of Month', 'input'), { target: { value: '12' } }), '30 6 12 * *'],
    ['Every N Days', () => fireEvent.change(inputNear('Repeat Every', 'input'), { target: { value: '3' } }), '30 6 */3 * *'],
    ['Every N Weeks', () => {
      fireEvent.change(inputNear('Day of Week', 'select'), { target: { value: '5' } })
      fireEvent.change(inputNear('Repeat Every', 'input'), { target: { value: '4' } })
    }, '30 6 * * 5/4'],
    ['Every N Months', () => {
      fireEvent.change(inputNear('Day of Month', 'input'), { target: { value: '9' } })
      fireEvent.change(inputNear('Repeat Every', 'input'), { target: { value: '6' } })
    }, '30 6 9 */6 *'],
  ])('creates a recurring %s schedule with the expected cron payload', async (presetLabel, configure, expectedCron) => {
    render(<AddScheduleOverlay {...defaultProps()} />)

    fillRequiredFields('Schedule', 'Description', 'Message')
    clickRecurring()
    fireEvent.click(screen.getByRole('button', { name: presetLabel }))
    fireEvent.change(inputNear('Time', 'input'), { target: { value: '06:30' } })
    configure?.()

    expect(screen.getByText(expectedCron)).toBeInTheDocument()
    await act(async () => { fireEvent.click(saveButton()) })

    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      scheduleType: 'cron',
      cronExpression: expectedCron,
      runAt: undefined,
    }))
  })

  it('creates a daily multi-time recurring schedule and rejects mixed-minute chips', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)

    fillRequiredFields('Schedule', 'Description', 'Message')
    clickRecurring()
    fireEvent.click(screen.getByRole('button', { name: 'Daily Multi-Time' }))
    expect(screen.getByText('MULTI:04:00|08:00|14:00|18:00')).toBeInTheDocument()

    const draft = inputNear('Times of Day', 'input[type="time"]')
    fireEvent.change(draft, { target: { value: '10:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Time' }))
    expect(screen.getByText('Times must share the same minute.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove 10:30' }))
    expect(saveButton()).not.toBeDisabled()
    await act(async () => { fireEvent.click(saveButton()) })

    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      scheduleType: 'cron',
      cronExpression: 'MULTI:04:00|08:00|14:00|18:00',
    }))
  })

  it('shows the empty multi-time state and seeds it from the single recurring time when reselected', () => {
    render(<AddScheduleOverlay {...defaultProps()} />)

    clickRecurring()
    fireEvent.change(inputNear('Time', 'input'), { target: { value: '07:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Daily Multi-Time' }))
    for (const removeButton of screen.getAllByRole('button', { name: /Remove/ })) {
      fireEvent.click(removeButton)
    }
    expect(screen.getByText('No times added yet.')).toBeInTheDocument()
    expect(screen.getByText('At least one time is required.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Daily' }))
    fireEvent.click(screen.getByRole('button', { name: 'Daily Multi-Time' }))
    expect(screen.getByText('07:00')).toBeInTheDocument()
  })

  it('closes the agent dropdown on outside click', async () => {
    render(<AddScheduleOverlay {...defaultProps()} />)
    fireEvent.click(screen.getByTitle('Select Agent'))
    expect(screen.getByText('Agent Two')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('Agent Two')).not.toBeInTheDocument())
  })

  it('falls back to Select Agent and blocks submit when no agent is available', () => {
    render(<AddScheduleOverlay {...defaultProps({ chatOptions: [], defaultChatId: undefined })} />)
    fillRequiredFields('Schedule', 'Description', 'Message')
    expect(screen.getByText('Select Agent')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('shows the edit-mode locked-agent explanation', () => {
    render(<AddScheduleOverlay {...defaultProps({ editingJob: baseEditingJob({ scheduleType: 'once', cronExpression: undefined }), lockChat: true })} />)
    expect(screen.getByText('Agent is locked because this schedule is being edited from the current agent tab.')).toBeInTheDocument()
  })

  it.each([
    ['daily cron', '15 6 * * *', '06:15', /Daily/],
    ['six-field daily cron', '0 15 6 * * *', '06:15', /Daily/],
    ['weekly cron', '30 8 * * 4', '08:30', /Thursday/],
    ['every n days cron with zero fallback', '5 7 */0 * *', '07:05', /Every N Days/],
    ['every n weeks cron with zero fallbacks', '10 9 * * 0/0', '09:10', /Every N Weeks/],
    ['monthly cron with zero fallback', '20 11 0 * *', '11:20', /Monthly/],
    ['every n months cron with zero fallbacks', '25 13 0 */0 *', '13:25', /Every N Months/],
    ['daily multi-time cron', 'MULTI_PARSED', undefined, /03:15/],
    ['invalid length cron', 'not-a-cron', '09:00', /Daily/],
    ['invalid number cron', 'x 6 * * *', '09:00', /Daily/],
  ])('initializes edit mode from %s', (label, cronExpression, expectedTime, visiblePattern) => {
    render(<AddScheduleOverlay {...defaultProps({ editingJob: baseEditingJob({ cronExpression }) })} />)

    expect(screen.getByText('Edit Schedule')).toBeInTheDocument()
    expect(screen.getAllByText(visiblePattern).length).toBeGreaterThan(0)
    if (expectedTime) {
      expect(screen.getByDisplayValue(expectedTime)).toBeInTheDocument()
    }
  })

  it('falls back to the default run date when an edited one-time schedule has an invalid runAt', () => {
    render(<AddScheduleOverlay {...defaultProps({ editingJob: baseEditingJob({ scheduleType: 'once', cronExpression: undefined, runAt: 'invalid-date' }) })} />)
    expect(screen.getByText('Run At')).toBeInTheDocument()
    expect((inputNear('Run At', 'input') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('uses the default cron builder branch for an unknown recurring preset from initial values', async () => {
    render(<AddScheduleOverlay {...defaultProps({ initialValues: { mode: 'recurring', recurringPreset: 'custom_unknown', recurringTime: '05:45' } })} />)
    fillRequiredFields('Schedule', 'Description', 'Message')

    expect(screen.getByText('45 5 * * *')).toBeInTheDocument()
    await act(async () => { fireEvent.click(saveButton()) })
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({ cronExpression: '45 5 * * *' }))
  })

  it('shows fallback errors for failed create and failed update responses', async () => {
    mocks.createJob.mockResolvedValueOnce({ success: false })
    const { unmount } = render(<AddScheduleOverlay {...defaultProps()} />)
    fillRequiredFields('Schedule', 'Description', 'Message')
    await act(async () => { fireEvent.click(saveButton()) })
    expect(screen.getByText('Failed to create schedule')).toBeInTheDocument()
    unmount()

    mocks.updateJob.mockResolvedValueOnce({ success: false })
    render(<AddScheduleOverlay {...defaultProps({ editingJob: baseEditingJob({ scheduleType: 'once', cronExpression: undefined }) })} />)
    await act(async () => { fireEvent.click(saveButton()) })
    expect(screen.getByText('Failed to update schedule')).toBeInTheDocument()
  })

  it('renders non-Error thrown submit failures as text', async () => {
    mocks.createJob.mockRejectedValueOnce('plain failure')
    render(<AddScheduleOverlay {...defaultProps()} />)
    fillRequiredFields('Schedule', 'Description', 'Message')
    await act(async () => { fireEvent.click(saveButton()) })
    expect(screen.getByText('plain failure')).toBeInTheDocument()
  })

  it('does not submit while already creating', async () => {
    let resolveCreate: (value: unknown) => void = () => {}
    mocks.createJob.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    render(<AddScheduleOverlay {...defaultProps()} />)
    fillRequiredFields('Schedule', 'Description', 'Message')

    fireEvent.click(saveButton())
    expect(await screen.findByText('Creating...')).toBeInTheDocument()
    fireEvent.click(saveButton())
    expect(mocks.createJob).toHaveBeenCalledTimes(1)

    await act(async () => { resolveCreate({ success: true }) })
  })
})
