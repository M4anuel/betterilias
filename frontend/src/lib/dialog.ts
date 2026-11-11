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
let active: ActiveDialogState | null = null;
let queue: ActiveDialogState[] = [];

function advance() {
  if (!active) active = queue.shift() || null;
  currentListener?.(active);
}

export function registerDialogListener(listener: DialogListener): () => void {
  currentListener = listener;
  listener(active);
  return () => {
    if (currentListener === listener) {
      currentListener = null;
      const abandoned = [...(active ? [active] : []), ...queue];
      active = null; queue = [];
      abandoned.forEach(dialog => dialog.resolve(false));
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
    const id = ++dialogIdSeq;
    let settled = false;
    queue.push({
      ...options,
      id,
      resolve: value => {
        if (settled) return;
        settled = true;
        if (active?.id === id) active = null;
        queue = queue.filter(dialog => dialog.id !== id);
        resolve(value);
        if (currentListener) advance();
      },
    });
    if (!active) advance();
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
