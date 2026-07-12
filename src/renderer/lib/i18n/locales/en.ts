import { enPart1 } from './en/enPart1';
import { enPart2 } from './en/enPart2';
import { enPart3 } from './en/enPart3';
import { enPart4 } from './en/enPart4';

export const en = {
  ...enPart1,
  ...enPart2,
  ...enPart3,
  ...enPart4,
} as const;

export type TranslationKey = keyof typeof en;
export type LocaleCatalog = Record<TranslationKey, string>;
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
