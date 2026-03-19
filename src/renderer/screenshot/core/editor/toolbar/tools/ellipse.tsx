import React, { memo } from 'react';
import SizePicker from '../components/size-picker';
import ColorPicker  from '../components/color-picker';
import { Button } from '../components/button';
import {  ChangeToolMethod, DefaultEllipseConfig, EllipseConfig  } from '../common';
import { getString } from '../../../common/localString';
import { ConfigStyle } from './square';
import { useCache } from '../../../context';

const CacheId = Math.random().toString(36).slice(2);

function EllipseTool(props: {
  config?: EllipseConfig,
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultEllipseConfig);

  let configPanel: React.ReactNode;
  if (config) {
    const { type, size, color } = config;
    function apply(s: number, c: string) {
      const config = { type, size: s, color: c };
      last.set(config);
      onChangeTool({ config, applyShape: true });
    }
    configPanel = (
      <div className={ConfigStyle} style={{ borderRadius: 4 }}>
        <SizePicker size={size} type={type} onChange={(s) => apply(s, color)} />
        <ColorPicker color={color} onChange={(c) => apply(size, c)} />
      </div>
    );
  }

  const active = !!config;
  return (
    <Button
      aria-expanded={Boolean(configPanel)}
      aria-label={getString('circle')}
      tooltip={getString('circle')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width={20} height={20} viewBox="0 0 20 20">
        <circle cx="10" cy="10" width="16" height="16" r="8" fill="none" stroke="#212121" />
      </svg>
    </Button>
  );
}

export default memo(EllipseTool);
