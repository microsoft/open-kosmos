// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('../../../../styles/Agent.css', () => ({}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>()
  return {
    ...actual,
    ChevronDown: ({ size }: any) => <span data-testid="chevron-down" data-size={size}>⌄</span>,
    Mail: ({ size }: any) => <span data-testid="mail-icon" data-size={size}>✉</span>,
    Plus: ({ size }: any) => <span data-testid="plus-icon" data-size={size}>+</span>,
  }
})

const mockSchedulerApiListJobs = vi.fn()
const mockSchedulerApiToggleJob = vi.fn()
const mockSchedulerApiDeleteJob = vi.fn()
const mockSchedulerApiUpdateJob = vi.fn()
const mockSchedulerApiRunJobNow = vi.fn()
vi.mock('../../../../ipc/scheduler', () => ({
  schedulerApi: {
    listJobs: (...args: unknown[]) => mockSchedulerApiListJobs(...args),
    toggleJob: (...args: unknown[]) => mockSchedulerApiToggleJob(...args),
    deleteJob: (...args: unknown[]) => mockSchedulerApiDeleteJob(...args),
    updateJob: (...args: unknown[]) => mockSchedulerApiUpdateJob(...args),
    runJobNow: (...args: unknown[]) => mockSchedulerApiRunJobNow(...args),
  },
}))

const mockProfileDataManagerSubscribe = vi.fn()
const mockProfileDataManagerGetProfile = vi.fn()
vi.mock('../../../../lib/userData', () => ({
  profileDataManager: {
    subscribe: (...args: unknown[]) => mockProfileDataManagerSubscribe(...args),
    getProfile: (...args: unknown[]) => mockProfileDataManagerGetProfile(...args),
  },
}))

const mockShowScheduledRunStartedToast = vi.fn()
vi.mock('../../../../lib/scheduler/showScheduledRunStartedToast', () => ({
  showScheduledRunStartedToast: (...args: unknown[]) => mockShowScheduledRunStartedToast(...args),
}))

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
const mockShowToast = vi.fn()
vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError, showToast: mockShowToast }),
}))

vi.mock('../../../settings/SchedulesContentView', () => ({
  default: ({ jobs, error, onToggle, onDelete, onUpdate, onRunNow, onEdit }: any) => (
    <div data-testid="schedules-content-view">
      {error && <div data-testid="error-msg">{error}</div>}
      {jobs.map((job: any) => (
        <div key={job.id} data-testid={`job-${job.id}`}>
          <span>{job.name}</span>
          <button data-testid={`toggle-${job.id}`} onClick={() => onToggle(job.id, !job.enabled)}>Toggle</button>
          <button data-testid={`delete-${job.id}`} onClick={() => onDelete(job.id)}>Delete</button>
          <button data-testid={`update-${job.id}`} onClick={() => onUpdate(job.id, { name: 'updated' })}>Update</button>
          <button data-testid={`run-${job.id}`} onClick={() => onRunNow(job.id)}>Run Now</button>
          <button data-testid={`edit-${job.id}`} onClick={() => onEdit(job)}>Edit</button>
        </div>
      ))}
    </div>
  ),
  ScheduleWakeNotice: ({ compact }: any) => <div data-testid="schedule-wake-notice" data-compact={compact} />,
}))

vi.mock('../AddScheduleOverlay', () => ({
  default: ({ open, onOpenChange, onCreated, onUpdated, editingJob, initialValues, chatOptions }: any) => (
    open ? (
      <div data-testid="add-schedule-overlay">
        <output data-testid="overlay-initial-values">{initialValues ? JSON.stringify(initialValues) : 'none'}</output>
        <output data-testid="overlay-agents">{chatOptions.map((agent: any) => agent.name).join(',')}</output>
        <button data-testid="overlay-keep-open" onClick={() => onOpenChange(true)}>Keep Open</button>
        <button data-testid="overlay-close" onClick={() => onOpenChange(false)}>Close</button>
        <button data-testid="overlay-create" onClick={() => onCreated({ id: 'new-job', name: 'New Job', chat_id: 'agent-1', enabled: true })}>Create</button>
        {onUpdated && <button data-testid="overlay-update" onClick={() => onUpdated({ id: 'job-1', name: 'Updated Job', chat_id: 'agent-1', enabled: true })}>Update</button>}
        {editingJob && <span data-testid="editing-job-name">{editingJob.name}</span>}
      </div>
    ) : null
  ),
}))

vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }))

import AgentSchedulesTab from '../AgentSchedulesTab'
import type { TabComponentProps, AgentConfig } from '../types'

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'Test Job',
    chat_id: 'agent-1',
    enabled: true,
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    message: 'Hello',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeAgentData(overrides: Record<string, unknown> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    emoji: '🤖',
    role: 'assistant',
    model: 'gpt-4',
    mcpServers: [],
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentConfig
}

function defaultProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    mode: 'update',
    chatId: 'agent-1',
    agentData: makeAgentData(),
    onSave: vi.fn().mockResolvedValue(makeAgentData()),
    readOnly: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProfileDataManagerSubscribe.mockReturnValue(() => {})
  mockProfileDataManagerGetProfile.mockReturnValue({
    chats: [
      { chat_id: 'agent-1', agent: { name: 'Test Agent' } },
      { chat_id: 'agent-2', agent: { name: 'Other Agent' } },
      { chat_id: '', agent: { name: 'Missing Id' } },
      { chat_id: 'agent-3', agent: {} },
    ],
  })
  mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [] })
  mockSchedulerApiToggleJob.mockResolvedValue({ success: true })
  mockSchedulerApiDeleteJob.mockResolvedValue({ success: true })
  mockSchedulerApiUpdateJob.mockResolvedValue({ success: true })
  mockSchedulerApiRunJobNow.mockResolvedValue({ success: true, data: { chatId: 'agent-1' } })
})

