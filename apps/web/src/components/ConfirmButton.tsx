import { useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/api';
export function ConfirmButton({
  label,
  message,
  onConfirm,
  disabled = false,
}: {
  label: string;
  message: string;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" type="button" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      <dialog
        className="dialog"
        ref={dialog}
        aria-label={`Confirm ${label}`}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setOpen(false);
        }}
      >
        <h2>{label}</h2>
        <p>{message}</p>
        {error ? (
          <p role="alert" className="field__error">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Working…' : `Confirm ${label.toLowerCase()}`}
          </button>
        </div>
      </dialog>
    </>
  );
}
