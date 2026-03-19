import { RGB, RGBA } from '../../type';

// based on 1994 version of DeltaE
export const deltaE = (colorA: RGB | RGBA, colorB: RGB | RGBA): number => {
  let labA = rgb2lab(colorA);
  let labB = rgb2lab(colorB);
  let deltaL = labA[0] - labB[0];
  let deltaA = labA[1] - labB[1];
  let deltaB = labA[2] - labB[2];
  let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
  let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
  let deltaC = c1 - c2;
  let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
  deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
  let sc = 1.0 + 0.045 * c1;
  let sh = 1.0 + 0.015 * c1;
  let deltaLKlsl = deltaL / (1.0);
  let deltaCkcsc = deltaC / (sc);
  let deltaHkhsh = deltaH / (sh);
  let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
  return i < 0 ? 0 : Math.sqrt(i);
}

// based on 1994 version of DeltaE
const rgb2lab = (rgb: RGB | RGBA): RGB => {
  let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
  r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
  z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
  y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
  z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;
  return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)]
}


export function isBlack(rgb: RGB | RGBA) {
  return deltaE(rgb, [0, 0, 0]) > 50;
}

export function isDark(rgb: RGB | RGBA) {
  return deltaE(rgb, [0, 120, 212]) > 50;
}


export function mosaicBlur(image: ImageData, w:number, maxX: number, maxY: number, radius: number) {
  const data = image.data;
  const step = radius * 2;

  for (let row = 0; row < maxY; row += step) {
    for (let  col = 0; col < maxX; col += step) {
      const [left, top] = [col, row];
      const [right, bottom] = [Math.min(col + step, maxX), Math.min(row + step, maxY)];

      let [r, g, b] = [0, 0, 0];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const base = (y * w + x) * 4;
          r += data[base];
          g += data[base + 1];
          b += data[base + 2];
        }
      }

      const total = (bottom - top) * (right - left);
      const [vr, vg, vb] = [r / total, g / total, b / total];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const base = (y * w + x) * 4;
          data[base] = vr;
          data[base + 1] = vg;
          data[base + 2] = vb;
        }
      }
    }
  }
}
