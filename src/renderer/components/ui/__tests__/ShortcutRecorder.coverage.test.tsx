/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// mock lucide-react icons used by ShortcutRecorder
vi.mock('lucide-react', () => ({
  Keyboard: () => <svg data-testid="icon-keyboard" />,
  X: () => <svg data-testid="icon-x" />,
  Check: () => <svg data-testid="icon-check" />,
}));

import ShortcutRecorder from '../ShortcutRecorder';

describe('ShortcutRecorder – initial render', () => {
  it('renders placeholder when no value', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    expect(screen.getByText('Press keys to record shortcut...')).toBeTruthy();
  });

  it('renders custom placeholder', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} placeholder="Custom placeholder" />);
    expect(screen.getByText('Custom placeholder')).toBeTruthy();
  });

  it('renders existing shortcut value as kbd elements', () => {
    render(<ShortcutRecorder value="CommandOrControl+S" onChange={vi.fn()} />);
    expect(screen.getByText('CommandOrControl')).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('renders clear button when value present', () => {
    render(<ShortcutRecorder value="CommandOrControl+S" onChange={vi.fn()} />);
    expect(screen.getByTitle('Clear shortcut')).toBeTruthy();
  });

  it('does not render clear button when value empty', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Clear shortcut')).toBeNull();
  });

  it('does not render save/cancel buttons when neither callback provided', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Save shortcut')).toBeNull();
    expect(screen.queryByTitle('Cancel')).toBeNull();
  });

  it('renders save button when onSave provided', () => {
    render(<ShortcutRecorder value="A" onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTitle('Save shortcut')).toBeTruthy();
  });

  it('renders cancel button when onCancel provided', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTitle('Cancel')).toBeTruthy();
  });
});

describe('ShortcutRecorder – clear shortcut', () => {
  it('clear button calls onChange with empty string', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="CommandOrControl+S" onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Clear shortcut'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('ShortcutRecorder – recording mode', () => {
  it('starts recording when clicked', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    expect(screen.getByText('Press key combination...')).toBeTruthy();
  });

  it('does not start recording when disabled', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} disabled={true} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    expect(screen.queryByText('Press key combination...')).toBeNull();
  });

  it('shows recording status text while recording', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    expect(screen.getByText(/Recording shortcut/)).toBeTruthy();
  });

  it('stops recording on blur', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    expect(screen.getByText('Press key combination...')).toBeTruthy();
    fireEvent.blur(input);
    expect(screen.queryByText('Press key combination...')).toBeNull();
  });

  it('captures alphanumeric key without modifier', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('captures Ctrl+key combination', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+A');
  });

  it('captures Alt+Shift+key combination', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'f', ctrlKey: false, metaKey: false, altKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('Alt+Shift+F');
  });

  it('ignores pure modifier key press (no accelerator produced)', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Control', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('converts special keys: Space', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: ' ', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Space');
  });

  it('converts special keys: Enter → Return', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Return');
  });

  it('converts arrow keys: ArrowUp → Up', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowUp', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Up');
  });

  it('converts arrow keys: ArrowDown → Down', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Down');
  });

  it('converts arrow keys: ArrowLeft/Right', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Left');
  });

  it('converts Escape → Esc', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Escape', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Esc');
  });

  it('converts Tab key', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Tab', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Tab');
  });

  it('converts Backspace', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Backspace', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Backspace');
  });

  it('converts Delete', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Delete', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Delete');
  });

  it('keyDown is ignored when not recording', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    // Do not click to start recording
    fireEvent.keyDown(input, { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyUp is ignored when not recording', () => {
    const onChange = vi.fn();
    render(<ShortcutRecorder value="" onChange={onChange} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.keyUp(input, { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyUp without modifiers stops recording after delay', async () => {
    vi.useFakeTimers();
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'a', ctrlKey: false });
    fireEvent.keyUp(input, { key: 'a', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('Press key combination...')).toBeNull();
    vi.useRealTimers();
  });

  it('keyUp with modifier held does not stop recording', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    // Hold ctrl while releasing
    fireEvent.keyUp(input, { key: 'a', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
    expect(screen.getByText('Press key combination...')).toBeTruthy();
  });
});

describe('ShortcutRecorder – requireModifier validation', () => {
  it('shows validation error when key pressed without modifier', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} requireModifier={true} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'a', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    // stop recording so error shows
    fireEvent.blur(input);
    expect(screen.getByText(/modifier key/)).toBeTruthy();
  });

  it('no validation error when modifier is included', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} requireModifier={true} />);
    const input = document.querySelector('[tabindex="0"]')!;
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    fireEvent.blur(input);
    expect(screen.queryByText(/modifier key/)).toBeNull();
  });
});

describe('ShortcutRecorder – save/cancel actions', () => {
  it('save button calls onSave and stops recording', () => {
    const onSave = vi.fn();
    render(<ShortcutRecorder value="CommandOrControl+S" onChange={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByTitle('Save shortcut'));
    expect(onSave).toHaveBeenCalled();
  });

  it('save button is disabled when no recorded shortcut', () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} onSave={vi.fn()} />);
    const saveBtn = screen.getByTitle('Save shortcut') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('cancel button calls onCancel and resets to original value', () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <ShortcutRecorder value="CommandOrControl+S" onChange={onChange} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTitle('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+S');
  });
});

describe('ShortcutRecorder – value prop sync', () => {
  it('updates displayed shortcut when value prop changes', () => {
    const { rerender } = render(<ShortcutRecorder value="CommandOrControl+A" onChange={vi.fn()} />);
    expect(screen.getByText('CommandOrControl')).toBeTruthy();
    rerender(<ShortcutRecorder value="Alt+B" onChange={vi.fn()} />);
    expect(screen.getByText('Alt')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });
});
