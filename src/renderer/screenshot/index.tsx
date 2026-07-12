import { screenshotApi } from '../ipc/screenshot-overlay';
import { useI18n } from '../lib/i18n/useI18n';
import { displayId, initData } from './constant';
import { Screenshot } from './core';
import { setScreenshotStringLanguage } from './core/common/localString';
import { Rect } from './core/type';


function convertRect([startX, startY, width, height]: Rect) {
  const endX = startX + width;
  const endY = startY + height;
  return { startX, startY, endX, endY, width, height };
}

const hooks = {
  startSelect: () => {
    screenshotApi.selectionStart(displayId);
  },
  closeWindow: () => {
    screenshotApi.close();
  },
  sendToMain: (rect: [number, number, number, number], imageData?: Buffer) => {
    const selectionRect = convertRect(rect);
    return screenshotApi.sendToMain(displayId, selectionRect, imageData);
  },
  saveToFile: (rect: [number, number, number, number], imageData?: Buffer) => {
    const selectionRect = convertRect(rect);
    return screenshotApi.saveToFile(displayId, selectionRect, imageData);
  },
}

const source = initData.then(data => ({
  url: `screenshot://image/${data.id}`,
  displayWidth: data.bounds.width,
  displayHeight: data.bounds.height,
  frames: data.frames || [],
}));

export function App() {
  const { language } = useI18n();
  setScreenshotStringLanguage(language);

  return (
    <Screenshot source={source} hooks={hooks} />
  );
}
