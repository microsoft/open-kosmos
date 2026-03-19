import { base64ToBlob } from '../image';

const a = document.createElement('a');

export function downloadUrl(url: string,  name: string) {
  a.download = name;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function setToClipboard(blob: Blob) {
  if (navigator.clipboard && window.ClipboardItem) {
    const item = [new ClipboardItem({ [blob.type]: blob })];
    return navigator.clipboard.write(item);
  }
  return Promise.reject(Error('clipboard api does not exist, you may need https'));
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL('image/png');
  downloadUrl(url, filename);
}

/**
 * !important: for unknown reason, canvas.toBlob() is very slow in webui
 * so we just convert it manually here
 */
export function copyCanvas(canvas: HTMLCanvasElement) {
  const base64 = canvas.toDataURL('image/png');
  const blob = base64ToBlob(base64, 'image/png');
  return setToClipboard(blob).then(() => base64);
}

export function svgString2Base64(svg: string) {
  return 'data:image/svg+xml,'+ encodeURIComponent(svg);
}

export function svg2Base64(svg: SVGSVGElement) {
  const svgString = new XMLSerializer().serializeToString(svg);
  return svgString2Base64(svgString);
}


export function makeInvisibleCanvas(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  return { canvas, ctx };
}

export function measureWidth(el: HTMLElement) {
  const w = parseFloat(getComputedStyle(el).width);
  return isNaN(w) ? el.offsetWidth : Math.ceil(w);
}

export function measureDomRect(el: HTMLElement): [w: number, h: number] {
  const { width, height } = el.getBoundingClientRect();
  return [width, height];
}

/**
 * !Note: fix mac issue
 * on MacOS, Even after events DOMContentLoaded and window.onload have occurred
 * window.innerWidth and window.innerHeight is still 0
 */
export function waitWinSize(call: (w: number, h: number) => void) {
  let count = 0;
  function check() {
    const { innerWidth: w, innerHeight: h } = window;
    if (count > 50 || (w && h)) return call(w, h);
    count += 1;
    setTimeout(check, 100);
  }
  check();
}
