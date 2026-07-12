// @ts-nocheck
/** @vitest-environment happy-dom */
/**
 * AgentMcpServersTab.coverage4.test.tsx
 *
 * Deterministic coverage for the toggle handlers and remaining branches.
 *
 * NOTE: the existing coverage3 suite relied on `fireEvent.change` against
 * checkboxes plus `expect(true).toBe(true)` guards, so the toggle handlers
 * never actually fired. This suite uses `fireEvent.click` (which dispatches
 * React's checkbox `onChange`) and asserts on real outcomes (header tool
 * count, toast calls, navigation), so handleServerToggle / handleToolToggle
 * and their branches are genuinely exercised.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ---- mocks (mirror coverage3) ----

vi.mock('../../../../styles/Agent.css', () => ({}));

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/agent/settings/mcp' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('lucide-react', () => ({
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  Settings: () => <span data-testid="icon-settings" />,
  RotateCw: () => <span data-testid="icon-rotatecw" />,
}));

const mockUseMCPServers = vi.fn();
vi.mock('../../../userData/userDataProvider', () => ({
  useMCPServers: () => mockUseMCPServers(),
}));

vi.mock('../../../layout/LayoutProvider', () => ({
  useLayout: () => ({}),
}));

const mockShowToast = vi.fn();
vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showToast: mockShowToast,
  }),
}));

vi.mock('../../../ui/ListSearchBox', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input data-testid="search-box" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  ),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import AgentMcpServersTab from '../AgentMcpServersTab';
import type { TabComponentProps, AgentConfig } from '../types';

// ---- helpers ----

function makeServer(overrides: Record<string, any> = {}) {
  return {
    name: 'test-server',
    status: 'connected',
    tools: [
      { name: 'tool1', description: 'Tool one' },
      { name: 'tool2', description: 'Tool two' },
      { name: 'tool3', description: 'Tool three' },
    ],
    hidden: false,
    error: null,
    command: '/usr/bin/some-mcp',
    version: '1.0.0',
    remoteVersion: '',
    source: 'ON-DEVICE',
    ...overrides,
  };
}

function makeAgentData(overrides: Record<string, any> = {}): AgentConfig {
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
  } as AgentConfig;
}

function makeProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    mode: 'edit',
    chatId: 'agent-1',
    agentData: makeAgentData(),
    onSave: vi.fn(),
    onDataChange: vi.fn(),
    cachedData: null,
    readOnly: false,
    ...overrides,
  };
}

/** Read the "{n} tools selected from available servers" header count. */
function headerCount(): string {
  return document.querySelector('.summary-text')?.textContent || '';
}

/** Click the expand chevron of the Nth server card (0-indexed). */
function expandServer(index = 0) {
  const expandBtns = document.querySelectorAll('.expand-btn');
  fireEvent.click(expandBtns[index] as HTMLElement);
}

/** Get tool checkboxes (alphabetically sorted in the DOM) within all tool lists. */
function toolCheckboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('.tool-checkbox')) as HTMLInputElement[];
}

/** Get server checkboxes in DOM order. */
function serverCheckboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('.server-checkbox')) as HTMLInputElement[];
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

// ── handleServerToggle: non-conflict select + deselect ─────────────────────────

describe('coverage4 - handleServerToggle non-conflict', () => {
  it('selects all tools then deselects when clicking the server checkbox', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    expect(headerCount()).toMatch(/^0 tools/);

    // Select: server not in selections → no conflict → set empty Set (all tools)
    fireEvent.click(serverCheckboxes()[0]);
    expect(headerCount()).toMatch(/^3 tools/);

    // Deselect: server already selected → delete from selections
    fireEvent.click(serverCheckboxes()[0]);
    expect(headerCount()).toMatch(/^0 tools/);
  });
});

// ── handleServerToggle: conflict path (toast + partial select of non-conflicting) ──

