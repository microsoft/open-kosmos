import React from 'react';
import type { CardDetail } from '@shared/types/memexTypes';
import FileContentRenderer from '../ui/FileContentRenderer';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/SkillsContentView.css';
import '../../styles/MemexMemory.css';

interface ProfileMemoryDetailPanelProps {
  card: CardDetail | null;
  loading: boolean;
  error: string | null;
  onNavigate?: (slug: string) => void;
}

const ProfileMemoryDetailPanel: React.FC<ProfileMemoryDetailPanelProps> = ({
  card,
  loading,
  error,
  onNavigate,
}) => {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="profile-memory-detail-panel">
        <div className="profile-memory-detail-empty">{t('profileMemory.loadingCard')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-memory-detail-panel">
        <div className="profile-memory-detail-empty profile-memory-detail-empty--error">{error}</div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="profile-memory-detail-panel">
        <div className="profile-memory-detail-empty">{t('profileMemory.selectPrompt')}</div>
      </div>
    );
  }

  const markdownContent = card.rawContent ?? card.content;

  return (
    <div className="profile-memory-detail-panel">
      <div className="skill-detail-container">
        <div className="skill-detail-header">
          <div className="skill-detail-title">
            <h2>{card.title || card.slug}</h2>
          </div>
        </div>

        <div className="profile-memory-file-viewer-body">
          {markdownContent ? (
            <FileContentRenderer
              name={`${card.slug}.md`}
              mimeType="text/markdown"
              content={markdownContent}
              markdownWikilinks={onNavigate ? {
                resolveTarget: (target) => card.resolvedWikilinks?.[target] ?? null,
                onNavigate,
              } : undefined}
            />
          ) : (
            <div className="skill-detail-no-content">
              <span>{t('profileMemory.noContent')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileMemoryDetailPanel;
