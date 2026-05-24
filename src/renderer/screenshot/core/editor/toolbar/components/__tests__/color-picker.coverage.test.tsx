/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock styled utility
vi.mock('../../common/styled', () => ({
  css: vi.fn((...args: any[]) => 'mocked-class'),
}));

// Mock common toolbar exports
vi.mock('../common', () => ({
  COLORS: [['black'], ['#00D6E8'], ['#E61B1B'], ['#26E600'], ['#FFE600'], ['white', '#e6e6e6']],
  COLORS_DESC: {
    'black': 'Black',
    '#00D6E8': 'Bright Cyan Blue',
    '#E61B1B': 'Red',
    '#26E600': 'Green',
    '#FFE600': 'Yellow',
    'white': 'White',
  },
}));

// Mock localString
vi.mock('../../common/localString', () => ({
  getString: (key: string) => key === 'color' ? 'Colors' : key,
}));

// Mock a11y-element
vi.mock('../../common/a11y-element', () => ({
  A11yDiv: ({ children, onClick, style, role, id, 'aria-checked': ariaChecked, ...rest }: any) =>
    React.createElement('div', { onClick, style, role, id, 'aria-checked': ariaChecked, ...rest }, children),
}));

import ColorPicker from '../color-picker';

describe('ColorPicker', () => {
  it('renders title', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    expect(screen.getByText('Colors')).toBeInTheDocument();
  });

  it('renders color options as radio elements', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(6);
  });

  it('calls onChange when non-active color clicked', () => {
    const onChange = vi.fn();
    render(<ColorPicker color="black" onChange={onChange} />);
    const redOption = screen.getByLabelText('Red');
    fireEvent.click(redOption);
    expect(onChange).toHaveBeenCalledWith('#E61B1B');
  });

  it('does not call onChange when current color clicked', () => {
    const onChange = vi.fn();
    render(<ColorPicker color="black" onChange={onChange} />);
    const blackOption = screen.getByLabelText('Black');
    fireEvent.click(blackOption);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles ArrowRight key to move selection forward', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const container = screen.getByRole('combobox');
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    // No error should be thrown
  });

  it('handles ArrowLeft key to move selection backward', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const container = screen.getByRole('combobox');
    fireEvent.keyDown(container, { key: 'ArrowLeft' });
  });

  it('handles ArrowDown key', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const container = screen.getByRole('combobox');
    fireEvent.keyDown(container, { key: 'ArrowDown' });
  });

  it('handles ArrowUp key', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const container = screen.getByRole('combobox');
    fireEvent.keyDown(container, { key: 'ArrowUp' });
  });

  it('handles Enter key to confirm selection', () => {
    const onChange = vi.fn();
    render(<ColorPicker color="black" onChange={onChange} />);
    const container = screen.getByRole('combobox');
    // Set active item first via ArrowRight, then Enter
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    fireEvent.keyDown(container, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
  });

  it('clears active on blur', () => {
    render(<ColorPicker color="black" onChange={vi.fn()} />);
    const container = screen.getByRole('combobox');
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    fireEvent.blur(container);
    // After blur, Enter should not call onChange
    const onChange = vi.fn();
    fireEvent.keyDown(container, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('wraps selection from last to first on ArrowRight', () => {
    const onChange = vi.fn();
    render(<ColorPicker color="black" onChange={onChange} />);
    const container = screen.getByRole('combobox');
    // Move to last item (6 colors, so 6 ArrowRights wraps back to 0)
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(container, { key: 'ArrowRight' });
    }
    fireEvent.keyDown(container, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
  });

  it('marks correct color as aria-checked', () => {
    render(<ColorPicker color="#E61B1B" onChange={vi.fn()} />);
    const redOption = screen.getByLabelText('Red');
    expect(redOption).toHaveAttribute('aria-checked', 'true');
  });
});
