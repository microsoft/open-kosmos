import React, { useEffect, useState } from 'react';
import { APP_NAME } from '@shared/constants/branding';
import { profileDataManager } from '@renderer/lib/userData';
import { useI18n } from '../../lib/i18n/useI18n';

interface FreOverlayProps {
  onSkip: () => void;
}

const WINDOWS_TITLE_BAR_HEIGHT = 40;

const FreOverlay: React.FC<FreOverlayProps> = ({ onSkip }) => {
  const { t } = useI18n();
  const [isWindows, setIsWindows] = useState(window.electronAPI?.platform === 'win32');

  useEffect(() => {
    if (window.electronAPI?.platform) return;
    void window.electronAPI.getPlatformInfo()
      .then(info => setIsWindows(info.platform === 'win32'))
      .catch(() => undefined);
  }, []);

  const userName = profileDataManager.getCurrentUserAlias() || t('fre.welcome.defaultUser');

  return (
    <div
      style={{
        position: 'fixed',
        top: isWindows ? WINDOWS_TITLE_BAR_HEIGHT : 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--fre-welcome-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          maxWidth: '560px',
          padding: '48px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '72px' }} aria-hidden="true">✨</div>
        <h1
          style={{
            margin: 0,
            color: 'var(--fre-welcome-title-fg)',
            fontFamily: "'Abhaya Libre', Georgia, serif",
            fontSize: '40px',
          }}
        >
          {t('fre.welcome.title', { name: userName })}
        </h1>
        <p
          style={{
            margin: 0,
            color: 'var(--fre-welcome-body-fg)',
            fontSize: '18px',
            lineHeight: 1.5,
          }}
        >
          {APP_NAME}
        </p>
        <button className="btn-primary" onClick={onSkip}>
          {t('common.continue')}
        </button>
      </div>
    </div>
  );
};

export default FreOverlay;
