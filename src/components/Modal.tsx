import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useExiting } from '../motion/Presence';
import Icon from './Icon';
export default function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const exiting = useExiting();
  const releaseModal = () => {
    const dialog = ref.current;
    if (!dialog) return;
    const focused = document.activeElement as HTMLElement | null;
    const ownedFocus = focused === document.body || focused === dialog || dialog.contains(focused);
    const other = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].find(
      (element) => element !== dialog && !element.inert,
    );
    if (dialog.open) dialog.close();
    if (other) {
      if (focused && other.contains(focused)) focused.focus({ preventScroll: true });
    } else if (ownedFocus && before.current?.isConnected) before.current.focus({ preventScroll: true });
    else if (focused?.isConnected) focused.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    before.current = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return releaseModal;
  }, []);
  useLayoutEffect(() => {
    if (!exiting) return;
    // Release native modality now; only an inert, non-modal visual remains for the exit.
    releaseModal();
    ref.current?.show();
  }, [exiting]);
  return (
    <>
      {exiting && <div className="modal-exit-shade" aria-hidden="true" />}
      <dialog
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        tabIndex={-1}
        data-motion-state={exiting ? 'exiting' : 'visible'}
        inert={exiting}
        aria-hidden={exiting || undefined}
        onCancel={(e) => {
          e.preventDefault();
          if (!exiting) onClose();
        }}
        onClick={(e) => {
          if (!exiting && e.target === e.currentTarget) onClose();
        }}
        aria-labelledby={titleId}
      >
        <div className="modal-header" inert={exiting}>
          <h2 id={titleId} className="wrap-cjk">{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body" inert={exiting}>
          {children}
        </div>
        <div className="ios-input-accessory-slot" data-ios-input-accessory-slot="" inert={exiting} />
        {footer && (
          <div className="modal-footer" inert={exiting}>
            {footer}
          </div>
        )}
      </dialog>
    </>
  );
}
