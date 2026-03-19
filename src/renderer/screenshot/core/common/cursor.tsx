import React, { memo } from 'react';
import { svgString2Base64 } from './utils/dom';

function Pencil() {
  const memo = new Map<string, string>();
  return (color: string) => {
    let cache = memo.get(color);
    if (cache === undefined) {
      const url = svgString2Base64(`
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.5437 2.58236C16.1978 1.16682 13.9499 1.13847 12.5687 2.51961L3.19386 11.894C2.79878 12.289 2.52457 12.7886 2.40338 13.334L1.52577 17.2839C1.45161 17.6177 1.55312 17.9662 1.79492 18.208C2.03672 18.4497 2.38527 18.5512 2.71904 18.477L6.64543 17.6038C7.20566 17.4792 7.71876 17.1975 8.12458 16.7917L17.4826 7.43358C18.8154 6.10076 18.8425 3.94835 17.5437 2.58236ZM13.9829 3.93385C14.5691 3.34769 15.5231 3.35972 16.0943 3.96049L16.4566 3.61596L16.0943 3.96049C16.6455 4.54022 16.634 5.45372 16.0683 6.01938L15.7507 6.33708L13.6651 4.25156L13.9829 3.93385ZM4.60804 13.3082L12.2509 5.66574L14.3364 7.7513L6.71036 15.3775C6.57343 15.5144 6.4003 15.6095 6.21128 15.6515L3.81904 16.1835L4.35577 13.7678C4.39445 13.5937 4.48196 13.4343 4.60804 13.3082Z" fill="${color}" stroke="white" />
        </svg>
      `);
      cache = `url('${url}') 0 20, auto`;
      memo.set(color, cache);
    }
    return cache;
  };
}


function Mosaic() {
  const memo = new Map<number, string>();
  return (size: number) => {
    let cache = memo.get(size);
    if (cache === undefined) {
      const half = size / 2;
      const url = svgString2Base64(`
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${half}" cy="${half}" r="${half - 1}" fill="white" fill-opacity="0.7" stroke="#212121" />
        </svg>
      `);
      cache = `url('${url}') ${half} ${half}, auto`;
      memo.set(size, cache);
    }
    return cache;
  };
}

export const CrossCursor = memo<{ size: number }>(({ size }) => {
  const half = size / 2;
  const d = `M${half} 0 L${half} ${size} M0 ${half} L${size} ${half}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <path d={d} stroke="white" strokeWidth={1.5} />
      <path d={d} stroke="black" />
    </svg>
  );
});

export const TextCursor = (() => {
  const d = "M618.666667 554.666667c11.946667 0 21.333333-9.386667 21.333333-21.333334s-9.386667-21.333333-21.333333-21.333333H554.666667V234.666667c0-35.413333 28.586667-64 64-64h42.666666c11.946667 0 21.333333-9.386667 21.333334-21.333334s-9.386667-21.333333-21.333334-21.333333h-42.666666c-34.986667 0-65.706667 16.64-85.333334 42.666667-19.626667-26.026667-50.346667-42.666667-85.333333-42.666667h-42.666667c-11.946667 0-21.333333 9.386667-21.333333 21.333333s9.386667 21.333333 21.333333 21.333334h42.666667c35.413333 0 64 28.586667 64 64V512h-64c-11.946667 0-21.333333 9.386667-21.333333 21.333333s9.386667 21.333333 21.333333 21.333334H512v277.333333c0 35.413333-28.586667 64-64 64h-42.666667c-11.946667 0-21.333333 9.386667-21.333333 21.333333s9.386667 21.333333 21.333333 21.333334h42.666667c34.986667 0 65.706667-16.64 85.333333-42.666667 19.626667 26.026667 50.346667 42.666667 85.333334 42.666667h42.666666c11.946667 0 21.333333-9.386667 21.333334-21.333334s-9.386667-21.333333-21.333334-21.333333h-42.666666c-35.413333 0-64-28.586667-64-64V554.666667h64z";
  return <svg viewBox="0 0 1024 1024" width="22" height="22">
    <path d={d} fill="white" stroke="white" strokeWidth={30} />
    <path d={d} fill="black" />
  </svg>
})();

export const PencilCursor = memo<{ color: string }>((props) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" transform="translate(8,-6)">
    <path d="M17.5437 2.58236C16.1978 1.16682 13.9499 1.13847 12.5687 2.51961L3.19386 11.894C2.79878 12.289 2.52457 12.7886 2.40338 13.334L1.52577 17.2839C1.45161 17.6177 1.55312 17.9662 1.79492 18.208C2.03672 18.4497 2.38527 18.5512 2.71904 18.477L6.64543 17.6038C7.20566 17.4792 7.71876 17.1975 8.12458 16.7917L17.4826 7.43358C18.8154 6.10076 18.8425 3.94835 17.5437 2.58236ZM13.9829 3.93385C14.5691 3.34769 15.5231 3.35972 16.0943 3.96049L16.4566 3.61596L16.0943 3.96049C16.6455 4.54022 16.634 5.45372 16.0683 6.01938L15.7507 6.33708L13.6651 4.25156L13.9829 3.93385ZM4.60804 13.3082L12.2509 5.66574L14.3364 7.7513L6.71036 15.3775C6.57343 15.5144 6.4003 15.6095 6.21128 15.6515L3.81904 16.1835L4.35577 13.7678C4.39445 13.5937 4.48196 13.4343 4.60804 13.3082Z" fill={props.color} stroke="white" />
  </svg>
));

export const MosicCursor = memo<{ size: number }>(({ size }) => {
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={half} cy={half} r={half - 1} fill="white" fillOpacity="0.7" stroke="#212121" />
    </svg>
  )
});

export default {
  pencil: Pencil(),
  mosaic: Mosaic(),
};
