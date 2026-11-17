import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

// One button shape for the whole workbench (ADR 0006): 6px square corners, three
// heights. `accent` is the single primary action of a region; `secondary` is the
// default outline; pills are reserved for status badges.
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-sm border border-solid font-sans font-medium leading-none cursor-pointer select-none whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out-strong',
    'active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:translate-y-0',
    'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary border-primary text-primary-foreground enabled:hover:brightness-[0.93]',
        accent: 'bg-primary border-primary text-primary-foreground enabled:hover:brightness-[0.93]',
        secondary: 'bg-card border-border text-foreground enabled:hover:bg-muted enabled:hover:border-border-strong',
        ghost: 'bg-transparent border-transparent text-foreground-soft enabled:hover:bg-accent enabled:hover:text-foreground',
        quiet: 'bg-muted border-transparent text-foreground-soft enabled:hover:bg-accent-strong enabled:hover:text-foreground',
        success: 'bg-success-soft border-success/30 text-success enabled:hover:border-success/60',
        // Segment / filter toggle: pair with aria-pressed (or aria-selected for tabs).
        toggle:
          'bg-transparent border-transparent text-foreground-soft enabled:hover:text-foreground enabled:hover:bg-accent aria-pressed:bg-card aria-pressed:border-border aria-pressed:text-foreground aria-pressed:shadow-xs aria-selected:bg-card aria-selected:border-border aria-selected:text-foreground aria-selected:shadow-xs',
        danger: 'bg-card border-border text-destructive enabled:hover:bg-destructive-soft enabled:hover:border-destructive/40',
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

