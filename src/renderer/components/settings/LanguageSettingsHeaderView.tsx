import React from 'react';
import { Languages } from 'lucide-react';
import '../../styles/Header.css';
import { useI18n } from '../../lib/i18n/useI18n';

const LanguageSettingsHeaderView: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="unified-header">
      <div className="header-title">
        <Languages size={24} strokeWidth={1.6} color="var(--color-warm-900)" />
        <span className="header-name">{t('settings.language.title')}</span>
      </div>
    </div>
  );
};

export default LanguageSettingsHeaderView;
