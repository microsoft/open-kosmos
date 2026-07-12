import { atom } from '@/atom';
import { appDataManager } from '@/lib/userData/appDataManager';
import { createLogger } from '@/lib/utilities/logger';

interface AppConfigLike {
  uiLanguage?: UiLanguage;
}

interface AppDataManagerLike {
  getConfig?: () => AppConfigLike;
  getConfigRevision: () => number;
  subscribe?: (listener: (config: AppConfigLike) => void) => () => void;
  fetchLatestConfig?: (options?: { cache?: boolean }) => Promise<AppConfigLike | null>;
  updateConfig: (updates: AppConfigLike) => Promise<{ success: boolean; revision?: number; error?: string }>;
}

type UiLanguage = 'en' | 'zh-CN';

let unsubscribeFromAppConfig: (() => void) | null = null;
const DEFAULT_LANGUAGE: UiLanguage = 'en';
const SUPPORTED_LANGUAGES = new Set<string>(['en', 'zh-CN']);
const logger = createLogger('[UiLanguageAtom]');

function isSupportedLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.has(value);
}

function languageFromConfig(config: AppConfigLike): UiLanguage {
  return isSupportedLanguage(config.uiLanguage) ? config.uiLanguage : DEFAULT_LANGUAGE;
}

interface UiLanguageActions {
  initialize: () => void;
  setLanguage: (language: UiLanguage) => Promise<{ success: boolean; error?: string }>;
}

export const UiLanguageAtom = atom<UiLanguage, UiLanguageActions>(DEFAULT_LANGUAGE, (get, set) => {
  const appConfigStore = appDataManager as AppDataManagerLike;
  let manualSetVersion = 0;
  let subscriptionVersion = 0;
  let pendingManualLanguage: UiLanguage | null = null;
  let pendingManualRevision: number | null = null;
  let ignoredPendingSubscription: { language: UiLanguage; revision: number } | null = null;

  function applyLanguage(nextLanguage: UiLanguage): void {
    if (get() !== nextLanguage) {
      set(nextLanguage);
    }
  }

  function applyConfig(config: AppConfigLike): void {
    applyLanguage(languageFromConfig(config));
  }

  function applySubscribedConfig(config: AppConfigLike): void {
    subscriptionVersion += 1;
    const incomingRevision = appConfigStore.getConfigRevision();
    const nextLanguage = languageFromConfig(config);
    if (pendingManualLanguage) {
      if (nextLanguage === pendingManualLanguage) {
        pendingManualLanguage = null;
        pendingManualRevision = null;
        ignoredPendingSubscription = null;
      } else if (pendingManualRevision !== null && incomingRevision > pendingManualRevision) {
        pendingManualLanguage = null;
        pendingManualRevision = null;
        ignoredPendingSubscription = null;
      } else {
        ignoredPendingSubscription = { language: nextLanguage, revision: incomingRevision };
        return;
      }
    }
    applyLanguage(nextLanguage);
  }

  function applyIgnoredSubscriptionIfNewer(
    ignoredSubscription: { language: UiLanguage; revision: number } | null,
    savedRevision: number,
  ): void {
    if (!ignoredSubscription || ignoredSubscription.revision <= savedRevision) {
      return;
    }
    const latestIgnoredLanguage = ignoredSubscription.language;
    pendingManualLanguage = null;
    pendingManualRevision = null;
    ignoredPendingSubscription = null;
    applyLanguage(latestIgnoredLanguage);
  }

  function initialize(): void {
    applyConfig(typeof appConfigStore.getConfig === 'function' ? appConfigStore.getConfig() : {});
    if (!unsubscribeFromAppConfig && typeof appConfigStore.subscribe === 'function') {
      unsubscribeFromAppConfig = appConfigStore.subscribe(applySubscribedConfig);
    }
    if (typeof appConfigStore.fetchLatestConfig === 'function') {
      const fetchVersion = manualSetVersion;
      const fetchSubscriptionVersion = subscriptionVersion;
      appConfigStore.fetchLatestConfig({ cache: false })
        .then((config) => {
          if (config && manualSetVersion === fetchVersion && subscriptionVersion === fetchSubscriptionVersion) {
            applyConfig(config);
          }
        })
        .catch((error) => {
          logger.error('fetchLatestConfig failed', error);
        });
    }
  }

  async function setLanguage(language: UiLanguage): Promise<{ success: boolean; error?: string }> {
    if (!isSupportedLanguage(language)) {
      return { success: false, error: 'Unsupported UI language' };
    }

    const previousLanguage = get();
    const requestVersion = manualSetVersion + 1;
    manualSetVersion = requestVersion;
    pendingManualLanguage = language;
    pendingManualRevision = null;
    ignoredPendingSubscription = null;
    set(language);
    const result = await appConfigStore.updateConfig({ uiLanguage: language });
    if (requestVersion !== manualSetVersion) {
      return result;
    }
    if (!result.success) {
      pendingManualLanguage = null;
      pendingManualRevision = null;
      ignoredPendingSubscription = null;
      set(previousLanguage);
      return result;
    }

    if (pendingManualLanguage === language && typeof result.revision === 'number') {
      const savedRevision = result.revision;
      pendingManualRevision = savedRevision;
      applyIgnoredSubscriptionIfNewer(ignoredPendingSubscription, savedRevision);
    }
    return result;
  }

  initialize();

  return {
    initialize,
    setLanguage,
  };
});
