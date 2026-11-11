import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

// One button shape for the whole workbench (ADR 0006): 6px square corners, three
// heights. `accent` is the single primary action of a region; `secondary` is the
// default outline; pills are reserved for status badges.
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-solid font-sans font-medium leading-none cursor-pointer select-none whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out-strong',
    'active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:translate-y-0',
    'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent border-accent text-accent-ink enabled:hover:brightness-[0.93]',
        accent: 'bg-accent border-accent text-accent-ink enabled:hover:brightness-[0.93]',
        secondary: 'bg-surface border-line text-ink enabled:hover:bg-inset enabled:hover:border-line-strong',
        ghost: 'bg-transparent border-transparent text-ink-2 enabled:hover:bg-hover enabled:hover:text-ink',
        quiet: 'bg-inset border-transparent text-ink-2 enabled:hover:bg-hover-2 enabled:hover:text-ink',
        success: 'bg-green-tint border-green/30 text-green enabled:hover:border-green/60',
        // Segment / filter toggle: pair with aria-pressed (or aria-selected for tabs).
        toggle:
          'bg-transparent border-transparent text-ink-2 enabled:hover:text-ink enabled:hover:bg-hover aria-pressed:bg-surface aria-pressed:border-line aria-pressed:text-ink aria-pressed:shadow-xs aria-selected:bg-surface aria-selected:border-line aria-selected:text-ink aria-selected:shadow-xs',
        danger: 'bg-surface border-line text-red enabled:hover:bg-red-tint enabled:hover:border-red/40',
      },
      size: {
        xs: 'h-6 px-2 text-[11.5px] gap-1',
        sm: 'h-7 px-2.5 text-[12.5px]',
        md: 'h-8 px-3 text-[13px]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'sm',
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
});

