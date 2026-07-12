// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import SchedulesContentView from '../SchedulesContentView'
import type { SchedulerJob } from '@shared/ipc/scheduler'

const mocks = vi.hoisted(() => ({
  getJobSessions: vi.fn(),
  navigate: vi.fn(),
  describeCronExpression: vi.fn((expr: string) => `Readable ${expr}`),
}))

vi.mock('../../../ipc/scheduler', () => ({
  schedulerApi: {
    getJobSessions: (...args: unknown[]) => mocks.getJobSessions(...args),
  },
}))

vi.mock('../../../lib/scheduler/cronDescriptions', () => ({
  describeCronExpression: (...args: unknown[]) => mocks.describeCronExpression(...args),
}))

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

function makeJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    id: 'job-1',
    name: 'Coverage schedule',
    description: 'Coverage schedule description',
    scheduleType: 'cron',
    cronExpression: '15 10 * * 1',
    enabled: true,
    chat_id: 'agent-1',
    message: 'Initial coverage message',
    status: 'pending',
    ...overrides,
  }
}

function renderView(jobs: SchedulerJob[], extra: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <SchedulesContentView
        jobs={jobs}
        agentNames={{ 'agent-1': 'Coverage Agent' }}
        error={null}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        onRunNow={vi.fn(async () => true)}
        {...extra}
      />
    </MemoryRouter>,
  )
}

