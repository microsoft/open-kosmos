/**
 * ExperimentTag Component
 *
 * A sky (primary-token) rectangular tag with rounded corners to indicate
 * experimental features. Can be used in two sizes:
 * - "small": For use on buttons (shows "Exp")
 * - "normal": For use in settings pages (shows "Experiment")
 */

import React from 'react';
import { cn } from '../../lib/utilities/utils';
import { useI18n } from '../../lib/i18n/useI18n';

export interface ExperimentTagProps {
  /** Size variant - "small" for buttons, "normal" for settings pages */
  size?: 'small' | 'normal';
  /** Additional CSS class name */
  className?: string;
}

/**
 * Per-size utility classes. These are a faithful 1:1 port of the former
 * ExperimentTag.css so the rendered pixels are unchanged:
 *   small  -> font-size 8px, padding 1px 3px, line-height 1.2, letter-spacing 0.3px
 *   normal -> font-size 11px, padding 2px 8px, line-height 1.4, letter-spacing 0.2px
 */
const sizeClasses: Record<NonNullable<ExperimentTagProps['size']>, string> = {
  small: 'text-[8px] leading-[1.2] tracking-[0.3px] px-[3px] py-px',
  normal: 'text-[11px] leading-[1.4] tracking-[0.2px] px-2 py-0.5'
};

export const ExperimentTag: React.FC<ExperimentTagProps> = ({ size = 'normal', className }) => {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'experiment-tag inline-flex items-center justify-center rounded bg-primary-500 font-semibold text-white whitespace-nowrap select-none hover:bg-primary-600',
        sizeClasses[size],
        className
      )}
      title={t('experiment.title')}
    >
      {size === 'small' ? t('experiment.small') : t('experiment.normal')}
    </span>
  );
};

export default ExperimentTag;
