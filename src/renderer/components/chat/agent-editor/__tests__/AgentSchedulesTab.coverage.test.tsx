/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ---- mocks ----

vi.mock('../../../../styles/Agent.css', () => ({}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down">⌄</span>,
  Mail: () => <span data-testid="mail-icon">✉</span>,
  Plus: () => <span data-testid="plus-icon">+</span>,
}))

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
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}))

// SchedulesContentView mock
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

// AddScheduleOverlay mock
vi.mock('../AddScheduleOverlay', () => ({
  default: ({ open, onOpenChange, onCreated, onUpdated, editingJob }: any) => (
    open ? (
      <div data-testid="add-schedule-overlay">
        <button data-testid="overlay-close" onClick={() => onOpenChange(false)}>Close</button>
        <button data-testid="overlay-open" onClick={() => onOpenChange(true)}>ReOpen</button>
        <button data-testid="overlay-create" onClick={() => onCreated({ id: 'new-job', name: 'New Job', chat_id: 'agent-1', enabled: true })}>Create</button>
        {onUpdated && <button data-testid="overlay-update" onClick={() => onUpdated({ id: 'job-1', name: 'Updated Job', chat_id: 'agent-1', enabled: true })}>Update</button>}
        {editingJob && <span data-testid="editing-job-name">{editingJob.name}</span>}
      </div>
    ) : null
  ),
}))

// ScheduleCleanupSection mock
vi.mock('../../../settings/ScheduleCleanupSection', () => ({
  ScheduleCleanupSection: ({ chatId, disabled }: any) => (
    <div data-testid="schedule-cleanup-section" data-agent-id={chatId} data-disabled={disabled} />
  ),
}))

import AgentSchedulesTab from '../AgentSchedulesTab'
import type { TabComponentProps, AgentConfig } from '../types'

// ---- helpers ----

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
    systemPrompt: { 'Base.md': '', 'AGENTS.md': '' },
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
    chats: [{ chat_id: 'agent-1', agent: { name: 'Test Agent' } }],
  })
  mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [] })
  mockSchedulerApiToggleJob.mockResolvedValue({ success: true })
  mockSchedulerApiDeleteJob.mockResolvedValue({ success: true })
  mockSchedulerApiUpdateJob.mockResolvedValue({ success: true })
  mockSchedulerApiRunJobNow.mockResolvedValue({ success: true, data: { chatId: 'agent-1' } })
})

// ---- tests ----

