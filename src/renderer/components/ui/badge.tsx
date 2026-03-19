// src/renderer/components/ui/badge.tsx
import React from 'react';
import { cn } from '../../lib/utilities/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'normal';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-blue-600 text-white',
    secondary: 'border-transparent bg-gray-100 text-gray-900',
    destructive: 'border-transparent bg-red-600 text-white',
    outline: 'text-gray-900 border-gray-300',
    success: 'border-transparent bg-green-600 text-white',
    warning: 'border-transparent bg-yellow-600 text-white',
    normal: 'unified-badge-normal' // Use the unified normal badge style
  };

  // If normal variant, use a special class name structure
  if (variant === 'normal') {
    return (
      <div
        className={cn(
          'unified-badge-normal',
          className
        )}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };