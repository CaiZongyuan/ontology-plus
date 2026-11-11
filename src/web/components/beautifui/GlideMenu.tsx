import React, { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlideMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  itemSelector?: string;
  inset?: number;
  indicatorClassName?: string;
}

export function GlideMenu({
  itemSelector = '[data-glide-item]',
  inset = 0,
  indicatorClassName,
  className,
  onPointerMove,
  onPointerLeave,
  children,
  ...rest
}: GlideMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hoveredEl = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const warmRef = useRef(false);

  const measure = (el: HTMLElement) => {
    const root = rootRef.current;
    if (!root) return;
    const rootBox = root.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setRect({
      x: box.left - rootBox.left + inset,
      y: box.top - rootBox.top + inset,
      w: box.width - inset * 2,
      h: box.height - inset * 2,
    });
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      if (hoveredEl.current && visible) measure(hoveredEl.current);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [visible]);

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e);
    const root = rootRef.current;
    if (!root) return;
    const target = (e.target as HTMLElement | null)?.closest(itemSelector) as HTMLElement | null;
    if (!target || !root.contains(target) || target.hasAttribute('data-glide-disabled')) {
      if (visible) {
        hoveredEl.current = null;
        setVisible(false);
        warmRef.current = false;
      }
      return;
    }
    if (target !== hoveredEl.current) {
      hoveredEl.current = target;
      measure(target);
      if (!visible) {
        setVisible(true);
        requestAnimationFrame(() => {
          warmRef.current = true;
        });
      }
    }
  };

  const handleLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(e);
    hoveredEl.current = null;
    setVisible(false);
    warmRef.current = false;
  };

  return (
    <div
      ref={rootRef}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cn('relative', className)}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={
          rect
            ? {
                transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
                width: rect.w,
                height: rect.h,
              }
            : undefined
        }
        className={cn(
          'pointer-events-none absolute left-0 top-0 rounded-control bg-hover',
          visible ? 'opacity-100' : 'opacity-0',
          warmRef.current
            ? 'transition-[transform,width,height,opacity] duration-150 ease-out-strong'
            : 'transition-opacity duration-120 ease-out-strong',
          indicatorClassName,
        )}
      />
      {children}
    </div>
  );
}

