import { useEffect } from 'react';
import { define } from "../context"
import { screenshotApi } from '../../../ipc/screenshot-overlay';

interface FreState {
  visible: boolean;
}

function make(): FreState {
  return {
    visible: false,
  };
}

export const freAtom = define.view('fre', make, (set, get) => {
  function hide() {
    set({ ...get(), visible: false })
  }

  /** Load settings; if shortcut is not enabled and user hasn't rejected FRE, show teaching overlay */
  function useShortcutTeaching() {
    useEffect(() => {
      screenshotApi.getSettings().then((resp) => {
        if (resp?.success && resp.data) {
          const { shortcutEnabled, freRejected } = resp.data;
          if (!shortcutEnabled && !freRejected) {
            set({ ...get(), visible: true });
          }
        }
      });
    }, []);
  }

  /** "Don't show me again" - set freRejected and hide */
  function rejectFre() {
    hide();
    screenshotApi.rejectFre();
  }

  /** "Go to enable shortcut" - close screenshot and navigate to settings page */
  function goToSettings() {
    hide();
    screenshotApi.navigateToSettings();
  }

  return { hide, useShortcutTeaching, rejectFre, goToSettings };
});

