import React from 'react';
import { UndoTool, SaveTool, CancelTool, ConfirmTool } from './tools';
import { EditArea } from '../../type';
import PainterTools from './painer-tools';
import StickArea from '../../components/stick-area';
import { css } from '../../common/styled';
import { editor_handlers, state_handlers } from '../../state';
import { useModel } from '../../context';

const SBox = css`
  padding: 8px;
  border-radius: 6px;
  background-color: rgba(255, 255, 255, 0.8);
  border: 0.5px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0px 0px 2px 0px rgba(0, 0, 0, 0.12), 0px 8px 16px 0px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(30px);
  cursor: auto;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  @media screen and (forced-colors: active) {
    forced-color-adjust: auto;
  }

  .tool-config-title {
    font-weight: 600;
    font-size: 14px;
    margin: 0 0 8px;
    color: #1a1a1a;
    height: 30px;
    line-height: 30px;
  }
`;
const SDivider = css`
  height: 24px;
  width: 1px;
  background: rgba(0, 0, 0, 0.1);
`;

const stopEvent = (ev: React.MouseEvent) => ev.stopPropagation();

interface Props {
  area: EditArea;
  onCopy: VoidFunction;
}

function Toolbar(props: Props) {
  const { area, onCopy } = props;
  const { save } = editor_handlers.use();
  const { undo, quit } = state_handlers.use();
  const model = useModel();
  const [canUndo, canRedo] = model.useStackState();

  return (
    <StickArea
      className={SBox} area={area} gap={8}
      onMouseDown={stopEvent} onDoubleClick={stopEvent}
      role="toolbar" aria-label="Screenshot Editor"
    >
      <PainterTools />
      <div className={SDivider} aria-hidden="true" />
      <UndoTool onClick={canUndo ? undo : undefined} />
      <SaveTool onClick={save} />
      <CancelTool onClick={quit} />
      <ConfirmTool onClick={onCopy} />
    </StickArea>
  );
}

export default React.memo(Toolbar);
