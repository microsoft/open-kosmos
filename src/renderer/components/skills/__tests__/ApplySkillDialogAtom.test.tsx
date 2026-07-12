/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WithStore } from '@/atom';
import { ApplySkillDialogAtom } from '../ApplySkillToAgentsDialog';

function Probe() {
  const [state, actions] = ApplySkillDialogAtom.use();
  return (
    <div>
      <div data-testid="state">{`${state.open}:${state.skillName}`}</div>
      <button onClick={() => actions.setSkill('skill-a')}>set skill</button>
      <button onClick={() => actions.setOpen(false)}>close</button>
      <button onClick={() => actions.cancel()}>cancel</button>
    </div>
  );
}

describe('ApplySkillDialogAtom', () => {
  it('updates and resets dialog state through real atom actions', () => {
    render(
      <WithStore>
        <Probe />
      </WithStore>,
    );

    expect(screen.getByTestId('state')).toHaveTextContent('false:');

    fireEvent.click(screen.getByText('set skill'));
    expect(screen.getByTestId('state')).toHaveTextContent('true:skill-a');

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('state')).toHaveTextContent('false:skill-a');

    fireEvent.click(screen.getByText('cancel'));
    expect(screen.getByTestId('state')).toHaveTextContent('false:');
  });
});
