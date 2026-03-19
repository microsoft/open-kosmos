import React, { memo } from 'react';
import SizePicker from '../components/size-picker';
import ColorPicker  from '../components/color-picker';
import { Button } from '../components/button';
import { ChangeToolMethod, DefaultSquareConfig, SquareConfig } from '../common';
import { getString } from '../../../common/localString';
import { css } from '../../../common/styled';
import { useCache } from '../../../context';

export const ConfigStyle = css`
  background: #f7f7f7;
  width: 152px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.14);
  border: 1px solid #e9e8e8;
  border-radius: 4px;
  padding: 8px 12px 16px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  @media screen and (forced-colors: active) {
    forced-color-adjust: auto;
    .tool-config-title {
      forced-color-adjust: auto;
    }
    & [role='radio'] {
      forced-color-adjust: none;
      &.tab-active, &.active {
        border: 2px solid Highlight!important;
      }
    }
  }
`;

const CacheId = Math.random().toString(36).slice(2);

function SquareTool(props: {
  config?: SquareConfig,
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultSquareConfig);

  let configPanel: React.ReactNode;
  if (config) {
    const { type, size, color } = config;
    function apply(s: number, c: string) {
      const config = { type, size: s, color: c };
      last.set(config);
      onChangeTool({ config, applyShape: true });
    }
    configPanel = (
      <div className={ConfigStyle} style={{ borderRadius: 8 }}>
        <SizePicker size={size} type={type} onChange={(s) => apply(s, color)} />
        <ColorPicker color={color} onChange={(c) => apply(size, c)} />
      </div>
    );
  }

  const active = !!config;
  return (
    <Button
      aria-expanded={Boolean(configPanel)}
      aria-label={getString('square')}
      tooltip={getString('square')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width={20} height={20} viewBox="0 0 20 20">
        <rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="#212121" />
      </svg>
    </Button>
  );
}

export default memo(SquareTool);
