/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { WithStore } from '@/atom';

// Lets a single test force the component's useRef to return a null-current ref,
// covering the `if (editAgentMenuRef.current)` false branch in the layout effect.
// Defaults to false so every other test sees the real ref behaviour.
const refControl = vi.hoisted(() => ({ forceNull: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: (init?: unknown) => {
      // Always call the real useRef to keep the hook slot stable.
      const real = (actual.useRef as any)(init);
      if (refControl.forceNull) {
        return { get current() { return null; }, set current(_v) { /* swallow attach */ } };
      }
      return real;
    },
  };
});

const mockAdjustAnchoredDropdownToViewport = vi.fn();
const mockGetAnchoredDropdownPosition = vi.fn().mockReturnValue({ top: 10, left: 20, triggerTop: 0, triggerRight: 0 });

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: mockAdjustAnchoredDropdownToViewport,
  getAnchoredDropdownPosition: mockGetAnchoredDropdownPosition,
  ANCHORED_DROPDOWN_SIZE_PRESETS: { editAgentMenu: { estimatedWidth: 200, estimatedHeight: 300 } },
  AnchoredDropdownPosition: undefined,
}));

vi.mock('../../ui/use-click-out', async () => ({
  useClickOut: vi.fn(),
}));

const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../../lib/featureFlags', async () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
}));

describe('EditAgentMenuDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFeatureFlag.mockReturnValue(false);
  });

  async function importMenu() {
    const mod = await import('../EditAgentMenuDropdown');
    return { default: mod.default, EditAgentMenuAtom: mod.EditAgentMenuAtom };
  }

  it('renders nothing when atom is in closed state', async () => {
    const { default: EditAgentMenuDropdown } = await importMenu();
    const { container } = render(
      <WithStore>
        <EditAgentMenuDropdown />
      </WithStore>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders menu when atom is open', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Select MCP Tools')).toBeInTheDocument();
    expect(screen.getByText('Select Skills')).toBeInTheDocument();
    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();
  });

  it('dispatches agent:editAgent with mcp tab and closes on Select MCP Tools click', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    fireEvent.click(screen.getByText('Select MCP Tools'));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent:editAgent' }),
    );
    const event = dispatchSpy.mock.calls.find(c => (c[0] as CustomEvent).type === 'agent:editAgent')?.[0] as CustomEvent;
    expect(event?.detail?.initialTab).toBe('mcp');

    dispatchSpy.mockRestore();
  });

  it('dispatches agent:editAgent with skills tab on Select Skills click', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    fireEvent.click(screen.getByText('Select Skills'));

    const event = dispatchSpy.mock.calls.find(c => (c[0] as CustomEvent).type === 'agent:editAgent')?.[0] as CustomEvent;
    expect(event?.detail?.initialTab).toBe('skills');
    dispatchSpy.mockRestore();
  });

  it('dispatches agent:editAgent with prompt tab on Edit System Prompt click', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    fireEvent.click(screen.getByText('Edit System Prompt'));

    const event = dispatchSpy.mock.calls.find(c => (c[0] as CustomEvent).type === 'agent:editAgent')?.[0] as CustomEvent;
    expect(event?.detail?.initialTab).toBe('prompt');
    dispatchSpy.mockRestore();
  });

  it('closes menu via close action', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();
    let capturedActions: any;

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      capturedActions = actions;
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();

    await act(async () => {
      capturedActions.close();
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('adjustAnchoredDropdownToViewport is called in layout effect', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    expect(mockAdjustAnchoredDropdownToViewport).toHaveBeenCalled();
  });

  it('toggle() closes the menu when it is already open', async () => {
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();
    let capturedActions: any;
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      capturedActions = actions;
      React.useEffect(() => {
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    await act(async () => {
      render(<WithStore><Wrapper /></WithStore>);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    // getAnchoredDropdownPosition runs only on the open transition
    expect(mockGetAnchoredDropdownPosition).toHaveBeenCalledTimes(1);

    // Second toggle while open must short-circuit and close the menu
    await act(async () => {
      capturedActions.toggle(btn);
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(mockGetAnchoredDropdownPosition).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when open but position resolves to null', async () => {
    mockGetAnchoredDropdownPosition.mockReturnValueOnce(null);
    const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();

    const Wrapper = () => {
      const actions = EditAgentMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        actions.toggle(btn);
      }, []);
      return <EditAgentMenuDropdown />;
    };

    const { container } = render(<WithStore><Wrapper /></WithStore>);
    await act(async () => {});

    // isOpen becomes true but position is null, so the guard returns null
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('skips adjustAnchoredDropdownToViewport when the menu ref is null in the layout effect', async () => {
    // Cover the false branch of `if (editAgentMenuRef.current)` (line 41).
    // The mocked useRef returns a ref whose `current` stays null even after React's
    // commit-phase attach, so the layout effect short-circuits.
    refControl.forceNull = true;
    try {
      const { default: EditAgentMenuDropdown, EditAgentMenuAtom } = await importMenu();

      const Wrapper = () => {
        const actions = EditAgentMenuAtom.useChange();
        React.useEffect(() => {
          const btn = document.createElement('button');
          document.body.appendChild(btn);
          actions.toggle(btn);
        }, []);
        return <EditAgentMenuDropdown />;
      };

      await act(async () => {
        render(<WithStore><Wrapper /></WithStore>);
      });

      // Menu still renders (position is valid), but the viewport adjust is skipped
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(mockAdjustAnchoredDropdownToViewport).not.toHaveBeenCalled();
    } finally {
      refControl.forceNull = false;
    }
  });
});
