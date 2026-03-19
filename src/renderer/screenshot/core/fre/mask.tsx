import React, { memo, useEffect, useState } from 'react';
import { css } from '../common/styled';

const SBox = css`
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 100%;
  background: var(--mask-color);
  pointer-events: none;
`;

function Mask({ mask } : { mask: boolean }) {
  if (!mask) return null;

  return <div className={SBox} />;
}

export default memo(Mask);