describe('AgentSchedulesTab', () => {
  it('renders empty state when no jobs', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByText(/Add one-time or recurring schedules/i)).toBeInTheDocument()
    })
  })

  it('shows ScheduleWakeNotice in empty state', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('schedule-wake-notice')).toBeInTheDocument()
    })
  })

  it('shows "0 enabled schedules" with no jobs', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByText('0 enabled schedules')).toBeInTheDocument()
    })
  })

  it('shows ScheduleCleanupSection in empty state', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      const cleanup = screen.getByTestId('schedule-cleanup-section')
      expect(cleanup).toBeInTheDocument()
      expect(cleanup).toHaveAttribute('data-agent-id', 'agent-1')
    })
  })

  it('shows jobs in SchedulesContentView when jobs exist', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('schedules-content-view')).toBeInTheDocument()
      expect(screen.getByText('Test Job')).toBeInTheDocument()
    })
  })

  it('shows "1 enabled schedules" when one job is enabled', async () => {
    const job = makeJob({ enabled: true })
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByText('1 enabled schedules')).toBeInTheDocument()
    })
  })

  it('filters jobs by chatId', async () => {
    const job1 = makeJob({ id: 'job-1', chat_id: 'agent-1' })
    const job2 = makeJob({ id: 'job-2', name: 'Other Job', chat_id: 'agent-2' })
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job1, job2] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('job-job-1')).toBeInTheDocument()
      expect(screen.queryByTestId('job-job-2')).not.toBeInTheDocument()
    })
  })

  it('opens add schedule overlay when "Add New Schedule" button is clicked', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
  })

  it('closes overlay and resets editingJob when overlay is closed', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('overlay-close'))
    expect(screen.queryByTestId('add-schedule-overlay')).not.toBeInTheDocument()
  })

  it('adds new job when onCreated is called from overlay', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    fireEvent.click(screen.getByTestId('overlay-create'))
    await waitFor(() => {
      expect(screen.getByText('New Job')).toBeInTheDocument()
    })
  })

  it('toggles job enabled state', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('toggle-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-job-1'))
    })
    expect(mockSchedulerApiToggleJob).toHaveBeenCalledWith('job-1', false)
  })

  it('shows error message when toggle fails', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiToggleJob.mockResolvedValue({ success: false, error: 'Toggle failed' })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('toggle-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).toBeInTheDocument()
    })
  })

  it('deletes job', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('delete-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-job-1'))
    })
    expect(mockSchedulerApiDeleteJob).toHaveBeenCalledWith('job-1')
  })

  it('removes job from list after successful delete', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('delete-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-job-1'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('job-job-1')).not.toBeInTheDocument()
    })
  })

  it('updates job', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('update-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-job-1'))
    })
    expect(mockSchedulerApiUpdateJob).toHaveBeenCalledWith('job-1', { name: 'updated' })
  })

  it('runs job now and shows toast on success', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    expect(mockSchedulerApiRunJobNow).toHaveBeenCalledWith('job-1')
    expect(mockShowScheduledRunStartedToast).toHaveBeenCalled()
  })

  it('shows error and calls showError when runJobNow fails', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiRunJobNow.mockResolvedValue({ success: false, error: 'Run failed' })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    expect(mockShowError).toHaveBeenCalled()
  })

  it('opens overlay in edit mode when onEdit is called', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('edit-job-1'))
    fireEvent.click(screen.getByTestId('edit-job-1'))
    await waitFor(() => {
      expect(screen.getByTestId('editing-job-name')).toHaveTextContent('Test Job')
    })
  })

  it('updates job in list after overlay onUpdated', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('edit-job-1'))
    fireEvent.click(screen.getByTestId('edit-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('overlay-update'))
    })
    await waitFor(() => {
      expect(screen.getByText('Updated Job')).toBeInTheDocument()
    })
  })

  it('disables "Add New Schedule" button when readOnly', async () => {
    render(<AgentSchedulesTab {...defaultProps({ readOnly: true })} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    const btns = screen.getAllByText('Add New Schedule')
    btns.forEach(btn => {
      expect(btn.closest('button')).toBeDisabled()
    })
  })

  it('sets jobs to empty when chatId is undefined', async () => {
    render(<AgentSchedulesTab {...defaultProps({ chatId: undefined })} />)
    await waitFor(() => {
      expect(screen.getByText('0 enabled schedules')).toBeInTheDocument()
    })
    expect(mockSchedulerApiListJobs).not.toHaveBeenCalled()
  })

  it('shows error state from listJobs failure', async () => {
    mockSchedulerApiListJobs.mockResolvedValue({ success: false, error: 'API error' })
    const job = makeJob()
    // Because jobs list is empty and error is set, SchedulesContentView shows the error
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      // Component passes error to SchedulesContentView when jobs exist or shows empty state
      // With no jobs and error: isEmptyState = !error && jobs.length === 0 = false
      expect(screen.getByTestId('schedules-content-view')).toBeInTheDocument()
      expect(screen.getByTestId('error-msg')).toBeInTheDocument()
    })
  })

  it('reloads jobs on schedule:created event', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    const newJob = makeJob({ id: 'job-2', name: 'New Job' })
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [newJob] })
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schedule:created', { detail: { chatId: 'agent-1' } }))
    })
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(2))
  })

  it('reloads jobs on schedule:updated event', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    const updatedJob = makeJob({ name: 'Updated' })
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [updatedJob] })
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schedule:updated', { detail: { chatId: 'agent-1' } }))
    })
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(2))
  })

  it('reloads on profileDataManager subscribe callback', async () => {
    let subscriberCallback: (() => void) | null = null
    mockProfileDataManagerSubscribe.mockImplementation((cb: () => void) => {
      subscriberCallback = cb
      return () => {}
    })
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    await act(async () => {
      subscriberCallback?.()
    })
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(2))
  })

  // --- handleToggle error/catch branches ---

  it('shows error when toggleJob throws an Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiToggleJob.mockRejectedValue(new Error('Network failure'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('toggle-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Network failure')
    })
  })

  it('shows error when toggleJob throws a non-Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiToggleJob.mockRejectedValue('string error')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('toggle-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('string error')
    })
  })

  // --- handleDelete error/catch branches ---

  it('shows error when deleteJob returns failure', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiDeleteJob.mockResolvedValue({ success: false, error: 'Delete failed' })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('delete-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Delete failed')
    })
  })

  it('shows error when deleteJob throws an Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiDeleteJob.mockRejectedValue(new Error('Delete network error'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('delete-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Delete network error')
    })
  })

  it('shows error when deleteJob throws a non-Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiDeleteJob.mockRejectedValue('delete string error')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('delete-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('delete string error')
    })
  })

  // --- handleUpdate error/catch branches ---

  it('shows error when updateJob returns failure', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiUpdateJob.mockResolvedValue({ success: false, error: 'Update failed' })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('update-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Update failed')
    })
  })

  it('shows error when updateJob throws an Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiUpdateJob.mockRejectedValue(new Error('Update network error'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('update-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Update network error')
    })
  })

  it('shows error when updateJob throws a non-Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiUpdateJob.mockRejectedValue('update string error')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('update-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('update string error')
    })
  })

  // --- handleRunNow catch branches ---

  it('shows error when runJobNow throws an Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiRunJobNow.mockRejectedValue(new Error('Run network error'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Run network error'))
    })
  })

  it('shows error when runJobNow throws a non-Error', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiRunJobNow.mockRejectedValue('run string error')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('run string error'))
    })
  })

  // --- handleRunNow success path details ---

  it('calls loadJobs after successful runJobNow', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    mockSchedulerApiListJobs.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    await waitFor(() => {
      expect(mockSchedulerApiListJobs).toHaveBeenCalled()
    })
  })

  // --- availableScheduleAgents memo with profile chats ---

  it('builds availableScheduleAgents from profile chats', async () => {
    mockProfileDataManagerGetProfile.mockReturnValue({
      chats: [
        { chat_id: 'agent-1', agent: { name: 'Test Agent' } },
        { chat_id: 'agent-2', agent: { name: 'Second Agent' } },
        { chat_id: null, agent: { name: 'No ID' } },
        { chat_id: 'agent-3', agent: null },
      ],
    })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
  })

  it('uses chat_id as name fallback when agent.name is empty', async () => {
    mockProfileDataManagerGetProfile.mockReturnValue({
      chats: [
        { chat_id: 'agent-1', agent: { name: '' } },
        { chat_id: 'agent-2', agent: { name: 'Has Name' } },
      ],
    })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getAllByText('Add New Schedule'))
    fireEvent.click(screen.getAllByText('Add New Schedule')[0])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
  })

  it('handles profile with no chats', async () => {
    mockProfileDataManagerGetProfile.mockReturnValue({ chats: null })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByText('0 enabled schedules')).toBeInTheDocument()
    })
  })

  // --- listJobs catch branches ---

  it('shows error when listJobs throws an Error', async () => {
    mockSchedulerApiListJobs.mockRejectedValue(new Error('List network error'))
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('List network error')
    })
  })

  it('shows error when listJobs throws a non-Error', async () => {
    mockSchedulerApiListJobs.mockRejectedValue('list string error')
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('list string error')
    })
  })

  // --- schedule:created/updated edge cases ---

  it('reloads on schedule:created event with no chatId in detail', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schedule:created', { detail: {} }))
    })
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(2))
  })

  it('does not reload on schedule:created for different chatId', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schedule:created', { detail: { chatId: 'other-agent' } }))
    })
    expect(mockSchedulerApiListJobs).toHaveBeenCalledTimes(1)
  })

  // --- agentNames memo with agentData.name not in profile ---

  it('adds agentData.name to agentNames when not in profile', async () => {
    mockProfileDataManagerGetProfile.mockReturnValue({ chats: [] })
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => {
      expect(screen.getByTestId('schedules-content-view')).toBeInTheDocument()
    })
  })

  // --- handleOpenAddSchedule from empty state button ---

  it('opens overlay from empty state Add New Schedule button', async () => {
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByText(/Add one-time or recurring schedules/i))
    const buttons = screen.getAllByText('Add New Schedule')
    fireEvent.click(buttons[buttons.length - 1])
    expect(screen.getByTestId('add-schedule-overlay')).toBeInTheDocument()
  })

  // --- toggleJob/runJobNow with Unknown error ---

  it('shows Unknown error when toggleJob response has no error field', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiToggleJob.mockResolvedValue({ success: false })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('toggle-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-job-1'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toContain('Unknown error')
    })
  })

  it('shows Unknown error when runJobNow response has no error field', async () => {
    const job = makeJob()
    mockSchedulerApiListJobs.mockResolvedValue({ success: true, data: [job] })
    mockSchedulerApiRunJobNow.mockResolvedValue({ success: false })
    render(<AgentSchedulesTab {...defaultProps()} />)
    await waitFor(() => screen.getByTestId('run-job-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-job-1'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })
  })
})
