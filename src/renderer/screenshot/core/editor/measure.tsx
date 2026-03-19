import React, { memo, CSSProperties } from 'react';
import { Rect } from '../type';
import { css } from '../common/styled';

const height = 30;

const SBox = css`
  position: absolute;
  color: white;
  user-select: none;
  pointer-events: none;
  display: flex;
  align-items: center;
`;

function Measure(props: { area: Rect }) {
  const [, y, w, h] = props.area;
  const style: CSSProperties = { left: 0, height };
  if (y > height) {
    style.top = - height;
  } else {
    style.top = 0;
  }
  return (
    <div style={style} className={SBox}>
      <span>{w}×{h}</span>
    </div>
  );
}

export default memo(Measure);
