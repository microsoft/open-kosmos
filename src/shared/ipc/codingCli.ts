import { connectRenderToMain } from './base';
import type { CodingCliId, CodingCliAvailability } from '../types/codingCli';

export type CodingCliResult<T = void> = { success: true; data?: T } | { success: false; error: string };

type RenderToMain = {
  getSettings: {
    call: [];
    return: CodingCliResult<{ enabled: boolean; cli: CodingCliId }>;
  };
  updateSettings: {
    call: [settings: { enabled?: boolean; cli?: CodingCliId }];
    return: CodingCliResult;
  };
  detectAvailability: {
    call: [];
    return: CodingCliResult<{ clis: CodingCliAvailability[] }>;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('codingCli');
