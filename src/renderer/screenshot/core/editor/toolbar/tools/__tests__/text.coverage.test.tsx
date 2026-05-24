/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// --- mocks ---
vi.mock('../../../../common/localString', () => ({
  getString: (key: string) => key,
}));

vi.mock('../../../../common/styled', () => ({
  css: (tpl: TemplateStringsArray, ..._: any[]) => tpl[0] ?? 'cls',
}));

vi.mock('../../../../context', () => ({
  useCache: vi.fn(() => ({ value: { type: 'text', size: 30, color: '#E61B1B' }, set: vi.fn() })),
}));

vi.mock('../../components/color-picker', () => ({
  default: ({ onChange }: { onChange: (c: string) => void }) => (
    <button data-testid="color-picker" onClick={() => onChange('#fff')}>
      ColorPicker
    </button>
  ),
}));

vi.mock('../../components/button', () => ({
  Button: ({ children, onClick, active, expand }: any) => (
    <div>
      <button data-testid="main-button" data-active={active} onClick={onClick}>
        {children}
      </button>
      {expand && <div data-testid="config-panel">{expand}</div>}
    </div>
  ),
}));

vi.mock('../../../../common/a11y-element', () => ({
  A11yButton: ({ children, onClick, disabled, 'aria-label': label, ...rest }: any) => (
    <button
      data-testid={`a11y-${label}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock('../square', () => ({
  ConfigStyle: 'config-style',
}));

import TextTool from '../text';

function renderTextTool(config?: any, onChangeTool?: any) {
  const handler = onChangeTool ?? vi.fn();
  render(<TextTool config={config} onChangeTool={handler} />);
  return handler;
}

describe('TextTool — inactive (no config)', () => {
  it('renders the main button', () => {
    renderTextTool(undefined);
    expect(screen.getByTestId('main-button')).toBeDefined();
  });

  it('does not render config panel when config is undefined', () => {
    renderTextTool(undefined);
    expect(screen.queryByTestId('config-panel')).toBeNull();
  });

  it('calls onChangeTool with last.value on click', () => {
    const handler = renderTextTool(undefined);
    fireEvent.click(screen.getByTestId('main-button'));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ blurShape: true })
    );
  });
});

describe('TextTool — active (with config)', () => {
  const config = { type: 'text' as const, size: 30, color: '#E61B1B' };

  it('renders config panel when config is provided', () => {
    renderTextTool(config);
    expect(screen.getByTestId('config-panel')).toBeDefined();
  });

  it('clicking main button deactivates (passes null config)', () => {
    const handler = renderTextTool(config);
    fireEvent.click(screen.getByTestId('main-button'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ config: null }));
  });

  it('increase button is disabled at MAX_SIZE (96)', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 96 }} onChangeTool={handler} />);
    const increaseBtn = screen.getByTestId('a11y-increaseText');
    expect((increaseBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('decrease button is disabled at MIN_SIZE (10)', () => {
    render(<TextTool config={{ ...config, size: 10 }} onChangeTool={vi.fn()} />);
    const decreaseBtn = screen.getByTestId('a11y-decreaseText');
    expect((decreaseBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking increase applies next preset size', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 24 }} onChangeTool={handler} />);
    fireEvent.click(screen.getByTestId('a11y-increaseText'));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ size: 36 }) })
    );
  });

  it('clicking decrease applies previous preset size', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 24 }} onChangeTool={handler} />);
    fireEvent.click(screen.getByTestId('a11y-decreaseText'));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ size: 16 }) })
    );
  });

  it('color picker change applies color', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 30 }} onChangeTool={handler} />);
    fireEvent.click(screen.getByTestId('color-picker'));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ color: '#fff' }) })
    );
  });
});

describe('Input sub-component (via text.tsx integration)', () => {
  const config = { type: 'text' as const, size: 30, color: '#E61B1B' };

  it('renders size input with correct value', () => {
    renderTextTool(config);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('30');
  });

  it('onFocus shows temp value', () => {
    renderTextTool(config);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.value).toBe('30');
  });

  it('onChange updates temp value', () => {
    renderTextTool(config);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '48' } });
    expect(input.value).toBe('48');
  });

  it('onBlur commits the clamped size', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 30 }} onChangeTool={handler} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.blur(input);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ size: 50 }) })
    );
  });

  it('onBlur clamps above MAX_SIZE', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 30 }} onChangeTool={handler} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.blur(input);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ size: 96 }) })
    );
  });

  it('onBlur clamps below MIN_SIZE', () => {
    const handler = vi.fn();
    render(<TextTool config={{ ...config, size: 30 }} onChangeTool={handler} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ size: 10 }) })
    );
  });

  it('onChange ignores non-numeric input', () => {
    renderTextTool(config);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    // value stays at previous temp (30)
    expect(input.value).toBe('30');
  });

  it('onChange clears when value is empty string', () => {
    renderTextTool(config);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
  });
});
