import React, { memo, CSSProperties, useState, useRef, useEffect } from 'react';
import ColorPicker  from '../components/color-picker';
import { Button } from '../components/button';
import { ChangeToolMethod, DefaultTextConfig, TextConfig } from '../common';
import { getString } from '../../../common/localString';
import { ConfigStyle } from './square';
import { A11yButton } from '../../../common/a11y-element';
import { useCache } from '../../../context';
import { css } from '../../../common/styled';

const SInput = css`
  width: 30px;
  font-size: 14px;
  background-color: transparent;
  border: none;
  outline: none;
  text-align: center;
  &:focus {
    border: 1px solid rgb(227, 227, 227);
  }
`;

const SResizeBtn = css`
  width: 28px;
  height: 28px;
  display: flex;
  justify-content: center;
  align-items: center;
  border: none;
  padding: 0;
  transition: 200ms;
  border-radius: 4px;
  background: transparent;

  &:active {
    background: #eaeaea;
  }
  &:disabled {
    background: transparent;
    cursor: not-allowed;
  }
`;

const MAX_SIZE = 96;
const MIN_SIZE = 10;
const boxStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' };
const stopEvent = (ev: React.MouseEvent) => ev.stopPropagation();

function Input(props: { size: number; commit: (size: number) => void }) {
  const { size, commit } = props;
  const [focus, setFocus] = useState(false);
  const [temp, setTemp] = useState<number>(size);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current!;
    const handle = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    };
    input.addEventListener('keydown', handle);
    return () => input.removeEventListener('keydown', handle);
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    if (value) {
      const n = parseInt(value);
      if (isNaN(n) || n > 999) return;
      setTemp(n);
    } else {
      setTemp(0);
    }
  };
  const onFocus = () => {
    setTemp(size);
    setFocus(true);
  };
  const onBlur = () => {
    setFocus(false);
    const n = Math.min(MAX_SIZE, Math.max(MIN_SIZE, temp));
    if (n !== size) commit(n);
  };

  return (
    <input
      type="text"
      className={SInput}
      aria-live='assertive'
      aria-label={size >= MAX_SIZE ? getString('reachedMaximumTextSize') : size <= MIN_SIZE ? getString('reachedMinimumTextSize') : getString('textSize')}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={onChange}
      ref={ref}
      value={focus ? (temp || '') : size}
    />
  );
}

const PresetFontSize = [10, 13, 16, 24, 36, 48, 96];
function increase(current: number) {
  const size = PresetFontSize.find(s => (current < s));
  return size || current;
}
function decrease(current: number) {
  for (let i = PresetFontSize.length - 1; i >= 0; i -= 1) {
    const size = PresetFontSize[i];
    if (size < current) return size;
  }
  return current;
}


const CacheId = Math.random().toString(36).slice(2);

function TextTool(props: {
  config?: TextConfig;
  onChangeTool: ChangeToolMethod;
}) {
  const { config, onChangeTool } = props;
  const last = useCache(CacheId, DefaultTextConfig);

  let configPanel: React.ReactNode;
  if (config) {
    const { size, color, type } = config;
    const decreaseAble = size > MIN_SIZE;
    const increaseAble = size < MAX_SIZE;
    function apply(s: number, c: string) {
      const config = { type, size: s, color: c };
      last.set(config);
      onChangeTool({ config, applyShape: true });
    }

    configPanel = (
      <div className={ConfigStyle} style={{ borderRadius: 4 }}>
        <div>
          <h4 className="tool-config-title">{getString('size')}</h4>
          <div style={boxStyle} onMouseDown={stopEvent}>
            <A11yButton className={SResizeBtn} disabled={!decreaseAble} aria-label={getString('decreaseText')} onClick={() => apply(decrease(size), color)}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill={decreaseAble ? '#212121' : '#979593'}>
                <path d="M13.1465 2.14645C13.3418 1.95118 13.6584 1.95118 13.8536 2.14645L15.5 3.79288L17.1465 2.14645C17.3417 1.95118 17.6583 1.95118 17.8536 2.14645C18.0488 2.34171 18.0488 2.65829 17.8536 2.85355L15.8536 4.85353C15.6583 5.04879 15.3418 5.04879 15.1465 4.85353L13.1465 2.85355C12.9513 2.65829 12.9513 2.34171 13.1465 2.14645ZM10 3.99998C10.2031 3.99998 10.3859 4.12275 10.4628 4.31066L14.9627 15.3106C15.0673 15.5661 14.9448 15.8581 14.6893 15.9626C14.4337 16.0672 14.1417 15.9448 14.0372 15.6892L12.5001 11.9318V11.9999H7.5002V11.9313L5.96289 15.6892C5.85833 15.9448 5.56639 16.0672 5.31081 15.9626C5.05523 15.8581 4.9328 15.5661 5.03736 15.3106L9.53727 4.31066C9.61414 4.12275 9.79701 3.99998 10 3.99998ZM7.88121 10.9999H12.1189L10 5.8205L7.88121 10.9999Z" />
              </svg>
            </A11yButton>
            <Input size={size} commit={(s) => apply(s, color)} />
            <A11yButton className={SResizeBtn} disabled={!increaseAble} aria-label={getString('increaseText')} onClick={() => apply(increase(size), color)}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill={increaseAble ? '#212121' : '#979593'}>
                <path d="M13.8536 4.85353C13.6584 5.04879 13.3418 5.04879 13.1465 4.85353C12.9513 4.65827 12.9513 4.34169 13.1465 4.14643L15.1465 2.14645C15.3418 1.95118 15.6583 1.95118 15.8536 2.14645L17.8536 4.14643C18.0488 4.34169 18.0488 4.65827 17.8536 4.85353C17.6583 5.04879 17.3417 5.04879 17.1465 4.85353L15.5 3.2071L13.8536 4.85353ZM10 3.99998C9.79701 3.99998 9.61414 4.12275 9.53727 4.31066L5.03736 15.3106C4.9328 15.5661 5.05523 15.8581 5.31081 15.9626C5.56639 16.0672 5.85833 15.9448 5.96289 15.6892L7.5002 11.9313V11.9999H12.5001V11.9318L14.0372 15.6892C14.1417 15.9448 14.4337 16.0672 14.6893 15.9626C14.9448 15.8581 15.0673 15.5661 14.9627 15.3106L10.4628 4.31066C10.3859 4.12275 10.2031 3.99998 10 3.99998ZM10 5.8205L12.1189 10.9999H7.88121L10 5.8205Z" />
              </svg>
            </A11yButton>
          </div>
        </div>
        <ColorPicker color={color} onChange={(c) => apply(size, c)} />
      </div>
    );
  }

  const active = !!config;
  return (
    <Button
      aria-expanded={Boolean(configPanel)}
      aria-label={getString('text')}
      tooltip={getString('text')}
      onClick={() => onChangeTool({ config: active ? null : last.value, blurShape: true })}
      expand={configPanel}
      active={active}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M4 3.5C4 3.22386 4.22386 3 4.5 3H14.5C14.7761 3 15 3.22386 15 3.5V5.5C15 5.77614 14.7761 6 14.5 6C14.2239 6 14 5.77614 14 5.5V4H10V16H11.5C11.7761 16 12 16.2239 12 16.5C12 16.7761 11.7761 17 11.5 17H7.5C7.22386 17 7 16.7761 7 16.5C7 16.2239 7.22386 16 7.5 16H9V4H5V5.5C5 5.77614 4.77614 6 4.5 6C4.22386 6 4 5.77614 4 5.5V3.5Z" fill="#212121" />
      </svg>
    </Button>
  );
}

export default memo(TextTool);
