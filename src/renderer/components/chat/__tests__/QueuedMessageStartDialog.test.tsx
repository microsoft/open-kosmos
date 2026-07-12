/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QueuedMessageStartDialog from '../QueuedMessageStartDialog';

describe('QueuedMessageStartDialog', () => {
  function setup() {
    const onCancel = vi.fn();
    const onKeepQueue = vi.fn();
    const onClearQueue = vi.fn();
    const utils = render(
      <QueuedMessageStartDialog
        onCancel={onCancel}
        onKeepQueue={onKeepQueue}
        onClearQueue={onClearQueue}
      />,
    );
    return { onCancel, onKeepQueue, onClearQueue, ...utils };
  }

  it('renders the confirmation and wires each action button', () => {
    const { onCancel, onKeepQueue, onClearQueue } = setup();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Start with queued prompts?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Keep queue' }));
    expect(onKeepQueue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(onClearQueue).toHaveBeenCalledTimes(1);
  });

  it('treats Escape as cancel via the shared dialog', () => {
    const { onCancel } = setup();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('treats an overlay click as cancel', () => {
    const { onCancel, container } = setup();

    const overlay = container.querySelector('.dialog-overlay-animate');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
