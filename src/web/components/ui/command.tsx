import * as React from 'react';
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import { SearchIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogProps,
} from './dialog.js';

const COMMAND_ITEM_MARKER = Symbol.for('ontology-plus.ui.command-item');

export type CommandFilter = (
  value: string,
  search: string,
  keywords?: string[],
) => number | boolean;

export function defaultCommandFilter(
  value: string,
  search: string,
  keywords?: string[],
): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractNodeText).join(' ');
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return '';
}

interface ScannedCommandItem {
  value: string;
  keywords?: string[];
  disabled: boolean;
  onSelect?: (value: string) => void;
}

function collectItemsFromNode(
  node: React.ReactNode,
  out: ScannedCommandItem[],
): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const typeObj = child.type as unknown as Record<symbol, boolean | undefined>;
    if (typeObj && typeObj[COMMAND_ITEM_MARKER]) {
      const props = child.props as CommandItemProps;
      const resolvedValue = (props.value ?? extractNodeText(props.children)).trim();
      out.push({
        value: resolvedValue,
        keywords: props.keywords,
        disabled: Boolean(props.disabled),
        onSelect: props.onSelect,
      });
      return;
    }
    const childProps = child.props as { children?: React.ReactNode };
    if (childProps?.children) {
      collectItemsFromNode(childProps.children, out);
    }
  });
}

function matchesCommandFilter(
  filterFn: CommandFilter,
  value: string,
  search: string,
  keywords?: string[],
): boolean {
  const result = filterFn(value, search, keywords);
  return typeof result === 'number' ? result > 0 : Boolean(result);
}

interface RegisteredClientItem {
  value: string;
  domId: string;
  disabled: boolean;
  visible: boolean;
  onSelect?: (value: string) => void;
  element: HTMLDivElement | null;
}

interface CommandContextValue {
  listId: string;
  search: string;
  setSearch: (next: string) => void;
  shouldFilter: boolean;
  filter: CommandFilter;
  activeValue: string | undefined;
  activeDomId: string | undefined;
  setActiveValue: (next: string) => void;
  visibleItemCount: number;
  registerItem: (key: string, item: RegisteredClientItem) => void;
  unregisterItem: (key: string) => void;
  getItemDomId: (value: string) => string;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommandContext(): CommandContextValue {
  const ctx = React.useContext(CommandContext);
  if (!ctx) {
    throw new Error('Command sub-components must be used within <Command>.');
  }
  return ctx;
}

export interface CommandProps extends Omit<React.ComponentProps<'div'>, 'onSelect'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  search?: string;
  defaultSearch?: string;
  onSearchChange?: (search: string) => void;
  shouldFilter?: boolean;
  filter?: CommandFilter;
  loop?: boolean;
}

