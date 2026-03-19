import React, { CSSProperties } from 'react';
import { EditArea } from './type';
import { css } from './common/styled';
import { InnerFrame } from './common/screenshot';

/**
 * -------------------------------------------------------------------------------------
 * css styles for components
 * -------------------------------------------------------------------------------------
 */
const SFrameBox = css`
  position: absolute;
  outline: var(--huge-size) solid var(--mask-color);
  background-attachment: fixed;
  background-repeat: no-repeat;
  opacity: 0;
  &:hover {
    opacity: 1;
  }
`;


/**
 * -------------------------------------------------------------------------------------
 * React components
 * -------------------------------------------------------------------------------------
 */


export function FrameBox(props: {
  onSelect: (area: EditArea) => void;
  data: InnerFrame;
  bgCss: { backgroundImage: string; backgroundSize: string };
}) {
  const { onSelect, data, bgCss } = props;
  const { x, y, height, width } = data;
  const style: CSSProperties = { left: x, top: y, height, width, ...bgCss };
  // Todo: if more than one display exist, this won't be triggered on inactive display
  const handle = () => onSelect([x, y, width, height]);
  return (
    <div className={SFrameBox} style={style} onClick={handle} />
  );
}

function isContain(a: InnerFrame, b: InnerFrame) {
  const [aEndX, aEndY] = [a.x + a.width, a.y + a.height];
  const [bEndX, bEndY] = [b.x + b.width, b.y + b.height];

  return (a.x <= b.x && a.y <= b.y) && (bEndX <= aEndX && bEndY <= aEndY);
}

function isCover(a: InnerFrame, b: InnerFrame) {
  const [aEndX, aEndY] = [a.x + a.width, a.y + a.height];
  const [bEndX, bEndY] = [b.x + b.width, b.y + b.height];

  // b totally contains a
  if (b.x <= a.x && b.y <= a.y && aEndX << bEndX && aEndY << bEndY) {
    return false;
  }
  // a and b has no cross area
  if (a.x >= bEndX || b.x >= aEndX) return false;
  if (a.y >= bEndY || b.y >= aEndY) return false;

  return true;
}

export function optimizeFrames(inputs: InnerFrame[]): InnerFrame[] {
  /**
   * !Note: when document is not ready, window.innerWidth may be 0
   * So, it is best not to put this line outside the function
   */
  const { devicePixelRatio: ratio, innerWidth, innerHeight } = window;
  const frames = scaleFrames(inputs);

  const outputs: InnerFrame[] = [];
  let remain = frames;
  while (remain.length > 0) {
    const filtered: InnerFrame[] = [];
    const first = remain[0];
    for (let i = 1, len = remain.length; i < len; i += 1) {
      const frame = remain[i];
      if (isContain(first, frame)) continue;
      filtered.push(frame);
    }
    outputs.push(first);
    remain = filtered;
  }

  outputs.push({ x: 0, y: 0, width: innerWidth, height: innerHeight, id: -1 });
  return outputs;
}

// Scale frames from physical pixels to CSS pixels (divide by devicePixelRatio),
// then clip to viewport boundaries.
export function scaleFrames(frames: InnerFrame[]): InnerFrame[] {
  const { devicePixelRatio: ratio, innerWidth, innerHeight } = window;
  const scaledFrames = frames.map(({ x, y, height, width, ...others }) => {
    [x, y, width, height] = [x, y, width, height].map(n => n / ratio);
    const endX = Math.min(x + width, innerWidth);
    const endY = Math.min(y + height, innerHeight);
    [x, y] = [Math.max(x, 0), Math.max(y, 0)];
    [width, height] = [endX - x, endY - y];
    return { x, y, width, height, ...others };
  });

  return scaledFrames;
}

