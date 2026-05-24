import { connectRenderToMain } from './base';

export type MemexResult<T = void> = { success: true; data?: T } | { success: false; error: string };

type RenderToMain = {
  enable: {
    call: [];
    return: MemexResult;
  };
  disable: {
    call: [];
    return: MemexResult;
  };
  getStatus: {
    call: [];
    return: MemexResult<{ enabled: boolean }>;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('memex');
