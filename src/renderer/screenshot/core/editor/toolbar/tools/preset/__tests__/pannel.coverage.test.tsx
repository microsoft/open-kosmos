/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../common/styled', () => ({
  css: () => 'preset-class',
}));

vi.mock('../../../../../common/a11y-element', () => ({
  A11yDiv: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('../../../../../common/localString', () => ({
  getString: (key: string) => `local:${key}`,
}));

vi.mock('../../../../../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => `translated:${key}`,
  }),
}));

vi.mock('../list', () => ({
  Numbers: [
    {
      key: 'red-number',
      view: <span>red number</span>,
      title: 'red number fallback',
      titleKey: 'screenshot.editor.preset.numberRed',
      config: { type: 'order', index: 0, style: 'red', aspectRatio: 1 },
    },
    {
      key: 'blue-number',
      view: <span>blue number</span>,
      title: 'blue number fallback',
      titleKey: 'screenshot.editor.preset.numberBlue',
      config: { type: 'order', index: 0, style: 'blue', aspectRatio: 1 },
    },
  ],
  Emojis: [
    {
      key: 'flag',
      view: <span>flag emoji</span>,
      title: 'flag fallback',
      config: { type: 'emoji', emoji: 'flag', aspectRatio: 1 },
    },
  ],
}));

import { Pannel } from '../pannel';

describe('Preset Pannel', () => {
  it('renders localized groups and item labels', () => {
    render(
      <Pannel
        current={{ type: 'order', index: 0, style: 'red', aspectRatio: 1 }}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'local:numbers' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'local:emoji' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'translated:screenshot.editor.preset.numberRed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'flag fallback' })).toBeTruthy();
  });

  it('chooses inactive presets and ignores the active preset', () => {
    const onChoose = vi.fn();
    render(
      <Pannel
        current={{ type: 'order', index: 0, style: 'red', aspectRatio: 1 }}
        onChoose={onChoose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'translated:screenshot.editor.preset.numberRed' }));
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'translated:screenshot.editor.preset.numberBlue' }));
    expect(onChoose).toHaveBeenCalledWith({ type: 'order', index: 0, style: 'blue', aspectRatio: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'flag fallback' }));
    expect(onChoose).toHaveBeenCalledWith({ type: 'emoji', emoji: 'flag', aspectRatio: 1 });
  });
});
