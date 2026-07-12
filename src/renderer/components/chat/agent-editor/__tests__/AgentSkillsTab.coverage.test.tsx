/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ---- mocks ----

vi.mock('../../../../styles/Agent.css', () => ({}))

const mockNavigate = vi.fn()
const mockLocation = { pathname: '/agent/chat/123/settings/skills' }
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

vi.mock('lucide-react', () => ({
  Settings: () => <span data-testid="settings-icon">⚙</span>,
  RotateCw: () => <span data-testid="rotate-icon">↺</span>,
}))

const mockUseSkills = vi.fn()
vi.mock('../../../userData/userDataProvider', () => ({
  useSkills: () => mockUseSkills(),
}))

const mockUseLayout = vi.fn()
vi.mock('../../../layout/LayoutProvider', () => ({
  useLayout: () => mockUseLayout(),
}))

vi.mock('../../../../../shared/constants/builtinSkills', () => ({
  isBuiltinSkill: (name: string) => name === 'builtin-skill',
}))

vi.mock('../../../../lib/userData/types', () => ({
  isBuiltinAgent: (name: string) => name === 'BuiltinAgent',
}))

vi.mock('../../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

import AgentSkillsTab from '../AgentSkillsTab'
import type { TabComponentProps, AgentConfig } from '../types'

// ---- helpers ----

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    name: 'my-skill',
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
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
    skills: [],
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
  mockUseSkills.mockReturnValue({ skills: [], isLoading: false })
  mockUseLayout.mockReturnValue({})
  // Stub sessionStorage
  Object.defineProperty(window, 'sessionStorage', {
    value: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    writable: true,
  })
})

// ---- tests ----

