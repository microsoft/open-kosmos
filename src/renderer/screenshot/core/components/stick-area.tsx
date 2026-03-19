import React, { CSSProperties, forwardRef, HTMLAttributes, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

type Rect = [x: number, y: number, w: number, h: number];

function calc(box: HTMLElement, area: Rect, gap: number) {
  const { offsetWidth: ow, offsetHeight: oh } = box;
  const [x, y, w, h] = area;
  const [right, bottom] = [x + w, y + h];
  const { innerHeight: winH, innerWidth: winW } = window;

  const site: CSSProperties = {};
  let hgap = 0;
  if ((bottom + gap + oh) < winH) {
    site.top = bottom + gap;
  } else if (y - gap - oh > 0) {
    site.bottom = winH - y + gap;
  } else {
    hgap = gap;
    site.bottom = winH - bottom + gap;
  }

  if (right - ow < 0) {
    site.left = hgap;
  } else {
    site.right = winW - right + hgap;
  }

  return site;
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  gap: number;
  area: Rect;
}

export interface StickRef {
  layout: () => void;
}
export default forwardRef<StickRef, Props>((props, ref) => {
  const { area, gap, children, style, ...others } = props;
  const [site, setSite] = useState<CSSProperties>({});
  const container = useRef<HTMLDivElement>(null);

  const layout = () => setSite(calc(container.current!, area, gap));
  useImperativeHandle(ref, () => ({ layout }));
  useLayoutEffect(layout, [area, gap]);

  const stylex: CSSProperties = { ...style, ...site, position: 'absolute' };
  return (
    <div {...others} ref={container} style={stylex}>
      {children}
    </div>
  );
});
