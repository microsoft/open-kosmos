import React from 'react';
import { css } from '../../../../common/styled';
import { PresetModel } from '../../../model';
import { Numbers, Emojis, Item } from './list';
import { A11yDiv } from '../../../../common/a11y-element';
import { getString } from '../../../../common/localString';

const GridSize = 32;

const SPannel = css`
  background: #F5F5F5;
  min-width: 168px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.14);
  border: 1px solid #e9e8e8;
  border-radius: 8px;
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  @media screen and (forced-colors: active) {
    forced-color-adjust: auto;
    .tool-config-title {
      forced-color-adjust: auto;
    }
  }
`;

const SBox = css`
  display: grid;
  border-radius: 4px;
  grid-template-columns: repeat(auto-fill, ${GridSize}px);
  gap: 6px;
`;
const SItem = css`
  height: ${GridSize}px;
  border-radius: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  user-select: none;
  cursor: pointer;
  &:hover {
    background: rgba(0, 0, 0, 0.08);
  }
  &.active {
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid #2169EB;
  }
`;
export function Pannel(props: {
  current: PresetModel['content'];
  onChoose: (config: PresetModel['content']) => void;
}) {
  const { current, onChoose } = props;

  const renderList = (list: Item[]) => {
    return list.map(({ key, config, view, title }) => {
      let  active = current === config;
      if (config.type === 'order') {
        active = current.type === config.type && current.style === config.style;
      }
      const handle = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        e.stopPropagation();
        if (!active) onChoose(config);
      }
      return (
        <div role='listitem' key={key}>
          <A11yDiv
                role='button'
                aria-label={title}
                title={title}
                className={SItem + (active ? ' active' : '')}
                onClick={handle}>
            {view}
          </A11yDiv>
        </div>
      );
    });
  }

  return (
    <div className={SPannel}>
      <div role="group" aria-label={getString('numbers')}>
        <h4 className="tool-config-title">{getString('numbers')}</h4>
        <div role='list' className={SBox} >
          {renderList(Numbers)}
        </div>
      </div>
      <div role="group" aria-label={getString('emoji')}>
        <h4 className="tool-config-title">{getString('emoji')}</h4>
        <div role='list' className={SBox} >
          {renderList(Emojis)}
        </div>
      </div>
    </div>
  );
}

