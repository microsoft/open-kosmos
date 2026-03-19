import React, { CSSProperties, useState } from 'react';
import { COLORS, COLORS_DESC } from '../common';
import { getString } from '../../../common/localString';
import { A11yDiv } from '../../../common/a11y-element';

const stopEvent = (ev: React.MouseEvent) => ev.stopPropagation();
const titleStyle: CSSProperties = { margin: '0 0 8px', fontWeight: 'bold', fontSize: 14, color: '#1A1A1A' };
const boxStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignItems: 'center', justifyItems: 'center' };

function ColorPicker(props: {
  color: string;
  onChange: (color: string) => void;
}) {
  const { color, onChange } = props;
  const list = COLORS;
  const [active, setActive] = useState<string | null>(null);

  const onStep = (step: number) => {
    const index = list.findIndex(c => c[0] === active);
    if (index === -1) {
      setActive(list[0][0]);
      return;
    };
    const stepIndex = index + step >= list.length
    ? 0 : index + step < 0
    ? list.length - 1 : index + step;
    setActive(list[stepIndex][0]);
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowLeft':
        onStep(-1);
        break;
      case 'ArrowRight':
        onStep(1);
        break;
      case 'ArrowUp':
        onStep(-1);
        break;
      case 'ArrowDown':
        onStep(1);
        break;
      case 'Enter':
        active && onChange(active);
        break;
      default:
        break;
    }
  }
  return (
    <div
      tabIndex={0}
      role="combobox"
      aria-autocomplete="list"
      aria-controls="autocomplete-list"
      aria-activedescendant={active || undefined}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}>
      <h4 className="tool-config-title">{getString('color')}</h4>
      <div role="radiogroup" aria-label={getString('color')} style={boxStyle}>
        {list.map(([value, border = value]) => {
          const colorBox: CSSProperties = {
            borderRadius: 28,
            border: `2px solid ${value === active ? '#000' : value === color ? '#0078D4' : 'transparent'}`,
          };
          const colorStyle: CSSProperties = {
            background: value,
            height: 28,
            width: 28,
            borderRadius: 28,
            cursor: 'pointer',
            border: `${value === active || value === color ? '2px solid #fff' : 'none'}`,
          };
          let handle: VoidFunction | undefined;
          if (value !== color) {
            handle = () => onChange(value);
          };
          return (
            <A11yDiv  role="radio"
                      id={value}
                      aria-label={COLORS_DESC[value]}
                      aria-checked={value === color}
                      style={colorBox}
                      tabIndex={-1}
                      key={value}
                      className={value === active ? 'tab-active' : value === color ? 'active' : ''}
                      onMouseDown={stopEvent}
                      onClick={handle}>
              <div style={colorStyle}></div>
            </A11yDiv>
          );
        })}
      </div>
    </div>
  );
}

export default ColorPicker;

