import { Rect, RGBA } from '../../type';
import { mosaicBlur } from './color';
import { svg2Base64, makeInvisibleCanvas } from './dom';
export class BackgroundImage {
  private ctx: OffscreenCanvasRenderingContext2D;
  public height: number;
  public width: number;
  public ratio: number;
  public css: { backgroundImage: string; backgroundSize: string };

  constructor(public url: string, public readonly image: HTMLImageElement, displayWidth?: number, displayHeight?: number) {
    const { naturalHeight, naturalWidth } = image;

    if (displayWidth && displayHeight) {
      this.width = displayWidth;
      this.height = displayHeight;
      this.ratio = naturalWidth / displayWidth;
    } else {
      const dpr = window.devicePixelRatio || 1;
      this.width = naturalWidth / dpr;
      this.height = naturalHeight / dpr;
      this.ratio = dpr;
    }

    const canvas = new OffscreenCanvas(this.width, this.height);
    this.ctx = canvas.getContext('2d', { willReadFrequently: true }) as any;
    this.ctx.drawImage(
      image,
      0,
      0,
      naturalWidth,
      naturalHeight,
      0,
      0,
      this.width,
      this.height
    );
    this.css = {
      backgroundImage: `url("${url}")`,
      backgroundSize: `${this.width}px ${this.height}px`,
    };
  }

  public blur(area: Rect, radius: number) {
    const { image, ratio } = this;
    const [, , w, h] = area;
    const [left, top, width, height] = area.map((n) => n * ratio);
    const { ctx } = makeInvisibleCanvas(w, h);
    ctx.drawImage(image, left, top, width, height, 0, 0, w, h);
    const maxX = (Math.min(image.naturalWidth, left + width) - left) / ratio;
    const maxY = (Math.min(image.naturalHeight, top + height) - top) / ratio;
    const imgData = ctx.getImageData(0, 0, w, h);
    mosaicBlur(imgData, Math.round(w), maxX, maxY, radius);
    return imgData;
  }

  public getColor(x: number, y: number): RGBA {
    const pixel = this.ctx.getImageData(x, y, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  }

  public getSubCanvasByArea(area: Rect) {
    const { image, ratio } = this;
    const [x, y, w, h] = area;
    const [width, height] = [w * ratio, h * ratio];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(
      image,
      x * ratio,
      y * ratio,
      width,
      height,
      0,
      0,
      width,
      height
    );

    return { canvas, ctx, width, height };
  }

  public compose(area: Rect, mosaci: HTMLCanvasElement, svg: SVGSVGElement) {
    const [_x, _y, w, h] = area;
    const { canvas, ctx, width, height } = this.getSubCanvasByArea(area);
    ctx.drawImage(mosaci, 0, 0, w, h, 0, 0, width, height);

    return new Promise<HTMLCanvasElement>((resolve) => {
      const svgImage = new Image();
      svgImage.onload = () => {
        ctx.drawImage(svgImage, 0, 0, w, h, 0, 0, width, height);
        resolve(canvas);
      };
      svgImage.src = svg2Base64(svg);
    });
  }

  public async getAreaImage(area: Rect) {
    const canvas = this.getAreaImageCanvas(area);
    const img = new Image();
    img.src = canvas.toDataURL('image/jpeg');
    await img.decode();
    return img;
  }
  public getAreaImageCanvas(area: Rect) {
    return this.getSubCanvasByArea(area).canvas;
  }
  public async getAreaImageBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve);
    });
  }
}

export function loadBackground(url: string, displayWidth?: number, displayHeight?: number) {
  return new Promise<BackgroundImage>((finish) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      finish(new BackgroundImage(url, image, displayWidth, displayHeight));
    };
    image.src = url;
  });
}
