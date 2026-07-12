// src/renderer/components/ui/badge.tsx
import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utilities/utils';

/**
 * Badge variant API (cva, the project standard for variant primitives).
 *
 * Note: the `normal` variant is intentionally NOT a cva variant. It opts out of
 * the standard badge box entirely and renders only the global `unified-badge-normal`
 * class, so it is handled by an early return below. Emitted classes for every
 * other variant are identical to the previous hand-written map (zero visual change).
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary-600 text-white',
        secondary: 'border-transparent bg-neutral-100 text-neutral-900',
        destructive: 'border-transparent bg-danger-600 text-white',
        outline: 'text-neutral-900 border-neutral-300',
        success: 'border-transparent bg-success-600 text-white',
        warning: 'border-transparent bg-warning-600 text-white'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'normal';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  // The normal variant uses a special class structure and skips the standard box.
  if (variant === 'normal') {
    return <div className={cn('unified-badge-normal', className)} {...props} />;
  }

  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };