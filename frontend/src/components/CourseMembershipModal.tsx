import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { MembershipAction, MembershipFormResponse, MembershipResult } from '../types';

interface Props {
  refId: string;
  title: string;
  action: MembershipAction;
  onClose: () => void;
  onChanged: (result: MembershipResult) => void;
}

export const CourseMembershipModal: React.FC<Props> = ({ refId, title, action, onClose, onChanged }) => {
  useLanguage();
  const [form, setForm] = useState<MembershipFormResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    api.getMembershipForm(refId, action).then((next) => { if (active) setForm(next); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; previousFocus?.focus(); };
  }, [refId, action]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !form?.available) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeMembership(refId, action, values);
      onChanged(result);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  const label = action === 'join' ? t("Kurs beitreten") : t("Kurs verlassen");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="membership-title"
      className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const buttons = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]');
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="flex justify-between items-start gap-4">
        <div><h2 id="membership-title" className="text-lg font-bold">{label}</h2><p className="text-sm mt-1">{title}</p></div>
        <button ref={closeButton} type="button" disabled={busy} onClick={onClose} aria-label={t("Schliessen")}><X className="h-5 w-5" /></button>
      </div>
      {!form && !error && <p role="status">{t("Kursaktion wird geladen…")}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {form && <form onSubmit={submit} className="space-y-4">
        <p className="text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">{form.message || (action === 'join' ? t("Möchtest du diesem Kurs beitreten?") : t("Möchtest du diesen Kurs verlassen?"))}</p>
        {form.fields.map((field) => <label key={field.name} className="block text-sm">
          <span>{field.label}</span>
          <input type={field.field_type} required={field.required} disabled={busy}
            checked={field.field_type === 'checkbox' ? !!values[field.name] : undefined}
            value={field.field_type === 'checkbox' ? field.value : values[field.name] || ''}
            onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: field.field_type === 'checkbox' ? (event.target.checked ? field.value : '') : event.target.value }))}
            className={field.field_type === 'checkbox' ? 'ml-2' : 'mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2'} />
        </label>)}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="px-3 py-2 text-sm">{t("Abbrechen")}</button>
          {form.available ? <button type="submit" disabled={busy} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? t("Wird gespeichert…") : label}</button>
            : <a href={form.ilias_url} target="_blank" rel="noreferrer" className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white">{t("In ILIAS öffnen")}</a>}
        </div>
      </form>}
    </section>
  </div>;
};
