import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '../../lib/utils.js';

const PopoverSsrOpenContext = React.createContext(false);

export type PopoverProps<Payload = unknown> = PopoverPrimitive.Root.Props<Payload>;

export function Popover<Payload = unknown>(props: PopoverProps<Payload>) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <PopoverSsrOpenContext.Provider value={ssrOpen}>
      <PopoverPrimitive.Root {...props} />
    </PopoverSsrOpenContext.Provider>
  );
}

export type PopoverTriggerProps = PopoverPrimitive.Trigger.Props;

export function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export type PopoverPortalProps = PopoverPrimitive.Portal.Props;

export function PopoverPortal({ children, keepMounted, ...props }: PopoverPortalProps) {
  const ssrOpen = React.useContext(PopoverSsrOpenContext);
  if (typeof document === 'undefined') {
    if (!ssrOpen && !keepMounted) return null;
    return <div data-slot="popover-portal">{children}</div>;
  }
  return (
    <PopoverPrimitive.Portal data-slot="popover-portal" keepMounted={keepMounted} {...props}>
      {children}
    </PopoverPrimitive.Portal>
  );
}

export type PopoverPositionerProps = PopoverPrimitive.Positioner.Props;

export function PopoverPositioner({ className, ...props }: PopoverPositionerProps) {
  return (
    <PopoverPrimitive.Positioner
      data-slot="popover-positioner"
      className={cn('isolate', className)}
      {...props}
    />
  );
}

export interface PopoverContentProps extends PopoverPrimitive.Popup.Props {
  align?: PopoverPrimitive.Positioner.Props['align'];
  alignOffset?: PopoverPrimitive.Positioner.Props['alignOffset'];
  side?: PopoverPrimitive.Positioner.Props['side'];
  sideOffset?: PopoverPrimitive.Positioner.Props['sideOffset'];
}

export function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 6,
  children,
  ...props
}: PopoverContentProps) {
  const popupClassName = cn(
    'flex w-72 max-w-[calc(100vw-24px)] flex-col gap-2.5 rounded-card border border-solid border-border bg-popover p-3.5 font-sans text-[13px] text-popover-foreground shadow-raised transition-[opacity,transform] duration-150 ease-out-strong data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
    className,
  );

  return (
    <PopoverPortal>
      {typeof document === 'undefined' ? (
        <div
          data-slot="popover-positioner"
          data-side={side}
          data-align={align}
          className="isolate"
        >
          <div
            role="dialog"
            data-slot="popover-content"
            data-side={side}
            data-align={align}
            data-open=""
            className={popupClassName}
          >
            {children}
          </div>
        </div>
      ) : (
        <PopoverPositioner
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            className={popupClassName}
            {...props}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPositioner>
      )}
    </PopoverPortal>
  );
}

export function PopoverHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1', className)}
      {...props}
    />
  );
}

export type PopoverTitleProps = PopoverPrimitive.Title.Props;

export function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn(
        'font-sans text-[13px] leading-snug font-semibold text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type PopoverDescriptionProps = PopoverPrimitive.Description.Props;

export function PopoverDescription({
  className,
  ...props
}: PopoverDescriptionProps) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn(
        'font-sans text-[12.5px] leading-relaxed text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type PopoverCloseProps = PopoverPrimitive.Close.Props;

export function PopoverClose({ className, ...props }: PopoverCloseProps) {
  return (
    <PopoverPrimitive.Close
      data-slot="popover-close"
      className={cn(className)}
      {...props}
    />
  );
}
