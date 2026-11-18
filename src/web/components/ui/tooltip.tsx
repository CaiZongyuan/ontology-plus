import * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '../../lib/utils.js';

const TooltipSsrOpenContext = React.createContext(false);

export type TooltipProviderProps = TooltipPrimitive.Provider.Props;

export function TooltipProvider({
  delay = 250,
  ...props
}: TooltipProviderProps) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

export type TooltipProps<Payload = unknown> = TooltipPrimitive.Root.Props<Payload>;

export function Tooltip<Payload = unknown>(props: TooltipProps<Payload>) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <TooltipSsrOpenContext.Provider value={ssrOpen}>
      <TooltipPrimitive.Root {...props} />
    </TooltipSsrOpenContext.Provider>
  );
}

export type TooltipTriggerProps = TooltipPrimitive.Trigger.Props;

export function TooltipTrigger({ className, ...props }: TooltipTriggerProps) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export interface TooltipContentProps extends TooltipPrimitive.Popup.Props {
  side?: TooltipPrimitive.Positioner.Props['side'];
  sideOffset?: TooltipPrimitive.Positioner.Props['sideOffset'];
  align?: TooltipPrimitive.Positioner.Props['align'];
  alignOffset?: TooltipPrimitive.Positioner.Props['alignOffset'];
}

export function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipContentProps) {
  const ssrOpen = React.useContext(TooltipSsrOpenContext);
  const popupClassName = cn(
    'inline-flex max-w-xs items-center gap-1.5 rounded-md border border-solid border-border bg-popover px-2.5 py-1.5 font-sans text-[12px] leading-snug text-popover-foreground shadow-raised transition-[opacity,transform] duration-120 ease-out-strong data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97]',
    className,
  );

  if (typeof document === 'undefined') {
    if (!ssrOpen) return null;
    return (
      <div data-slot="tooltip-portal">
        <div
          data-slot="tooltip-positioner"
          data-side={side}
          data-align={align}
          className="isolate"
        >
          <div
            role="tooltip"
            data-slot="tooltip-content"
            data-side={side}
            data-align={align}
            data-open=""
            className={popupClassName}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipPrimitive.Portal data-slot="tooltip-portal">
      <TooltipPrimitive.Positioner
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={popupClassName}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
