import { atom } from '@/atom';
import { memo, useEffect, useRef } from 'react';
import { Settings, LogOut, MessageSquareText } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../auth/AuthProvider';
import { createLogger } from '@/lib/utilities/logger';
import { BRAND_CONFIG } from '@shared/constants/branding';
import { useI18n } from '@/lib/i18n/useI18n';

const logger = createLogger('[UserMenu]');

export const userMenuVisibleAtom = atom(false);

interface UserMenuProps {}

function Menu(props: UserMenuProps) {
  const [visible, setVisible] = userMenuVisibleAtom.use();
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuthContext();
  const { t } = useI18n();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!visible) return null;

  function onOpenSettings() {
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings');
    setVisible(false);
  }

  async function onLogout() {
    setVisible(false);
    try {
      await signOut();
    } catch (error) {
      logger.error('[AgentPage] Error signing out:', error);
    }
  }

  function onSendFeedback() {
    setVisible(false);
    const feedbackLink = BRAND_CONFIG.feedbackLink;
    logger.debug('[Send Feedback] BRAND_CONFIG:', BRAND_CONFIG);
    logger.debug('[Send Feedback] feedbackLink:', feedbackLink);
    if (feedbackLink) {
      logger.debug('[Send Feedback] Opening URL:', feedbackLink);
      window.open(feedbackLink, '_blank');
    } else {
      logger.warn('[Send Feedback] No feedbackLink configured in BRAND_CONFIG');
    }
  }

  return (
    <div ref={ref} className="dropdown-menu user-dropdown-menu">
      <button
        className="dropdown-menu-item"
        onClick={onOpenSettings}
        title={t('userMenu.openSettings')}
      >
        <span className="dropdown-menu-item-icon">
          <Settings size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">{t('userMenu.settings')}</span>
      </button>
      <button
        className="dropdown-menu-item"
        onClick={onSendFeedback}
        title={t('userMenu.sendFeedbackTitle')}
      >
        <span className="dropdown-menu-item-icon">
          <MessageSquareText size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">{t('userMenu.sendFeedback')}</span>
      </button>
      <button className="dropdown-menu-item danger" onClick={onLogout}>
        <span className="dropdown-menu-item-icon">
          <LogOut size={16} strokeWidth={1.5} />
        </span>
        <span className="dropdown-menu-item-text">{t('userMenu.logout')}</span>
      </button>
    </div>
  );
}

export const UserMenu = memo(Menu);
