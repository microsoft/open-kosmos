import type { LocaleCatalog } from './en';

import { zhCNPart1 } from './zh-CN/zhCNPart1';
import { zhCNPart2 } from './zh-CN/zhCNPart2';
import { zhCNPart3 } from './zh-CN/zhCNPart3';
import { zhCNPart4 } from './zh-CN/zhCNPart4';

export const zhCN = {
  ...zhCNPart1,
  ...zhCNPart2,
  ...zhCNPart3,
  ...zhCNPart4,
} satisfies LocaleCatalog;
