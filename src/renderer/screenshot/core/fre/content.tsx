import { css } from "../common/styled";
import { useI18n } from '../../../lib/i18n/useI18n';

const Box = css`
	padding: 20px 28px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 14px;
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	color: #4A2E1A;
	font-size: 14px;
	font-style: normal;
	font-weight: 400;
	line-height: 20px;
	pointer-events: auto;
	white-space: nowrap;
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 16px;
    background: linear-gradient(145deg, #FFF7F0 0%, var(--color-warm-accent) 100%);
    box-shadow: 0px 0px 0px 1px rgba(249, 115, 22, 0.10), 0px 8px 24px 0px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(30px);
    z-index: -1;
  }
  @media screen and (forced-colors: active) {
    & {
      forced-color-adjust: auto;
      * {
        forced-color-adjust: auto;
      }
    }
  }
`;

const TitleRow = css`
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 15px;
	font-weight: 600;
	color: #1A1A1A;
`;

const TitleIcon = css`
	width: 22px;
	height: 22px;
	color: #ea580c;
`;

const SettingsRow = css`
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	color: #7A5738;
  & strong {
    color: #ea580c;
    font-weight: 600;
  }
`;

const SettingsIcon = css`
	width: 16px;
	height: 16px;
	color: #ea580c;
	flex-shrink: 0;
`;

const PathBadge = css`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 10px;
	border-radius: 6px;
	background: rgba(249, 115, 22, 0.10);
	font-size: 12px;
	font-weight: 500;
	color: #c2410c;
`;

const ArrowSep = css`
	opacity: 0.5;
	font-size: 11px;
`;

const ButtonRow = css`
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 4px;
`;

const PrimaryBtn = css`
	padding: 7px 18px;
	border: none;
	border-radius: 8px;
	background: var(--color-warm-900);
	color: var(--color-white);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	transition: all 0.15s ease;
	font-family: inherit;
  &:hover {
    background: #3a3633;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    transform: translateY(-1px);
  }
  &:active {
    background: #1a1816;
    transform: translateY(0);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
`;

const SecondaryBtn = css`
	padding: 7px 18px;
	border: 1px solid var(--color-neutral-300);
	border-radius: 8px;
	background: var(--color-white);
	color: var(--color-warm-900);
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.15s ease;
	font-family: inherit;
  &:hover {
    background: var(--color-neutral-50);
    border-color: var(--color-neutral-400);
  }
  &:active {
    background: var(--color-neutral-100);
  }
`;

interface ContentProps {
  onGoToSettings: () => void;
  onDismiss: () => void;
}

export function Content({ onGoToSettings, onDismiss }: ContentProps) {
  const { t } = useI18n();

  return (
    <div className={Box}>
      {/* Row 1: Title */}
      <div className={TitleRow}>
        <svg className={TitleIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="4" width="20" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 8h2M10 8h2M14 8h2M18 8h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M7 11h2M11 11h2M15 11h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{t('screenshot.fre.quickShortcut')}</span>
      </div>

      {/* Row 2: Settings path hint */}
      <div className={SettingsRow}>
        <svg className={SettingsIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>{t('screenshot.fre.enableIn')}</span>
        <span className={PathBadge}>
          {t('common.settings')} <span className={ArrowSep}>›</span> {t('settings.navigation.screenshot')} <span className={ArrowSep}>›</span> {t('settings.screenshot.enableShortcut')}
        </span>
      </div>

      {/* Row 3: Action buttons */}
      <div className={ButtonRow}>
        <button className={PrimaryBtn} onClick={onGoToSettings}>
          {t('screenshot.fre.goEnableShortcut')}
        </button>
        <button className={SecondaryBtn} onClick={onDismiss}>
          {t('screenshot.fre.doNotShowAgain')}
        </button>
      </div>
    </div>
  );
}
