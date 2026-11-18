import * as React from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const DropdownMenuSsrOpenContext = React.createContext(false);
const DropdownMenuInGroupContext = React.createContext(false);

export type DropdownMenuProps<Payload = unknown> = MenuPrimitive.Root.Props<Payload>;

export function DropdownMenu<Payload = unknown>(props: DropdownMenuProps<Payload>) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <DropdownMenuSsrOpenContext.Provider value={ssrOpen}>
      <MenuPrimitive.Root {...props} />
    </DropdownMenuSsrOpenContext.Provider>
  );
}

export type DropdownMenuPortalProps = MenuPrimitive.Portal.Props;

export function DropdownMenuPortal({
  children,
  keepMounted,
  ...props
}: DropdownMenuPortalProps) {
  const ssrOpen = React.useContext(DropdownMenuSsrOpenContext);
  if (typeof document === 'undefined') {
    if (!ssrOpen && !keepMounted) return null;
    return <div data-slot="dropdown-menu-portal">{children}</div>;
  }
  return (
    <MenuPrimitive.Portal
      data-slot="dropdown-menu-portal"
      keepMounted={keepMounted}
      {...props}
    >
      {children}
    </MenuPrimitive.Portal>
  );
}

export type DropdownMenuTriggerProps = MenuPrimitive.Trigger.Props;

export function DropdownMenuTrigger({
  className,
  ...props
}: DropdownMenuTriggerProps) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export interface DropdownMenuContentProps extends MenuPrimitive.Popup.Props {
  align?: MenuPrimitive.Positioner.Props['align'];
  alignOffset?: MenuPrimitive.Positioner.Props['alignOffset'];
  side?: MenuPrimitive.Positioner.Props['side'];
  sideOffset?: MenuPrimitive.Positioner.Props['sideOffset'];
}

export function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  children,
  ...props
}: DropdownMenuContentProps) {
  const popupClassName = cn(
    'min-w-44 overflow-x-hidden overflow-y-auto rounded-card border border-solid border-border bg-popover p-1 font-sans text-[13px] text-popover-foreground shadow-raised transition-[opacity,transform] duration-120 ease-out-strong data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
    className,
  );

  return (
    <DropdownMenuPortal>
      {typeof document === 'undefined' ? (
        <div
          data-slot="dropdown-menu-positioner"
          data-side={side}
          data-align={align}
          className="isolate"
        >
          <div
            role="menu"
            data-slot="dropdown-menu-content"
            data-side={side}
            data-align={align}
            data-open=""
            className={popupClassName}
          >
            {children}
          </div>
        </div>
      ) : (
        <MenuPrimitive.Positioner
          data-slot="dropdown-menu-positioner"
          className="isolate"
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
        >
          <MenuPrimitive.Popup
            data-slot="dropdown-menu-content"
            className={popupClassName}
            {...props}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      )}
    </DropdownMenuPortal>
  );
}

export type DropdownMenuGroupProps = MenuPrimitive.Group.Props;

export function DropdownMenuGroup({
  className,
  ...props
}: DropdownMenuGroupProps) {
  return (
    <DropdownMenuInGroupContext.Provider value={true}>
      <MenuPrimitive.Group
        data-slot="dropdown-menu-group"
        className={cn(className)}
        {...props}
      />
    </DropdownMenuInGroupContext.Provider>
  );
}

export interface DropdownMenuLabelProps
  extends Omit<MenuPrimitive.GroupLabel.Props, 'render'> {
  inset?: boolean;
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: DropdownMenuLabelProps) {
  const inGroup = React.useContext(DropdownMenuInGroupContext);
  const labelClassName = cn(
    'px-2 py-1.5 font-sans text-xs font-medium text-muted-foreground data-[inset]:pl-8',
    className,
  );

  if (!inGroup) {
    return (
      <div
        data-slot="dropdown-menu-label"
        data-inset={inset || undefined}
        className={labelClassName}
        {...(props as React.ComponentProps<'div'>)}
      />
    );
  }

  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset || undefined}
      className={labelClassName}
      {...props}
    />
  );
}

