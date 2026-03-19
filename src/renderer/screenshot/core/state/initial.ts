import { define } from '../context';
import { BackgroundImage, loadBackground } from '../common/utils/bg';
import { InnerFrame } from '../common/screenshot';
import { Rect } from '../type';
import type { SaveToFileResult } from '@shared/ipc/screenshot';


export interface InitHooks {
  startSelect: VoidFunction;
  closeWindow: VoidFunction;
  sendToMain: (rect: Rect, imageData?: Buffer) => Promise<void>;
  saveToFile: (rect: Rect, imageData?: Buffer) => Promise<SaveToFileResult>;
}

export interface InitialState extends InitHooks {
  frames: InnerFrame[];
  bg: BackgroundImage;
}

const NOOP = () => {};
const ASYNC_NOOP = async () => {};
const ASYNC_NOOP_RESULT = async (): Promise<SaveToFileResult> => ({ type: 'fail', error: 'not initialized' });
function make(): InitialState {
  return {
    bg: new BackgroundImage('', new Image()),
    frames: [],
    startSelect: NOOP,
    closeWindow: NOOP,
    sendToMain: ASYNC_NOOP,
    saveToFile: ASYNC_NOOP_RESULT,
  };
}

export interface BgSource {
  url: string;
  displayWidth: number;
  displayHeight: number;
  frames: InnerFrame[];
}

export const initialAtom = define.view('initial', make, (set, get) => {
  let executed = false;
  let initOnce = async (source: Promise<BgSource>, hooks: InitHooks) => {
    if (executed) return;
    executed = true;
    set({ ...get(), ...hooks });
    const start = Date.now();
    const { url, displayWidth, displayHeight, frames } = await source;
    set({ ...get(), frames });
    loadBackground(url, displayWidth, displayHeight).then((bg) => {
      set({ ...get(), bg });
      console.log(`[Screenshot][Initial] initOnce took ${Date.now() - start} ms`);
    });
  };

  return { initOnce };
});