describe('AgentSchedulesTab add schedule coverage', () => {
  it('opens the add schedule overlay with filtered agent options', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getAllByText('Add New Schedule')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('overlay-initial-values')).toHaveTextContent('none')
    expect(screen.getByTestId('overlay-agents')).toHaveTextContent('Test Agent,Other Agent')
  })

  it('disables add schedule when read-only', async () => {
    render(<AgentSchedulesTab {...defaultProps({ readOnly: true })} />)
    await waitFor(() => expect(screen.getAllByText('Add New Schedule')[0]).toBeInTheDocument())
    expect(screen.getAllByText('Add New Schedule')[0].closest('button')).toBeDisabled()
    expect(screen.queryByTestId('add-schedule-overlay')).not.toBeInTheDocument()
  })

  it('uses empty profile data for empty overlay agent options', async () => {
    mockProfileDataManagerGetProfile.mockReturnValue(undefined)
    render(<AgentSchedulesTab {...defaultProps({ agentData: makeAgentData({ name: 'Fallback Agent' }) })} />)
    await waitFor(() => expect(screen.getAllByText('Add New Schedule')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('overlay-agents')).toHaveTextContent('')
  })

  it('falls back to the chat id when an agent name disappears between filtering and mapping', async () => {
    let reads = 0
    const volatileAgent = { get name() { reads += 1; return reads % 2 === 1 ? 'Volatile Agent' : '' } }
    mockProfileDataManagerGetProfile.mockReturnValue({ chats: [{ chat_id: 'volatile-agent-id', agent: volatileAgent }] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getAllByText('Add New Schedule')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('overlay-agents')).toHaveTextContent('volatile-agent-id')
  })

  it('covers unknown-error and thrown-error load paths', async () => {
    mockSchedulerApiListJobs.mockResolvedValueOnce({ success: false })
    const { unmount } = render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getByTestId('error-msg')).toHaveTextContent('Unknown error'))
    unmount()
    mockSchedulerApiListJobs.mockRejectedValueOnce(new Error('List exploded'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getByTestId('error-msg')).toHaveTextContent('List exploded'))
  })

  it('ignores schedule events for other agents', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schedule:created', { detail: { chatId: 'other-agent' } }))
      window.dispatchEvent(new CustomEvent('schedule:updated', { detail: { chatId: 'other-agent' } }))
    })
    expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1)
  })

  it('covers failure fallbacks for toggle, delete, update, and run now', async () => {
    const jobs = [makeJob(), makeJob({ id: 'job-2', name: 'Second Job', enabled: false })]
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: jobs })
    mockSchedulerApiToggleJob.mockResolvedValueOnce({ success: false })
    mockSchedulerApiDeleteJob.mockResolvedValueOnce({ success: false })
    mockSchedulerApiUpdateJob.mockResolvedValueOnce({ success: false })
    mockSchedulerApiRunJobNow.mockResolvedValueOnce({ success: false })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getByTestId('toggle-job-1')).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('Failed to toggle schedule: Unknown error')
    await act(async () => { fireEvent.click(screen.getByTestId('delete-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('Failed to delete schedule: Unknown error')
    await act(async () => { fireEvent.click(screen.getByTestId('update-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('Failed to update schedule: Unknown error')
    await act(async () => { fireEvent.click(screen.getByTestId('run-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('Failed to run schedule: Unknown error')
    expect(mockShowError).toHaveBeenCalledWith('Failed to run schedule: Unknown error')
  })

  it('covers thrown string failures for schedule actions', async () => {
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [makeJob()] })
    mockSchedulerApiToggleJob.mockRejectedValueOnce('toggle string')
    mockSchedulerApiDeleteJob.mockRejectedValueOnce('delete string')
    mockSchedulerApiUpdateJob.mockRejectedValueOnce('update string')
    mockSchedulerApiRunJobNow.mockRejectedValueOnce('run string')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getByTestId('toggle-job-1')).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByTestId('toggle-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('toggle string')
    await act(async () => { fireEvent.click(screen.getByTestId('delete-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('delete string')
    await act(async () => { fireEvent.click(screen.getByTestId('update-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('update string')
    await act(async () => { fireEvent.click(screen.getByTestId('run-job-1')) })
    expect(screen.getByTestId('error-msg')).toHaveTextContent('run string')
  })

  it('keeps other jobs when updating one job from the overlay and handles open=true changes', async () => {
    const jobs = [makeJob(), makeJob({ id: 'job-2', name: 'Second Job' })]
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: jobs })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(screen.getByTestId('edit-job-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('edit-job-1'))
    fireEvent.click(screen.getByTestId('overlay-keep-open'))
    fireEvent.click(screen.getByTestId('overlay-update'))
    expect(screen.getByText('Updated Job')).toBeInTheDocument()
    expect(screen.getByText('Second Job')).toBeInTheDocument()
  })
})
