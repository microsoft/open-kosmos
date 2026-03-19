/**
 * ExperimentTag Component
 *
 * A blue rectangular tag with rounded corners to indicate experimental features.
 * Can be used in two sizes:
 * - "small": For use on buttons (shows "Exp")
 * - "normal": For use in settings pages (shows "Experiment")
 */

import React from 'react';
import './ExperimentTag.css';

export interface ExperimentTagProps {
  /** Size variant - "small" for buttons, "normal" for settings pages */
  size?: 'small' | 'normal';
  /** Additional CSS class name */
  className?: string;
}

export const ExperimentTag: React.FC<ExperimentTagProps> = ({
  size = 'normal',
  className = '',
}) => {
  return (
    <span
      className={`experiment-tag experiment-tag-${size} ${className}`}
      title="This is an experimental feature"
    >
      {size === 'small' ? 'Exp' : 'Experiment'}
    </span>
  );
};

export default ExperimentTag;