async function expandSchedule() {
  fireEvent.click(screen.getByText('Coverage schedule'))
  await screen.findByText('Friendly Schedule')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getJobSessions.mockResolvedValue({ success: true, data: [] })
  mocks.describeCronExpression.mockImplementation((expr: string) => `Readable ${expr}`)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SchedulesContentView hex coverage additions', () => {
  it('uses neutral design tokens for migrated inline gray styles', () => {
    renderView([])
    expect(screen.getByText(/No scheduled tasks/i).style.color).toBe('var(--color-neutral-500)')
    expect(screen.getByText('create_schedule').style.backgroundColor).toBe('var(--color-neutral-100)')
  })

  it('covers inline edit focus and hover behavior with migrated neutral tokens', async () => {
    const onUpdate = vi.fn()
    renderView([makeJob()], { onUpdate })
    await expandSchedule()

    const message = screen.getByText('Initial coverage message')
    fireEvent.mouseEnter(message)
    expect(message.style.backgroundColor).toBe('var(--color-neutral-100)')
    fireEvent.mouseLeave(message)
    expect(message.style.backgroundColor).toBe('var(--color-neutral-50)')

    vi.useFakeTimers()
    fireEvent.click(message)
    act(() => { vi.runOnlyPendingTimers() })
    const input = screen.getByDisplayValue('Initial coverage message')
    fireEvent.focusIn(input)
    expect(input.style.borderColor).toBeTruthy()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('Initial coverage message')).toBeTruthy()
  })

  it('covers one-time schedules without runAt and raw fallback values', async () => {
    renderView([makeJob({ scheduleType: 'once', cronExpression: undefined, runAt: undefined })])
    await expandSchedule()
    expect(screen.getByText('One-time schedule')).toBeTruthy()
    expect(screen.getByText('-')).toBeTruthy()
  })

  it('covers missing cron expressions and missing executed timestamps', async () => {
    renderView([makeJob({ cronExpression: undefined, executedAt: undefined })])
    await expandSchedule()
    expect(screen.getByText('-')).toBeTruthy()
    expect(screen.queryByText('Executed At')).toBeNull()
  })

  it('falls back when formatted dates throw', async () => {
    const original = Date.prototype.toLocaleString
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function () {
      if (this.toISOString().startsWith('2026-06-20')) throw new Error('format failed')
      return original.call(this)
    })

    renderView([makeJob({ scheduleType: 'once', cronExpression: undefined, runAt: '2026-06-20T10:00:00.000Z' })])
    await expandSchedule()
    expect(screen.getByText('One-time at 2026-06-20T10:00:00.000Z')).toBeTruthy()
  })

  it('covers run-now debounce, hover styles, and the defensive readOnly guard', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T10:00:00.000Z'))
    const onRunNow = vi.fn(async () => true)
    const { rerender } = render(
      <MemoryRouter>
        <SchedulesContentView
          jobs={[makeJob()]}
          agentNames={{ 'agent-1': 'Coverage Agent' }}
          error={null}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
          onRunNow={onRunNow}
        />
      </MemoryRouter>,
    )

    const runNow = screen.getByTitle('Run this schedule immediately')
    fireEvent.mouseEnter(runNow)
    expect(runNow.style.backgroundColor).toBe('var(--color-neutral-50)')
    expect(runNow.style.borderColor).toBe('var(--color-neutral-400)')
    fireEvent.mouseLeave(runNow)
    expect(runNow.style.backgroundColor).toBe('var(--color-white)')
    expect(runNow.style.borderColor).toBe('var(--color-neutral-300)')
    fireEvent.click(runNow)
    fireEvent.click(runNow)
    expect(onRunNow).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1200) })
    fireEvent.click(runNow)
    expect(onRunNow).toHaveBeenCalledTimes(2)

    rerender(
      <MemoryRouter>
        <SchedulesContentView
          jobs={[makeJob()]}
          agentNames={{ 'agent-1': 'Coverage Agent' }}
          error={null}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
          onRunNow={onRunNow}
          readOnly
        />
      </MemoryRouter>,
    )
    const readOnlyRunNow = screen.getByTitle('Run this schedule immediately') as HTMLButtonElement
    readOnlyRunNow.disabled = false
    fireEvent.click(readOnlyRunNow)
    expect(onRunNow).toHaveBeenCalledTimes(2)
  })

  it('covers readOnly edit-button styling and hover guards', () => {
    const onEdit = vi.fn()
    const { rerender } = renderView([makeJob()], { onEdit, readOnly: true })
    const readOnlyEdit = screen.getByTitle('Edit schedule') as HTMLButtonElement
    expect(readOnlyEdit.disabled).toBe(true)
    expect(readOnlyEdit.style.cursor).toBe('not-allowed')
    expect(readOnlyEdit.style.color).toBe('var(--color-neutral-300)')
    readOnlyEdit.disabled = false
    fireEvent.mouseEnter(readOnlyEdit)
    expect(readOnlyEdit.style.color).toBe('var(--color-neutral-300)')
    fireEvent.mouseLeave(readOnlyEdit)
    expect(readOnlyEdit.style.color).toBe('var(--color-neutral-300)')

    rerender(
      <MemoryRouter>
        <SchedulesContentView
          jobs={[makeJob()]}
          agentNames={{ 'agent-1': 'Coverage Agent' }}
          error={null}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
          onRunNow={vi.fn(async () => true)}
          onEdit={onEdit}
        />
      </MemoryRouter>,
    )
    const edit = screen.getByTitle('Edit schedule')
    fireEvent.mouseEnter(edit)
    expect(edit.style.color).toBe('var(--color-neutral-600)')
    fireEvent.mouseLeave(edit)
    expect(edit.style.color).toBe('var(--color-neutral-400)')
  })

  it('covers delete hover styles with migrated neutral tokens', () => {
    renderView([makeJob()])
    const deleteButton = screen.getByTitle('Delete schedule')
    fireEvent.mouseEnter(deleteButton)
    expect(deleteButton.style.color).toBe('var(--color-danger-500)')
    fireEvent.mouseLeave(deleteButton)
    expect(deleteButton.style.color).toBe('var(--color-neutral-400)')
  })

  // NOTE: "Scheduled runs" session-list behavior (loading / count badge / session
  // rendering / navigation) was extracted into ScheduleSessionList by #867 and is
  // covered by ScheduleSessionList.test.tsx. The two prior tests here exercised that
  // relocated code through the old getJobSessions(jobId) contract and are intentionally
  // dropped; this file stays focused on SchedulesContentView's own inline hex/token styles.
})