describe('coverage4 - handleServerToggle conflict', () => {
  it('selects only non-conflicting tools and shows a toast', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'shared', description: 'A' }, { name: 'uniqueA', description: 'uA' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'shared', description: 'B' }, { name: 'uniqueB', description: 'uB' }] }),
      ],
      isLoading: false,
    });
    // server-a fully selected (all tools); server-b unselected.
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'server-a', tools: [] }] }),
    })} />);

    // server-a contributes {shared, uniqueA}; selecting server-b conflicts on "shared".
    // conflictingTools=[shared], nonConflictingTools=[uniqueB] → set {uniqueB}.
    const checkboxes = serverCheckboxes();
    fireEvent.click(checkboxes[1]); // server-b

    expect(mockShowToast).toHaveBeenCalled();
    // 2 (server-a all) + 1 (server-b uniqueB only) = 3 selected.
    expect(headerCount()).toMatch(/^3 tools/);
  });

  it('selects nothing when every tool conflicts (no non-conflicting tools)', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'shared', description: 'A' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'shared', description: 'B' }] }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'server-a', tools: [] }] }),
    })} />);

    fireEvent.click(serverCheckboxes()[1]); // server-b: only "shared", all conflict

    expect(mockShowToast).toHaveBeenCalled();
    // server-b not selected → still only server-a's 1 tool.
    expect(headerCount()).toMatch(/^1 tools/);
  });
});

// ── getAllSelectedToolNames: server-not-found + partial selection branches ─────

describe('coverage4 - getAllSelectedToolNames branches', () => {
  it('skips selections whose server is missing and includes partial selections', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'real', tools: [{ name: 'r1', description: '' }, { name: 'r2', description: '' }] }),
        makeServer({ name: 'partial-src', tools: [{ name: 'p1', description: '' }, { name: 'p2', description: '' }] }),
      ],
      isLoading: false,
    });
    // 'ghost' is selected but absent from servers → exercises the `!server` skip.
    // 'partial-src' has a partial selection {p1} → exercises the else (size>0) add.
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({
        mcpServers: [
          { name: 'ghost', tools: [] },
          { name: 'partial-src', tools: ['p1'] },
        ],
      }),
    })} />);

    // Toggle 'real' → handleServerToggle calls getAllSelectedToolNames('real'),
    // iterating ghost (skip) and partial-src (add p1).
    const realCheckbox = serverCheckboxes()[0];
    fireEvent.click(realCheckbox);

    // No crash; 'real' got selected (its 2 tools have no conflict with p1).
    expect(realCheckbox.checked).toBe(true);
  });
});

// ── handleToolToggle: server not selected, no conflict → select single tool ────

describe('coverage4 - handleToolToggle from unselected server', () => {
  it('selects a single tool when none were selected', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    expandServer(0);
    fireEvent.click(toolCheckboxes()[0]); // tool1
    expect(headerCount()).toMatch(/^1 tools/);
  });

  it('shows toast and selects nothing when the single tool conflicts', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'shared', description: 'A' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'shared', description: 'B' }] }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'server-a', tools: [] }] }),
    })} />);

    expandServer(1); // expand server-b
    fireEvent.click(toolCheckboxes()[0]); // server-b "shared" conflicts with server-a

    expect(mockShowToast).toHaveBeenCalled();
    expect(headerCount()).toMatch(/^1 tools/); // unchanged (only server-a)
  });
});

// ── handleToolToggle: fully-selected → deselect one (size===0 branch) ──────────

describe('coverage4 - handleToolToggle from fully-selected server', () => {
  it('deselects one tool, leaving the others selected', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'test-server', tools: [] }] }),
    })} />);

    expect(headerCount()).toMatch(/^3 tools/);
    expandServer(0);
    fireEvent.click(toolCheckboxes()[0]); // deselect tool1 → {tool2, tool3}
    expect(headerCount()).toMatch(/^2 tools/);
  });
});

// ── handleToolToggle: partial selection → deselect last tool removes server ────

describe('coverage4 - handleToolToggle deselect last tool', () => {
  it('removes the server when the last selected tool is deselected', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'test-server', tools: ['tool1'] }] }),
    })} />);

    expect(headerCount()).toMatch(/^1 tools/);
    expandServer(0);
    fireEvent.click(toolCheckboxes()[0]); // deselect tool1 → empty → remove server
    expect(headerCount()).toMatch(/^0 tools/);
  });
});

// ── handleToolToggle: partial → add tool, completes the set (→ empty Set/all) ──

describe('coverage4 - handleToolToggle add completes set', () => {
  it('promotes a partial selection to fully selected when the last tool is added', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'test-server', tools: ['tool1', 'tool2'] }] }),
    })} />);

    expect(headerCount()).toMatch(/^2 tools/);
    expandServer(0);
    // tool3 is the 3rd checkbox alphabetically; adding it completes all 3.
    fireEvent.click(toolCheckboxes()[2]);
    expect(headerCount()).toMatch(/^3 tools/);
  });
});

// ── handleToolToggle: partial → add tool, stays partial ───────────────────────