export function Command({
  className,
  children,
  value: controlledValue,
  defaultValue,
  onValueChange,
  search: controlledSearch,
  defaultSearch = '',
  onSearchChange,
  shouldFilter = true,
  filter = defaultCommandFilter,
  loop = true,
  onKeyDown,
  ...props
}: CommandProps) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;

  const [uncontrolledSearch, setUncontrolledSearch] = React.useState(defaultSearch);
  const search = controlledSearch !== undefined ? controlledSearch : uncontrolledSearch;

  const setSearch = React.useCallback(
    (next: string) => {
      if (controlledSearch === undefined) {
        setUncontrolledSearch(next);
      }
      onSearchChange?.(next);
    },
    [controlledSearch, onSearchChange],
  );

  const [uncontrolledValue, setUncontrolledValue] = React.useState<string | undefined>(
    defaultValue,
  );

  const setActiveValue = React.useCallback(
    (next: string) => {
      if (controlledValue === undefined) {
        setUncontrolledValue(next);
      }
      onValueChange?.(next);
    },
    [controlledValue, onValueChange],
  );

  const clientItemsRef = React.useRef<Map<string, RegisteredClientItem>>(new Map());
  const [, bumpClientRevision] = React.useState(0);

  const scannedItems = React.useMemo(() => {
    const items: ScannedCommandItem[] = [];
    collectItemsFromNode(children, items);
    return items;
  }, [children]);

  const visibleItems = React.useMemo(() => {
    if (scannedItems.length > 0) {
      return scannedItems.filter(
        (item) => !shouldFilter || matchesCommandFilter(filter, item.value, search, item.keywords),
      );
    }
    const mounted: ScannedCommandItem[] = [];
    for (const entry of clientItemsRef.current.values()) {
      if (entry.visible) {
        mounted.push({
          value: entry.value,
          disabled: entry.disabled,
          onSelect: entry.onSelect,
        });
      }
    }
    return mounted;
  }, [scannedItems, shouldFilter, filter, search]);

  const enabledVisibleItems = React.useMemo(
    () => visibleItems.filter((item) => !item.disabled),
    [visibleItems],
  );

  const candidateActive =
    controlledValue !== undefined ? controlledValue : uncontrolledValue;

  const resolvedActiveValue = React.useMemo(() => {
    if (
      candidateActive !== undefined &&
      enabledVisibleItems.some((item) => item.value === candidateActive)
    ) {
      return candidateActive;
    }
    return enabledVisibleItems[0]?.value;
  }, [candidateActive, enabledVisibleItems]);

  const getItemDomId = React.useCallback(
    (itemValue: string) =>
      `${baseId}-item-${encodeURIComponent(itemValue).replace(/%/g, '_')}`,
    [baseId],
  );

  const activeDomId = resolvedActiveValue ? getItemDomId(resolvedActiveValue) : undefined;

  const registerItem = React.useCallback(
    (key: string, item: RegisteredClientItem) => {
      const prev = clientItemsRef.current.get(key);
      clientItemsRef.current.set(key, item);
      if (
        scannedItems.length === 0 &&
        (!prev ||
          prev.value !== item.value ||
          prev.visible !== item.visible ||
          prev.disabled !== item.disabled)
      ) {
        bumpClientRevision((n) => n + 1);
      }
    },
    [scannedItems.length],
  );

  const unregisterItem = React.useCallback(
    (key: string) => {
      if (clientItemsRef.current.delete(key) && scannedItems.length === 0) {
        bumpClientRevision((n) => n + 1);
      }
    },
    [scannedItems.length],
  );

  const scrollValueIntoView = (targetValue: string) => {
    for (const entry of clientItemsRef.current.values()) {
      if (entry.value === targetValue && entry.element) {
        entry.element.scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      if (enabledVisibleItems.length === 0) return;
      event.preventDefault();
      const currentIdx = enabledVisibleItems.findIndex(
        (item) => item.value === resolvedActiveValue,
      );
      let nextIdx = 0;
      if (event.key === 'Home') {
        nextIdx = 0;
      } else if (event.key === 'End') {
        nextIdx = enabledVisibleItems.length - 1;
      } else if (event.key === 'ArrowDown') {
        if (currentIdx < 0) {
          nextIdx = 0;
        } else if (currentIdx + 1 < enabledVisibleItems.length) {
          nextIdx = currentIdx + 1;
        } else {
          nextIdx = loop ? 0 : currentIdx;
        }
      } else if (event.key === 'ArrowUp') {
        if (currentIdx < 0) {
          nextIdx = enabledVisibleItems.length - 1;
        } else if (currentIdx - 1 >= 0) {
          nextIdx = currentIdx - 1;
        } else {
          nextIdx = loop ? enabledVisibleItems.length - 1 : 0;
        }
      }
      const nextItem = enabledVisibleItems[nextIdx];
      if (nextItem) {
        setActiveValue(nextItem.value);
        scrollValueIntoView(nextItem.value);
      }
      return;
    }

    if (event.key === 'Enter' && resolvedActiveValue !== undefined) {
      const target = enabledVisibleItems.find(
        (item) => item.value === resolvedActiveValue,
      );
      if (!target) return;
      event.preventDefault();
      // Prefer live mounted handler so closures stay fresh.
      for (const entry of clientItemsRef.current.values()) {
        if (entry.value === target.value && !entry.disabled && entry.visible) {
          entry.onSelect?.(target.value);
          return;
        }
      }
      target.onSelect?.(target.value);
    }
  };

  const contextValue = React.useMemo<CommandContextValue>(
    () => ({
      listId,
      search,
      setSearch,
      shouldFilter,
      filter,
      activeValue: resolvedActiveValue,
      activeDomId,
      setActiveValue,
      visibleItemCount: visibleItems.length,
      registerItem,
      unregisterItem,
      getItemDomId,
    }),
    [
      listId,
      search,
      setSearch,
      shouldFilter,
      filter,
      resolvedActiveValue,
      activeDomId,
      setActiveValue,
      visibleItems.length,
      registerItem,
      unregisterItem,
      getItemDomId,
    ],
  );

  return (
    <CommandContext.Provider value={contextValue}>
      <div
        data-slot="command"
        onKeyDown={handleKeyDown}
        className={cn(
          'flex size-full flex-col overflow-hidden rounded-card bg-popover font-sans text-popover-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  );
}

export interface CommandDialogProps extends Omit<DialogProps, 'children'> {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  commandProps?: Omit<CommandProps, 'children'>;
  children?: React.ReactNode;
}

export function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  commandProps,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn('overflow-hidden p-0', className)}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command {...commandProps}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export interface CommandInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'defaultValue'> {
  value?: string;
  onValueChange?: (search: string) => void;
}

export function CommandInput({
  className,
  value: valueProp,
  onChange,
  onValueChange,
  ...props
}: CommandInputProps) {
  const { listId, search, setSearch, activeDomId } = useCommandContext();
  const resolvedValue = valueProp !== undefined ? valueProp : search;

  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-10 items-center gap-2 border-b border-solid border-border px-3"
    >
      <SearchIcon className="size-4 shrink-0 text-faint-foreground" />
      <input
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeDomId}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-slot="command-input"
        value={resolvedValue}
        onChange={(event) => {
          onChange?.(event);
          setSearch(event.target.value);
          onValueChange?.(event.target.value);
        }}
        className={cn(
          'flex h-full w-full bg-transparent py-2 font-sans text-[13px] text-foreground placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-45',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const { listId } = useCommandContext();
  return (
    <div
      id={listId}
      role="listbox"
      data-slot="command-list"
      className={cn(
        'max-h-72 overflow-x-hidden overflow-y-auto p-1',
        className,
      )}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const { visibleItemCount } = useCommandContext();
  if (visibleItemCount > 0) return null;
  return (
    <div
      data-slot="command-empty"
      className={cn(
        'py-6 text-center font-sans text-[13px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandGroupProps
  extends Omit<React.ComponentProps<'div'>, 'title'> {
  heading?: React.ReactNode;
}

export function CommandGroup({
  className,
  heading,
  children,
  ...props
}: CommandGroupProps) {
  const headingId = React.useId();
  const { search, shouldFilter, filter } = useCommandContext();

  const groupItems = React.useMemo(() => {
    const found: ScannedCommandItem[] = [];
    collectItemsFromNode(children, found);
    return found;
  }, [children]);

  const hasVisibleItem = React.useMemo(() => {
    if (!shouldFilter || !search.trim() || groupItems.length === 0) {
      return true;
    }
    return groupItems.some((item) =>
      matchesCommandFilter(filter, item.value, search, item.keywords),
    );
  }, [shouldFilter, search, groupItems, filter]);

  if (!hasVisibleItem) return null;

  return (
    <div
      role="group"
      aria-labelledby={heading ? headingId : undefined}
      data-slot="command-group"
      className={cn('overflow-hidden p-1 text-foreground', className)}
      {...props}
    >
      {heading ? (
        <div
          id={headingId}
          data-slot="command-group-heading"
          className="px-2 py-1.5 font-sans text-[11.5px] font-medium text-muted-foreground"
        >
          {heading}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export interface CommandSeparatorProps extends SeparatorPrimitive.Props {
  alwaysRender?: boolean;
}

export function CommandSeparator({
  className,
  alwaysRender = false,
  ...props
}: CommandSeparatorProps) {
  const { search, shouldFilter } = useCommandContext();
  if (!alwaysRender && shouldFilter && search.trim().length > 0) {
    return null;
  }
  return (
    <SeparatorPrimitive
      data-slot="command-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export interface CommandItemProps
  extends Omit<React.ComponentProps<'div'>, 'onSelect'> {
  value?: string;
  keywords?: string[];
  disabled?: boolean;
  onSelect?: (value: string) => void;
}

export function CommandItem({
  className,
  value: valueProp,
  keywords,
  disabled = false,
  onSelect,
  onClick,
  onPointerMove,
  children,
  ...props
}: CommandItemProps) {
  const registrationKey = React.useId();
  const itemRef = React.useRef<HTMLDivElement>(null);
  const {
    search,
    shouldFilter,
    filter,
    activeValue,
    setActiveValue,
    registerItem,
    unregisterItem,
    getItemDomId,
  } = useCommandContext();

  const resolvedValue = React.useMemo(
    () => (valueProp ?? extractNodeText(children)).trim(),
    [valueProp, children],
  );

  const visible =
    !shouldFilter || matchesCommandFilter(filter, resolvedValue, search, keywords);
  const domId = getItemDomId(resolvedValue);
  const isSelected = !disabled && visible && activeValue === resolvedValue;

  React.useLayoutEffect(() => {
    registerItem(registrationKey, {
      value: resolvedValue,
      domId,
      disabled,
      visible,
      onSelect,
      element: itemRef.current,
    });
    return () => unregisterItem(registrationKey);
  }, [
    registrationKey,
    resolvedValue,
    domId,
    disabled,
    visible,
    onSelect,
    registerItem,
    unregisterItem,
  ]);

  if (!visible) return null;

  return (
    <div
      ref={itemRef}
      id={domId}
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      data-slot="command-item"
      data-value={resolvedValue}
      data-selected={isSelected ? 'true' : undefined}
      data-disabled={disabled ? '' : undefined}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (!disabled && activeValue !== resolvedValue) {
          setActiveValue(resolvedValue);
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          setActiveValue(resolvedValue);
          onSelect?.(resolvedValue);
        }
      }}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 font-sans text-[13px] leading-snug text-popover-foreground select-none transition-colors duration-100',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
(CommandItem as unknown as Record<symbol, boolean>)[COMMAND_ITEM_MARKER] = true;

export function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto font-mono text-[11.5px] tracking-wide text-faint-foreground',
        className,
      )}
      {...props}
    />
  );
}
