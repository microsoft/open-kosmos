/** @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSave = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());
const mockQuit = vi.hoisted(() => vi.fn());
const stackState = vi.hoisted(() => ({ canUndo: true, canRedo: false }));

vi.mock('../../../common/styled', () => ({
  css: () => 'toolbar-class',
}));

vi.mock('../tools', () => ({
  UndoTool: ({ onClick }: { onClick?: VoidFunction }) => (
    <button disabled={!onClick} onClick={onClick}>undo</button>
  ),
  SaveTool: ({ onClick }: { onClick: VoidFunction }) => <button onClick={onClick}>save</button>,
  CancelTool: ({ onClick }: { onClick: VoidFunction }) => <button onClick={onClick}>cancel</button>,
  ConfirmTool: ({ onClick }: { onClick: VoidFunction }) => <button onClick={onClick}>confirm</button>,
}));

vi.mock('../painer-tools', () => ({
  default: () => <div data-testid="painter-tools" />,
}));

vi.mock('../../../components/stick-area', () => ({
  default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="stick-area" {...props}>{children}</div>
  ),
}));

vi.mock('../../../state', () => ({
  editor_handlers: {
    use: () => ({ save: mockSave }),
  },
  state_handlers: {
    use: () => ({ undo: mockUndo, quit: mockQuit }),
  },
}));

vi.mock('../../../context', () => ({
  useModel: () => ({
    useStackState: () => [stackState.canUndo, stackState.canRedo],
  }),
}));

import Toolbar from '../screenshot-bar';

describe('screenshot toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stackState.canUndo = true;
  });

  it('renders localized toolbar chrome and wires actions', () => {
    const onCopy = vi.fn();

    render(<Toolbar area={[0, 0, 100, 100]} onCopy={onCopy} />);

    expect(screen.getByRole('toolbar', { name: 'Screenshot Editor' })).toBeTruthy();
    expect(screen.getByTestId('painter-tools')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('stick-area'));
    fireEvent.doubleClick(screen.getByTestId('stick-area'));

    fireEvent.click(screen.getByText('undo'));
    fireEvent.click(screen.getByText('save'));
    fireEvent.click(screen.getByText('cancel'));
    fireEvent.click(screen.getByText('confirm'));

    expect(mockUndo).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockQuit).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('disables undo when the model stack cannot undo', () => {
    stackState.canUndo = false;

    render(<Toolbar area={[0, 0, 100, 100]} onCopy={vi.fn()} />);

    expect(screen.getByText('undo')).toBeDisabled();
  });
});