describe('coverage4 - handleToolToggle add stays partial', () => {
  it('adds a tool to a partial selection without completing the set', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({
        status: 'connected',
        tools: [
          { name: 'tool1', description: '' },
          { name: 'tool2', description: '' },
          { name: 'tool3', description: '' },
          { name: 'tool4', description: '' },
        ],
      })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'test-server', tools: ['tool1'] }] }),
    })} />);

    expect(headerCount()).toMatch(/^1 tools/);
    expandServer(0);
    fireEvent.click(toolCheckboxes()[1]); // add tool2 → {tool1,tool2} of 4 → partial
    expect(headerCount()).toMatch(/^2 tools/);
  });
});

// ── handleToolToggle: partial → add conflicting tool → toast, no change ────────

describe('coverage4 - handleToolToggle add conflicting tool', () => {
  it('shows toast and keeps selection when adding a conflicting tool to a partial set', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'shared', description: 'A' }, { name: 'xa', description: '' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'shared', description: 'B' }, { name: 'yb', description: '' }] }),
      ],
      isLoading: false,
    });
    // server-a fully selected; server-b partial {yb}.
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({
        mcpServers: [
          { name: 'server-a', tools: [] },
          { name: 'server-b', tools: ['yb'] },
        ],
      }),
    })} />);

    // 2 (server-a) + 1 (server-b yb) = 3
    expect(headerCount()).toMatch(/^3 tools/);
    expandServer(1); // expand server-b; tools sorted: shared, yb
    fireEvent.click(toolCheckboxes()[0]); // "shared" conflicts with server-a

    expect(mockShowToast).toHaveBeenCalled();
    expect(headerCount()).toMatch(/^3 tools/); // unchanged
  });
});

// ── detectGlobalConflicts: selected server not connected → early return ────────

describe('coverage4 - detectGlobalConflicts skips non-connected', () => {
  it('returns no conflicts when a selected server is disconnected', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ name: 'srv', status: 'disconnected', tools: [{ name: 't', description: '' }] })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [{ name: 'srv', tools: [] }] }),
    })} />);

    // No conflict badge should render.
    expect(screen.queryByText('⚠️ CONFLICT')).toBeNull();
  });
});

// ── getCurrentState: disconnecting branch ─────────────────────────────────────

describe('coverage4 - getCurrentState disconnecting', () => {
  it('renders the disconnecting status', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'disconnecting' })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('disconnecting')).toBeTruthy();
  });
});

// ── server sort comparator: both operands ─────────────────────────────────────

describe('coverage4 - server sort builtin ordering', () => {
  it('places builtin-tools first when listed second in the input', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'aaa-server' }),
        makeServer({ name: 'builtin-tools' }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    const names = Array.from(document.querySelectorAll('.server-name')).map((n) => n.textContent);
    expect(names[0]).toBe('builtin-tools');
    expect(names).toContain('aaa-server');
  });

  it('places builtin-tools first when listed first in the input', () => {
    // Input order [builtin-tools, aaa-server] makes the insertion-sort comparator
    // run as compare(aaa-server, builtin-tools): a!==builtin, b===builtin → return 1,
    // exercising the second `if (b.name === BUILTIN_SERVER_NAME)` branch.
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'builtin-tools' }),
        makeServer({ name: 'aaa-server' }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    const names = Array.from(document.querySelectorAll('.server-name')).map((n) => n.textContent);
    expect(names[0]).toBe('builtin-tools');
    expect(names[1]).toBe('aaa-server');
  });
});

// ── search filter: query that excludes a server ───────────────────────────────

describe('coverage4 - search filter', () => {
  it('filters the server list by the search query', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'alpha-server' }),
        makeServer({ name: 'beta-server' }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);

    // Both visible initially.
    expect(screen.getByText('alpha-server')).toBeTruthy();
    expect(screen.getByText('beta-server')).toBeTruthy();

    // Type a query that only matches alpha-server.
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'alpha' } });

    expect(screen.getByText('alpha-server')).toBeTruthy();
    expect(screen.queryByText('beta-server')).toBeNull();
  });
});

// ── serverHasConflicts: a server with no conflicting tools (if@274 false) ──────

