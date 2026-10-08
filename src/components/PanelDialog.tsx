import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PanelDialogProps {
  id: string;
  open: boolean;
  title: string;
  summary: string;
  variant?: 'center' | 'drawer';
  returnFocusId: string;
  desktopFocusId?: string;
  restoreFocus?: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

export function PanelDialog({ id, open, title, summary, variant = 'center', returnFocusId,
  desktopFocusId, restoreFocus = true, onClose, footer, children }: PanelDialogProps) {
  const host = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const backdropPressed = useRef(false);
  const options = useRef({ returnFocusId, desktopFocusId, restoreFocus });
  options.current = { returnFocusId, desktopFocusId, restoreFocus };

  useLayoutEffect(() => {
    const dialog = host.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { scrollX, scrollY } = window;
    const root = document.documentElement;
    const body = document.body;
    const previous = { overflow: root.style.overflow, position: body.style.position,
      top: body.style.top, left: body.style.left, right: body.style.right };
    // Fixed body also prevents background scrolling on mobile Safari.
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = `${scrollbarWidth}px`;

    const viewport = window.visualViewport;
    const resize = () => {
      dialog.style.setProperty('--panel-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty('--panel-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    dialog.showModal();
    // Opening the team list on a phone should not summon the keyboard.
    const focusId = window.matchMedia('(min-width: 641px)').matches ? options.current.desktopFocusId : undefined;
    (focusId ? document.getElementById(focusId) : heading.current)?.focus({ preventScroll: true });

    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      dialog.close();
      root.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
      if (options.current.restoreFocus) {
        const target = opener?.isConnected && opener !== body ? opener : document.getElementById(options.current.returnFocusId);
        target?.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const panel = <dialog id={id} ref={host} className={`panel-dialog panel-dialog-${variant}`}
    aria-labelledby={`${id}Title`} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        // Native dialogs can otherwise send the next Tab to browser chrome.
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
          .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }}
    onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (event.target === event.currentTarget && backdropPressed.current) onClose();
      backdropPressed.current = false;
    }}>
    <div className="panel-surface">
      <header className="panel-header">
        <div className="panel-heading"><h2 id={`${id}Title`} className="panel-title" ref={heading} tabIndex={-1}>{title}</h2>
          <p className="panel-summary">{summary}</p></div>
        <button type="button" className="panel-close" aria-label={`关闭${title}`} onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="panel-body">{children}</div>
      <footer className="panel-footer">{footer}</footer>
    </div>
  </dialog>;
  return typeof document === 'undefined' ? panel : createPortal(panel, document.body);
}
