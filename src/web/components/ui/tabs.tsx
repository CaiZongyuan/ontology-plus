import * as React from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

export type TabsProps = TabsPrimitive.Root.Props;

export function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

export const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center font-sans text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
  {
    variants: {
      variant: {
        default: 'h-8 gap-1 rounded-md bg-muted p-1',
        line: 'h-8 gap-2 rounded-none border-b border-solid border-border bg-transparent p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type TabsListProps = TabsPrimitive.List.Props &
  VariantProps<typeof tabsListVariants>;

export function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

export type TabsTriggerProps = TabsPrimitive.Tab.Props;

export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-sm border border-solid border-transparent px-2.5 py-1 font-sans text-[12.5px] font-medium whitespace-nowrap text-muted-foreground select-none cursor-pointer transition-[background-color,color,border-color,box-shadow] duration-150 ease-out-strong',
        'hover:text-foreground',
        'data-[active]:bg-card data-[active]:border-border data-[active]:text-foreground data-[active]:shadow-xs',
        'group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:border-0 group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:border-transparent group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:px-2 group-data-[variant=line]/tabs-list:data-[active]:border-primary group-data-[variant=line]/tabs-list:data-[active]:bg-transparent group-data-[variant=line]/tabs-list:data-[active]:shadow-none',
        'disabled:pointer-events-none disabled:opacity-45 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        '[&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

export type TabsContentProps = TabsPrimitive.Panel.Props;

export function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 font-sans text-[13px] text-foreground', className)}
      {...props}
    />
  );
}

export type TabsIndicatorProps = TabsPrimitive.Indicator.Props;

export function TabsIndicator({ className, ...props }: TabsIndicatorProps) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        'rounded-sm bg-primary transition-[transform,width,height] duration-150 ease-out-strong',
        className,
      )}
      {...props}
    />
  );
}