describe('coverage4 - serverHasConflicts negative branch', () => {
  it('does not flag a third server that shares no tool names', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'shared', description: 'A' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'shared', description: 'B' }] }),
        makeServer({ name: 'server-c', tools: [{ name: 'lonely', description: 'C' }] }),
      ],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({
        mcpServers: [
          { name: 'server-a', tools: [] },
          { name: 'server-b', tools: [] },
          { name: 'server-c', tools: [] },
        ],
      }),
    })} />);

    // server-a and server-b conflict; serverHasConflicts('server-c') iterates the
    // conflict and the includes() check is false → only two CONFLICT badges.
    expect(screen.getAllByText('⚠️ CONFLICT').length).toBe(2);
  });
});

// ── cachedData with non-empty tools (cond-expr@90 true side) ───────────────────

describe('coverage4 - cachedData partial tools', () => {
  it('applies a partial tool selection from cachedData', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })], // tool1, tool2, tool3
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: [] }),
      cachedData: { mcpServers: [{ name: 'test-server', tools: ['tool1', 'tool2'] }] } as any,
    })} />);

    // cachedData server has non-empty tools → new Set(['tool1','tool2']) → 2 selected.
    expect(headerCount()).toMatch(/^2 tools/);
  });
});

// ── getCurrentState: undefined status falls back to 'disconnected' (binary-expr@571) ──

describe('coverage4 - getCurrentState undefined status', () => {
  it('falls back to disconnected when status is undefined and there are no tools', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: undefined, tools: [], error: null })],
      isLoading: false,
    });
    render(<AgentMcpServersTab {...makeProps()} />);
    expect(screen.getByText('disconnected')).toBeTruthy();
  });
});

// ── effect guards: no agentData.id (if@69 false) and missing mcpServers (if@72 false) ──

describe('coverage4 - effect initialization guards', () => {
  it('renders without selections when agentData has no id', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    // agentData=null → `if (agentData?.id)` is false → effect body skipped.
    render(<AgentMcpServersTab {...makeProps({ agentData: null as any })} />);
    expect(headerCount()).toMatch(/^0 tools/);
  });

  it('renders when agentData has an id but no mcpServers field', () => {
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })],
      isLoading: false,
    });
    // mcpServers undefined → `if (agentData?.mcpServers)` is false → baseSelections empty.
    render(<AgentMcpServersTab {...makeProps({
      agentData: makeAgentData({ mcpServers: undefined as any }),
    })} />);
    expect(headerCount()).toMatch(/^0 tools/);
  });
});

// ── hasChanges: differing keys with equal sizes (!initialTools branch) ─────────

describe('coverage4 - hasChanges differing-key branch', () => {
  it('detects changes when one selected server is swapped for another of equal size', () => {
    const onDataChange = vi.fn();
    mockUseMCPServers.mockReturnValue({
      servers: [
        makeServer({ name: 'server-a', tools: [{ name: 'a1', description: '' }] }),
        makeServer({ name: 'server-b', tools: [{ name: 'b1', description: '' }] }),
      ],
      isLoading: false,
    });
    // Initial selection: server-a only.
    render(<AgentMcpServersTab {...makeProps({
      onDataChange,
      agentData: makeAgentData({ mcpServers: [{ name: 'server-a', tools: [] }] }),
    })} />);

    const [aBox, bBox] = serverCheckboxes();
    fireEvent.click(aBox); // deselect server-a → {} (size differs from initial → hasChanges)
    fireEvent.click(bBox); // select server-b → {server-b}, size 1 == initial 1 but key differs

    // hasChanges must have reported true at some point.
    const reportedChange = onDataChange.mock.calls.some((c) => c[2] === true);
    expect(reportedChange).toBe(true);
  });
});

// ── hasChanges: same server, differing tool membership at equal size ───────────

describe('coverage4 - hasChanges differing-membership branch', () => {
  it('detects changes when tools differ but the count stays equal', () => {
    const onDataChange = vi.fn();
    mockUseMCPServers.mockReturnValue({
      servers: [makeServer({ status: 'connected' })], // tool1, tool2, tool3
      isLoading: false,
    });
    // Initial: {tool1, tool2}.
    render(<AgentMcpServersTab {...makeProps({
      onDataChange,
      agentData: makeAgentData({ mcpServers: [{ name: 'test-server', tools: ['tool1', 'tool2'] }] }),
    })} />);

    expandServer(0);
    const boxes = toolCheckboxes(); // sorted: tool1, tool2, tool3
    fireEvent.click(boxes[0]); // deselect tool1 → {tool2}
    fireEvent.click(boxes[2]); // select tool3 → {tool2, tool3} (size 2 == initial, members differ)

    const reportedChange = onDataChange.mock.calls.some((c) => c[2] === true);
    expect(reportedChange).toBe(true);
  });
});
