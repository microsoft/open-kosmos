import React, { memo } from 'react';
import SizePicker from '../components/size-picker';
import ColorPicker  from '../components/color-picker';
import { Button } from '../components/button';
import { ChangeToolMethod, DefaultPencilConfig, PencilConfig } from '../common';
import { getString } from '../../../common/localString';
import { ConfigStyle } from './square';
import { useCache } from '../../../context';

const CacheId = Math.random().toString(36).slice(2);

function PencilTool(props: {
  config?: PencilConfig,
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultPencilConfig);

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
      aria-label={getString('draw')}
      tooltip={getString('draw')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M17.1813 2.92689C16.0291 1.71505 14.1047 1.69077 12.9222 2.87317L3.54741 12.2475C3.21958 12.5754 2.99204 12.9899 2.89148 13.4424L2.01387 17.3923C1.97678 17.5592 2.02754 17.7335 2.14844 17.8544C2.26934 17.9753 2.44362 18.026 2.6105 17.9889L6.53689 17.1157C7.00432 17.0118 7.43243 16.7767 7.77103 16.4381L17.129 7.08003C18.27 5.939 18.2933 4.09631 17.1813 2.92689ZM13.6293 3.58029C14.4143 2.79538 15.6917 2.8115 16.4566 3.61596C17.1948 4.39225 17.1793 5.61548 16.4219 6.37293L15.7507 7.04418L12.958 4.25155L13.6293 3.58029ZM12.2509 4.95864L15.0436 7.7513L7.06391 15.731C6.85976 15.9352 6.60164 16.0769 6.31982 16.1396L3.1605 16.8421L3.86768 13.6593C3.92698 13.3924 4.06117 13.148 4.2545 12.9547L12.2509 4.95864Z" fill="#212121" />
      </svg>
    </Button>
  );
}

export default memo(PencilTool);
