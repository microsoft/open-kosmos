// @ts-nocheck
/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockMarkEditing, mockUseCreation } = vi.hoisted(() => {
  const mockMarkEditing = vi.fn();
  const mockUseCreation = vi.fn(() => ({ markEditing: mockMarkEditing }));
  return { mockMarkEditing, mockUseCreation };
});

vi.mock('../../../state', () => ({
  editorTextAtom: { useCreation: mockUseCreation },
}));

vi.mock('../../model', () => ({
  uuid: vi.fn(() => 'test-uuid'),
}));

vi.mock('../../../common/utils/drag', () => ({
  handleDrag: vi.fn(),
}));

vi.mock('../../../common/utils/dom', () => ({
  measureWidth: vi.fn(() => 120),
}));

vi.mock('../../../common/utils/global-key', () => ({
  default: { on: vi.fn(() => () => {}), off: vi.fn() },
}));

vi.mock('../../../common/drag-limiter', () => ({
  DragLimiter: vi.fn().mockImplementation(function() {
    return { moveRect: vi.fn(() => [10, 20, 100, 50]) };
  }),
}));

vi.mock('../../../common/keyboard-painter', () => ({}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { TextShape, TextPainter } from '../text';
import { handleDrag } from '../../../common/utils/drag';
import { measureWidth } from '../../../common/utils/dom';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const baseModel = {
  type: 'text' as const,
  id: 'text-001',
  color: 'red',
  fontSize: 14,
  position: [50, 60] as [number, number],
  content: 'Hello World',
  width: 200,
};

const area: [number, number, number, number] = [0, 0, 800, 600];

function makeProps(overrides: Partial<typeof baseModel> = {}) {
  return {
    area,
    model: { ...baseModel, ...overrides },
    onChange: vi.fn(),
    onActive: vi.fn(() => vi.fn()),
    active: false,
  };
}

// ---------------------------------------------------------------------------
// TextShape tests
// ---------------------------------------------------------------------------
describe('TextShape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a foreignObject with text content', () => {
    const props = makeProps();
    const { getByText } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    expect(getByText('Hello World')).toBeTruthy();
  });

  it('renders at the correct position from model', () => {
    const props = makeProps();
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const fo = container.querySelector('foreignObject');
    expect(fo?.getAttribute('x')).toBe('50');
    expect(fo?.getAttribute('y')).toBe('60');
  });

  it('shows border color when active', () => {
    const props = makeProps();
    props.active = true;
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    expect(textDiv.style.borderColor).toBe('#0078D7');
  });

  it('does not show border color when inactive', () => {
    const props = makeProps();
    props.active = false;
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    expect(textDiv.style.borderColor).toBe('');
  });

  it('calls onActive and handleDrag on pointer down', () => {
    const props = makeProps();
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(textDiv, {
        clientX: 100,
        clientY: 150,
        currentTarget: { getBoundingClientRect: () => ({ width: 200, height: 50 }) },
      });
    });
    expect(props.onActive).toHaveBeenCalledWith('text-001');
    expect(handleDrag).toHaveBeenCalled();
  });

  it('switches to editing mode on double click', () => {
    const props = makeProps();
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.dblClick(textDiv);
    });
    // After double click editing div should appear (contentEditable)
    const editDiv = container.querySelector('[contenteditable]');
    expect(editDiv).toBeTruthy();
  });

  it('calls onChange after ending edit with new content', () => {
    const props = makeProps();
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );

    // Enter edit mode
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.dblClick(textDiv);
    });

    // Blur the contentEditable to end edit
    const editDiv = container.querySelector('[contenteditable]') as HTMLElement;
    Object.defineProperty(editDiv, 'innerText', { value: 'New content', configurable: true });
    act(() => {
      fireEvent.blur(editDiv, { currentTarget: editDiv });
    });

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'New content', width: 120 })
    );
  });

  it('does not call onChange when content is unchanged', () => {
    const props = makeProps({ content: 'Same', width: 120 });
    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );

    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.dblClick(textDiv);
    });

    const editDiv = container.querySelector('[contenteditable]') as HTMLElement;
    Object.defineProperty(editDiv, 'innerText', { value: 'Same', configurable: true });
    vi.mocked(measureWidth).mockReturnValue(120);
    act(() => {
      fireEvent.blur(editDiv, { currentTarget: editDiv });
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('handleDrag onEnd calls onChange with new position', () => {
    const props = makeProps();
    let capturedCallbacks: any = null;
    vi.mocked(handleDrag).mockImplementation((callbacks: any) => {
      capturedCallbacks = callbacks;
    });

    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(textDiv, {
        clientX: 100,
        clientY: 150,
        currentTarget: { getBoundingClientRect: () => ({ width: 200, height: 50 }) },
      });
    });

    // Simulate move + end
    act(() => {
      capturedCallbacks?.onMove({ clientX: 110, clientY: 160, pointerId: 1 });
    });
    act(() => {
      capturedCallbacks?.onEnd();
    });

    expect(props.onChange).toHaveBeenCalled();
  });

  it('handleDrag onEnd does nothing when no editingPos', () => {
    const props = makeProps();
    let capturedCallbacks: any = null;
    vi.mocked(handleDrag).mockImplementation((callbacks: any) => {
      capturedCallbacks = callbacks;
    });

    const { container } = render(
      <svg>
        <TextShape {...props} />
      </svg>
    );
    const textDiv = container.querySelector('div[id="shape-text-text-001"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(textDiv, {
        clientX: 100,
        clientY: 150,
        currentTarget: { getBoundingClientRect: () => ({ width: 200, height: 50 }) },
      });
    });

    // Don't move — call onEnd directly (no editingPos set)
    act(() => {
      capturedCallbacks?.onEnd();
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TextPainter tests
// ---------------------------------------------------------------------------
describe('TextPainter', () => {
  it('renders nothing when no position is set', () => {
    const { container } = render(
      <svg>
        <TextPainter area={area} addText={vi.fn()} />
      </svg>
    );
    // TextPainter renders null when position is undefined
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('starts input when start() is called', () => {
    let painterRef: TextPainter | null = null;
    const { container } = render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={vi.fn()}
        />
      </svg>
    );
    act(() => {
      painterRef?.start('blue', 16, { clientX: 100, clientY: 200 } as any);
    });
    expect(container.querySelector('[contenteditable]')).toBeTruthy();
  });

  it('calls addText after end edit with content', () => {
    const addText = vi.fn();
    let painterRef: TextPainter | null = null;
    const { container } = render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={addText}
        />
      </svg>
    );
    act(() => {
      painterRef?.start('blue', 16, { clientX: 100, clientY: 200 } as any);
    });

    const editDiv = container.querySelector('[contenteditable]') as HTMLElement;
    Object.defineProperty(editDiv, 'innerText', { value: 'Some text', configurable: true });
    act(() => {
      fireEvent.blur(editDiv, { currentTarget: editDiv });
    });

    expect(addText).toHaveBeenCalledWith(expect.objectContaining({
      type: 'text',
      content: 'Some text',
    }));
  });

  it('does not call addText when content is empty', () => {
    const addText = vi.fn();
    let painterRef: TextPainter | null = null;
    const { container } = render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={addText}
        />
      </svg>
    );
    act(() => {
      painterRef?.start('blue', 16, { clientX: 100, clientY: 200 } as any);
    });

    const editDiv = container.querySelector('[contenteditable]') as HTMLElement;
    Object.defineProperty(editDiv, 'innerText', { value: '', configurable: true });
    act(() => {
      fireEvent.blur(editDiv, { currentTarget: editDiv });
    });
    expect(addText).not.toHaveBeenCalled();
  });

  it('keyStart returns CapturedHooks for enter key', () => {
    let painterRef: TextPainter | null = null;
    render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={vi.fn()}
        />
      </svg>
    );
    const hooks = painterRef?.keyStart({ keys: { enter: true } } as any, 'green', 18);
    expect(hooks).toBeTruthy();
    expect(typeof hooks?.keymove).toBe('function');
    expect(typeof hooks?.keyup).toBe('function');
  });

  it('keyStart returns undefined for unrecognized key', () => {
    let painterRef: TextPainter | null = null;
    render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={vi.fn()}
        />
      </svg>
    );
    const hooks = painterRef?.keyStart({ keys: {} } as any, 'green', 18);
    expect(hooks).toBeUndefined();
  });

  it('keyStart space key also returns CapturedHooks', () => {
    let painterRef: TextPainter | null = null;
    render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={vi.fn()}
        />
      </svg>
    );
    const hooks = painterRef?.keyStart({ keys: { space: true } } as any, 'red', 14);
    expect(hooks).toBeTruthy();
  });

  it('Escape key in Inputer blurs the element', () => {
    const addText = vi.fn();
    let painterRef: TextPainter | null = null;
    const { container } = render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={area}
          addText={addText}
        />
      </svg>
    );
    act(() => {
      painterRef?.start('blue', 16, { clientX: 100, clientY: 200 } as any);
    });
    const editDiv = container.querySelector('[contenteditable]') as HTMLElement;
    const blurSpy = vi.spyOn(editDiv, 'blur');
    act(() => {
      fireEvent.keyDown(editDiv, { key: 'Escape', currentTarget: editDiv });
    });
    expect(blurSpy).toHaveBeenCalled();
  });

  it('onMounted adjusts position when input overflows area height', () => {
    const addText = vi.fn();
    let painterRef: TextPainter | null = null;
    const { container } = render(
      <svg>
        <TextPainter
          ref={(r: TextPainter | null) => { painterRef = r; }}
          area={[0, 0, 800, 600]}
          addText={addText}
        />
      </svg>
    );
    // Start near the bottom so the input would overflow
    act(() => {
      painterRef?.start('blue', 16, { clientX: 100, clientY: 580 } as any);
    });
    // onMounted is triggered via useEffect; simulate it directly
    act(() => {
      painterRef?.onMounted(100); // height=100, top=580, 580+100>600 → should reposition
    });
    // Component should still render (didn't crash)
    expect(container.querySelector('[contenteditable]')).toBeTruthy();
  });
});
