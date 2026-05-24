import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/buddy';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getCompanion',
  'hatchCompanion',
  'renameCompanion',
  'petCompanion',
  'getXPData',
  'setMuted',
  'triggerReaction',
  'getRoster',
  'setActiveBuddy',
  'mergeBuddies',
  'releaseBuddy',
]);

export default invoke;
