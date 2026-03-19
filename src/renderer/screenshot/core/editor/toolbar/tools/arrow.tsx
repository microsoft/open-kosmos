import React, { memo } from 'react';
import SizePicker from '../components/size-picker';
import ColorPicker  from '../components/color-picker';
import { Button } from '../components/button';
import { ArrowConfig, ChangeToolMethod, DefaultArrowConfig} from '../common';
import { getString } from '../../../common/localString';
import { ConfigStyle } from './square';
import { useCache } from '../../../context';

const CacheId = Math.random().toString(36).slice(2);

function ArrowTool(props: {
  config?: ArrowConfig,
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultArrowConfig);

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
        <SizePicker size={size} type={type}  onChange={(s) => apply(s, color)} />
        <ColorPicker color={color} onChange={(c) => apply(size, c)} />
      </div>
    );
  }

  const active = !!config;
  return (
    <Button
      aria-expanded={Boolean(configPanel)}
      aria-label={getString('arrow')}
      tooltip={getString('arrow')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M8.50005 4C8.2239 4 8.00005 3.77614 8.00005 3.5C8.00005 3.22386 8.2239 3 8.50005 3H16.5C16.7761 3 17 3.22386 17 3.5V11.5C17 11.7761 16.7761 12 16.5 12C16.2239 12 16 11.7761 16 11.5V4.7071L3.85355 16.8536C3.65829 17.0488 3.34171 17.0488 3.14645 16.8536C2.95118 16.6583 2.95119 16.3417 3.14645 16.1464L15.2929 4H8.50005Z" fill="#212121" />
      </svg>
    </Button>
  );
}

export default memo(ArrowTool);
