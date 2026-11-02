import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TestIdProps } from './types.js';

export type PopoverProps = TestIdProps & {
  open: boolean;
  onClose: () => void;
  /** Ref to the trigger: anchors the panel and receives focus on close. */
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  placement?: 'bottom-start' | 'bottom-end' | 'auto';
  /** Return focus to the anchor on close. Default true. */
  returnFocus?: boolean;
  children?: ReactNode;
};

const MARGIN = 8;
const GAP = 4;

function placePanel(
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: NonNullable<PopoverProps['placement']>,
) {
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let x = placement === 'bottom-end' ? anchorRect.right - panelRect.width : anchorRect.left;
  if (placement === 'auto') {
    const overflowsEnd = anchorRect.left + panelRect.width > window.innerWidth - MARGIN;
    x = overflowsEnd ? anchorRect.right - panelRect.width : anchorRect.left;
  }
  let y = anchorRect.bottom + GAP;
  if (y + panelRect.height > window.innerHeight - MARGIN) {
    const above = anchorRect.top - panelRect.height - GAP;
    y = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - panelRect.height - MARGIN);
  }
  const maxX = window.innerWidth - panelRect.width - MARGIN;
  x = Math.max(MARGIN, Math.min(x, Math.max(MARGIN, maxX)));
  panel.style.setProperty('--ui-popover-x', `${Math.round(x)}px`);
  panel.style.setProperty('--ui-popover-y', `${Math.round(y)}px`);
}

export function Popover({
  open,
  onClose,
  anchorRef,
  label,
  placement = 'bottom-start',
  returnFocus = true,
  children,
  'data-testid': dataTestId,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocus);
  onCloseRef.current = onClose;
  returnFocusRef.current = returnFocus;

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => placePanel(panel, anchor, placement);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement, anchorRef, children]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCloseRef.current();
    }
    function onPointer(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      if (returnFocusRef.current) anchorRef.current?.focus();
    };
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="ui-popover"
      aria-label={label}
      data-testid={dataTestId}
    >
      {children}
    </div>,
    document.body,
  );
}
