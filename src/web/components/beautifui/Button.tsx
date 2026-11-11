import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-full font-medium cursor-pointer select-none whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out-strong',
    'active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-ink text-surface hover:opacity-90',
        secondary: 'bg-surface text-ink shadow-btn hover:bg-hover',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        accent: 'bg-accent text-accent-ink hover:opacity-90',
        success: 'bg-green text-white hover:opacity-90',
        danger: 'bg-red text-white hover:opacity-90',
        quiet: 'bg-inset text-ink-2 hover:bg-hover hover:text-ink',
      },
      size: {
        xs: 'h-6 px-2.5 text-[11.5px]',
        sm: 'h-7 px-3 text-[12px]',
        md: 'h-8 px-3.5 text-[13px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
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

