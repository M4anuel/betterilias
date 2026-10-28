export interface DialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  isAlert?: boolean;
}

export interface ActiveDialogState extends DialogOptions {
  id: number;
  resolve: (value: boolean) => void;
}

type DialogListener = (state: ActiveDialogState | null) => void;

let currentListener: DialogListener | null = null;
let dialogIdSeq = 0;

export function registerDialogListener(listener: DialogListener): () => void {
  currentListener = listener;
  return () => {
    if (currentListener === listener) {
      currentListener = null;
    }
  };
}

export function confirmDialog(options: DialogOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(true);
  if (!currentListener) {
    // Fallback if dialog component is not yet mounted
    return Promise.resolve(window.confirm(options.message));
  }
  return new Promise<boolean>((resolve) => {
    currentListener!({
      ...options,
      id: ++dialogIdSeq,
      resolve,
    });
  });
}

export function alertDialog(options: {
  title?: string;
  message: string;
  buttonLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}): Promise<void> {
  return confirmDialog({
    title: options.title,
    message: options.message,
    confirmLabel: options.buttonLabel,
    variant: options.variant || 'warning',
    isAlert: true,
  }).then(() => {});
}
