import { useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { Button } from './ui/Button';

function previewUpdate() {
  return new Promise<void>(resolve => window.setTimeout(resolve, 450));
}

export function UnisportAutosignIn({ updateEnabled = previewUpdate }: {
  updateEnabled?: (enabled: boolean) => Promise<void>;
}) {
  useLanguage();
  const hint = useId();
  const preview = updateEnabled === previewUpdate;
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [removeHint, setRemoveHint] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  async function toggle(button: HTMLButtonElement, restoreFocus: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !enabled;
    setRemoveHint(false);
    setPending(next);
    setError(false);
    try {
      await updateEnabled(next);
      setEnabled(next);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setPending(null);
      if (restoreFocus) requestAnimationFrame(() => {
        if (button.isConnected && document.activeElement === document.body) button.focus();
      });
    }
  }

  return <div className="relative ml-auto flex max-w-full flex-col items-end gap-1">
    <Button aria-pressed={enabled} aria-busy={pending !== null} aria-describedby={preview ? hint : undefined}
      disabled={pending !== null} onClick={event => void toggle(event.currentTarget, event.detail === 0)}
      onPointerEnter={event => {
        if (event.pointerType === 'mouse' && enabled && pending === null) setRemoveHint(true);
      }}
      onPointerLeave={() => setRemoveHint(false)}
      className="!w-[10.5rem] !justify-between !gap-1 text-left"
    >
      <span className="whitespace-nowrap">{t('unisport.autosign_in')}</span>
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center">
        {pending === false ? <LoaderCircle className="size-5 motion-safe:animate-spin" /> : enabled && pending === null && (
          <svg className="unisport-autosign-mark size-full" data-remove={removeHint} viewBox="0 0 26 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <g className="unisport-autosign-success">
              <path className="unisport-autosign-ring" pathLength="1" d="M13.74 2.15 A10 10 0 1 0 21.85 10.26" />
              <path className="unisport-autosign-check" pathLength="1" d="M6.8 12.2 L10.6 16 L23.2 3.4" />
            </g>
            <path className="unisport-autosign-x" d="M7 7 L19 17 M19 7 L7 17" />
          </svg>
        )}
      </span>
    </Button>
    {preview && <p id={hint} className="text-xs text-slate-600 dark:text-slate-400">
      {t('unisport.autosign_preview')}<span className="sr-only"> · {t('unisport.autosign_preview_hint')}</span>
    </p>}
    <span role="status" className="sr-only">{pending !== null
      ? t(pending ? 'unisport.autosign_enabling' : 'unisport.autosign_disabling')
      : ''}</span>
    {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{t('unisport.autosign_failed')}</p>}
  </div>;
}