export interface DropdownMenuItemProps extends MenuPrimitive.Item.Props {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(
        'group/dropdown-menu-item relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-sans text-[13px] leading-snug text-popover-foreground select-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive-soft data-[variant=destructive]:data-[highlighted]:text-destructive',
        'data-[inset]:pl-8 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export type DropdownMenuCheckboxItemProps = MenuPrimitive.CheckboxItem.Props;

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-8 font-sans text-[13px] leading-snug text-popover-foreground select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    >
      <span
        data-slot="dropdown-menu-item-indicator"
        className="pointer-events-none absolute left-2 flex size-4 items-center justify-center text-primary"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-3.5" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export type DropdownMenuRadioGroupProps = MenuPrimitive.RadioGroup.Props;

export function DropdownMenuRadioGroup({
  className,
  ...props
}: DropdownMenuRadioGroupProps) {
  return (
    <DropdownMenuInGroupContext.Provider value={true}>
      <MenuPrimitive.RadioGroup
        data-slot="dropdown-menu-radio-group"
        className={cn(className)}
        {...props}
      />
    </DropdownMenuInGroupContext.Provider>
  );
}

export type DropdownMenuRadioItemProps = MenuPrimitive.RadioItem.Props;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-8 font-sans text-[13px] leading-snug text-popover-foreground select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    >
      <span
        data-slot="dropdown-menu-item-indicator"
        className="pointer-events-none absolute left-2 flex size-4 items-center justify-center text-primary"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export type DropdownMenuSeparatorProps = MenuPrimitive.Separator.Props;

export function DropdownMenuSeparator({
  className,
  ...props
}: DropdownMenuSeparatorProps) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto font-mono text-xs tracking-wide text-faint-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type DropdownMenuSubProps = MenuPrimitive.SubmenuRoot.Props;

export function DropdownMenuSub(props: DropdownMenuSubProps) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <DropdownMenuSsrOpenContext.Provider value={ssrOpen}>
      <MenuPrimitive.SubmenuRoot {...props} />
    </DropdownMenuSsrOpenContext.Provider>
  );
}

export interface DropdownMenuSubTriggerProps
  extends MenuPrimitive.SubmenuTrigger.Props {
  inset?: boolean;
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  const subTriggerClassName = cn(
    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-sans text-[13px] leading-snug text-popover-foreground select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground data-[inset]:pl-8 data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
    className,
  );

  if (typeof document === 'undefined') {
    return (
      <div
        role="menuitem"
        aria-haspopup="menu"
        data-slot="dropdown-menu-sub-trigger"
        data-inset={inset || undefined}
        className={subTriggerClassName}
      >
        {children}
        <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset || undefined}
      className={subTriggerClassName}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export interface DropdownMenuSubContentProps extends MenuPrimitive.Popup.Props {
  align?: MenuPrimitive.Positioner.Props['align'];
  alignOffset?: MenuPrimitive.Positioner.Props['alignOffset'];
  side?: MenuPrimitive.Positioner.Props['side'];
  sideOffset?: MenuPrimitive.Positioner.Props['sideOffset'];
}

export function DropdownMenuSubContent({
  align = 'start',
  alignOffset = -4,
  side = 'inline-end',
  sideOffset = 4,
  className,
  children,
  ...props
}: DropdownMenuSubContentProps) {
  const popupClassName = cn(
    'min-w-40 overflow-x-hidden overflow-y-auto rounded-card border border-solid border-border bg-popover p-1 font-sans text-[13px] text-popover-foreground shadow-raised transition-[opacity,transform] duration-120 ease-out-strong data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
    className,
  );

  return (
    <DropdownMenuPortal>
      {typeof document === 'undefined' ? (
        <div
          data-slot="dropdown-menu-sub-positioner"
          data-side={side}
          data-align={align}
          className="isolate"
        >
          <div
            role="menu"
            data-slot="dropdown-menu-sub-content"
            data-side={side}
            data-align={align}
            data-open=""
            className={popupClassName}
          >
            {children}
          </div>
        </div>
      ) : (
        <MenuPrimitive.Positioner
          data-slot="dropdown-menu-sub-positioner"
          className="isolate"
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
        >
          <MenuPrimitive.Popup
            data-slot="dropdown-menu-sub-content"
            className={popupClassName}
            {...props}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      )}
    </DropdownMenuPortal>
  );
}