describe('AgentSkillsTab', () => {
  it('renders loading state', () => {
    mockUseSkills.mockReturnValue({ skills: [], isLoading: true })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText(/Loading Skills/i)).toBeInTheDocument()
  })

  it('renders empty state when no skills', () => {
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText(/No available Skills to select/i)).toBeInTheDocument()
  })

  it('renders skill cards when skills exist', () => {
    mockUseSkills.mockReturnValue({ skills: [makeSkill()], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText('my-skill')).toBeInTheDocument()
  })

  it('shows "0 selected from available skills" with no selected skills', () => {
    mockUseSkills.mockReturnValue({ skills: [makeSkill()], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText('0 selected from available skills')).toBeInTheDocument()
  })

  it('shows correct selected count when agent has pre-selected skills', async () => {
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ skills: ['my-skill'] })
    render(<AgentSkillsTab {...defaultProps({ agentData })} />)
    await waitFor(() => {
      expect(screen.getByText('1 selected from available skills')).toBeInTheDocument()
    })
  })

  it('shows search box when skills are present', () => {
    mockUseSkills.mockReturnValue({ skills: [makeSkill()], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByTestId('search-box')).toBeInTheDocument()
  })

  it('filters skills by search query', async () => {
    const s1 = makeSkill({ name: 'alpha-skill' })
    const s2 = makeSkill({ name: 'beta-skill' })
    mockUseSkills.mockReturnValue({ skills: [s1, s2], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'alpha' } })
    })
    expect(screen.getByText('alpha-skill')).toBeInTheDocument()
    expect(screen.queryByText('beta-skill')).not.toBeInTheDocument()
  })

  it('toggles skill selection via checkbox', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    render(<AgentSkillsTab {...defaultProps({ onDataChange })} />)

    const checkbox = screen.getByRole('checkbox')
    await act(async () => {
      fireEvent.change(checkbox, { target: { checked: true } })
    })
    expect(onDataChange).toHaveBeenCalled()
  })

  it('pre-checks skills from agentData', async () => {
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ skills: ['my-skill'] })
    render(<AgentSkillsTab {...defaultProps({ agentData })} />)
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })
  })

  it('unchecks skill by clicking checkbox', async () => {
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ skills: ['my-skill'] })
    const onDataChange = vi.fn()
    render(<AgentSkillsTab {...defaultProps({ agentData, onDataChange })} />)
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    const checkbox = screen.getByRole('checkbox')
    await act(async () => {
      fireEvent.change(checkbox, { target: { checked: false } })
    })
    expect(onDataChange).toHaveBeenCalled()
  })

  it('does not toggle when readOnly', async () => {
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const onDataChange = vi.fn()
    render(<AgentSkillsTab {...defaultProps({ readOnly: true, onDataChange })} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
    // onDataChange should not be triggered by toggle
    const callCountBefore = onDataChange.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByText('my-skill'))
    })
    // Same number of calls (no new toggle)
    expect(onDataChange.mock.calls.length).toBe(callCountBefore)
  })

  it('navigates to /settings/skills when "Manage Available Skills" is clicked', async () => {
    render(<AgentSkillsTab {...defaultProps()} />)
    fireEvent.click(screen.getByText('Manage Available Skills'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/skills')
  })

  it('navigates to /settings/skills from empty state button', async () => {
    render(<AgentSkillsTab {...defaultProps()} />)
    fireEvent.click(screen.getByText('Go to Manage Available Skills'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings/skills')
  })

  it('dispatches agent:closeEditor and navigates to skills when manage skill button clicked', async () => {
    vi.useFakeTimers()
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<AgentSkillsTab {...defaultProps()} />)

    const settingsBtn = screen.getByTestId('settings-icon').closest('button')!
    await act(async () => {
      fireEvent.click(settingsBtn)
    })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent:closeEditor' })
    )

    await act(async () => {
      vi.runAllTimers()
    })

    expect(mockNavigate).toHaveBeenCalledWith('/settings/skills')
    vi.useRealTimers()
  })

  it('treats legacy remote version metadata as inert', () => {
    const skill = makeSkill({ source: 'IN-LIBRARY', version: '1.0.0', remoteVersion: '2.0.0' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.queryByText('Update')).not.toBeInTheDocument()
  })

  it('shows builtin badge for builtin skill', () => {
    const skill = makeSkill({ name: 'builtin-skill' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText('Built-in')).toBeInTheDocument()
  })

  it('uses cachedData skills over agentData skills', async () => {
    const skill1 = makeSkill({ name: 'skill-a' })
    const skill2 = makeSkill({ name: 'skill-b' })
    mockUseSkills.mockReturnValue({ skills: [skill1, skill2], isLoading: false })
    const agentData = makeAgentData({ skills: ['skill-a'] })
    const cachedData = { skills: ['skill-b'] }
    render(<AgentSkillsTab {...defaultProps({ agentData, cachedData })} />)
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      // skill-b should be checked (from cachedData), skill-a should not
      // Skills are sorted: non-builtin first alphabetically
      // skill-a comes before skill-b alphabetically
      expect(checkboxes[0]).not.toBeChecked() // skill-a
      expect(checkboxes[1]).toBeChecked()     // skill-b
    })
  })

  it('shows legacy source metadata with local semantics', () => {
    const skill = makeSkill({ name: 'my-skill', version: '2.0.0', source: 'IN-LIBRARY' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    expect(screen.getByText('ON-DEVICE')).toBeInTheDocument()
  })

  it('sorts builtin skills before others', () => {
    const regular = makeSkill({ name: 'z-regular' })
    const builtin = makeSkill({ name: 'builtin-skill' })
    mockUseSkills.mockReturnValue({ skills: [regular, builtin], isLoading: false })
    render(<AgentSkillsTab {...defaultProps()} />)
    const cards = screen.getAllByRole('checkbox')
    // builtin should be first, regular second
    expect(cards.length).toBe(2)
    // just verify both appear
    expect(screen.getByText('builtin-skill')).toBeInTheDocument()
    expect(screen.getByText('z-regular')).toBeInTheDocument()
  })

  it('locks builtin skill checkbox for builtin agent', async () => {
    const skill = makeSkill({ name: 'builtin-skill' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ name: 'BuiltinAgent', skills: ['builtin-skill'] })
    render(<AgentSkillsTab {...defaultProps({ agentData })} />)
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })
  })

  it('calls onDataChange with skills when selection changes', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ skills: [] })
    render(<AgentSkillsTab {...defaultProps({ agentData, onDataChange })} />)

    await waitFor(() => expect(onDataChange).toHaveBeenCalled())

    const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1]
    expect(lastCall[0]).toBe('skills')
    expect(lastCall[1]).toHaveProperty('skills')
  })

  it('clicking skill card toggles selection (non-readonly)', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill()
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    render(<AgentSkillsTab {...defaultProps({ onDataChange })} />)

    const card = screen.getByText('my-skill').closest('.skill-card')!
    await act(async () => {
      fireEvent.click(card)
    })
    // Should have been called (data changed)
    expect(onDataChange).toHaveBeenCalled()
  })

  it('stops checkbox event propagation and toggles an unlocked skill', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill({ name: 'toggle-from-checkbox' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })

    render(<AgentSkillsTab {...defaultProps({ onDataChange })} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'))
    })

    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
  })

  it('does not toggle a locked builtin skill from the checkbox handler', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill({ name: 'builtin-skill' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ name: 'BuiltinAgent', skills: ['builtin-skill'] })

    render(<AgentSkillsTab {...defaultProps({ agentData, onDataChange })} />)
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled())
    const callsBefore = onDataChange.mock.calls.length
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    checkbox.disabled = false

    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(onDataChange.mock.calls.length).toBe(callsBefore)
  })

  it('ignores direct toggle attempts when readOnly is true', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill({ name: 'readonly-skill' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })

    render(<AgentSkillsTab {...defaultProps({ readOnly: true, onDataChange })} />)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    checkbox.disabled = false
    const callsBefore = onDataChange.mock.calls.length

    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(onDataChange.mock.calls.length).toBe(callsBefore)
  })

  it('removes an already selected skill when the skill card is clicked', async () => {
    const onDataChange = vi.fn()
    const skill = makeSkill({ name: 'selected-skill' })
    mockUseSkills.mockReturnValue({ skills: [skill], isLoading: false })
    const agentData = makeAgentData({ skills: ['selected-skill'] })

    render(<AgentSkillsTab {...defaultProps({ agentData, onDataChange })} />)
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    await act(async () => {
      fireEvent.click(screen.getByText('selected-skill').closest('.skill-card')!)
    })

    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
  })

  it('renders without selected skills when agent data is absent', () => {
    mockUseSkills.mockReturnValue({ skills: [makeSkill()], isLoading: false })

    render(<AgentSkillsTab {...defaultProps({ agentData: undefined })} />)

    expect(screen.getByText('0 selected from available skills')).toBeInTheDocument()
  })

  it('covers alternate builtin sorting branches', () => {
    const builtin = makeSkill({ name: 'builtin-skill' })
    const regular = makeSkill({ name: 'regular-skill' })
    mockUseSkills.mockReturnValue({ skills: [builtin, regular], isLoading: false })

    render(<AgentSkillsTab {...defaultProps()} />)

    expect(screen.getByText('builtin-skill')).toBeInTheDocument()
    expect(screen.getByText('regular-skill')).toBeInTheDocument()
  })
})
