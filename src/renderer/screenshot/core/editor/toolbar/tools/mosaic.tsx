import React, { memo } from 'react';
import SizePicker from '../components/size-picker';
import { Button } from '../components/button';
import { ChangeToolMethod, DefaultMosaicConfig, MosaicConfig  } from '../common';
import { getString } from '../../../common/localString';
import { ConfigStyle } from './square';
import { useCache } from '../../../context';

const CacheId = Math.random().toString(36).slice(2);

function MosaicTool(props: {
  config?: MosaicConfig;
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultMosaicConfig);

  let configPanel: React.ReactNode;
  if (config) {
    const { type, size } = config;
    function apply(s: number) {
      const config = { type, size: s };
      last.set(config);
      onChangeTool({ config, applyShape: true });
    }
    configPanel = (
      <div className={ConfigStyle} style={{ borderRadius: 4 }}>
        <SizePicker size={size} type={type} onChange={apply} />
      </div>
    );
  }

  const active = !!config;
  return (
    <Button
      aria-expanded={Boolean(configPanel)}
      aria-label={getString('mosaic')}
      tooltip={getString('mosaic')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M5.5 3H14.5C15.8807 3 17 4.11929 17 5.5V14.5C17 15.8807 15.8807 17 14.5 17H5.5C4.11929 17 3 15.8807 3 14.5V5.5C3 4.11929 4.11929 3 5.5 3ZM4 5.5V7.29297L7.29297 4H5.5C4.67157 4 4 4.67157 4 5.5ZM4 8.70718V11.293L11.293 4H8.70718L4 8.70718ZM12.7072 4L4 12.7072V14.5C4 14.7316 4.05249 14.9509 4.14621 15.1468L15.1468 4.14621C14.9509 4.05249 14.7316 4 14.5 4H12.7072ZM15.8538 4.85334L4.85334 15.8538C5.04915 15.9475 5.26845 16 5.5 16H7.29297L16 7.29297V5.5C16 5.26845 15.9475 5.04915 15.8538 4.85334ZM16 8.70718L8.70718 16H11.293L16 11.293V8.70718ZM16 12.7072L12.7072 16H14.5C15.3284 16 16 15.3284 16 14.5V12.7072Z" fill="#212121" />
      </svg>
    </Button>
  );
}

export default memo(MosaicTool);
