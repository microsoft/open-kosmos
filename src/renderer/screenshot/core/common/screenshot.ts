export interface ImageData {
  imageBase64: string;
  width: number;
  height: number;
}

export interface InnerFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  id: number;
}

export const TRUSTED_ORIGIN = 'edge://screenshot';
export const UNTRUSTED_ORIGIN = 'chrome-untrusted://screenshot';
