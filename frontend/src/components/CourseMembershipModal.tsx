import { DialogShell } from './ui/DialogShell';
import { Button } from './ui/Button';
import { ErrorNotice } from './ErrorNotice';
import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cache, MEMBERSHIP_FORM_CACHE_PREFIX } from '../lib/cache';
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
  const [form, setForm] = useState<MembershipFormResponse | null>(() => cache.getCachedMembershipForm(refId, action));
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const cached = cache.getCachedMembershipForm(refId, action);
    if (cached && !form) {
      setForm(cached);
    }
    const storageKey = `${MEMBERSHIP_FORM_CACHE_PREFIX}${refId}_${action}`;
    if (cached && cache.isIliasSaverFresh(storageKey)) {
      return () => { active = false; };
    }
    setIsRevalidating(true);
    api.getMembershipForm(refId, action).then((next) => {
      if (active) {
        setForm(next);
        cache.setCachedMembershipForm(refId, action, next);
      }
    }).catch((err) => {
      if (active && !cached) setError(err.message);
    }).finally(() => {
      if (active) setIsRevalidating(false);
    });
    return () => { active = false; };
  }, [refId, action]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || isRevalidating || !form?.available) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeMembership(refId, action, values);
      cache.invalidateCachedMembershipForm(refId, action);
      onChanged(result);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  const label = action === 'join' ? t("Kurs beitreten") : t("Kurs verlassen");
  return <DialogShell size="small" titleId="membership-title" title={label} description={title} closeDisabled={busy} onRequestClose={onClose} bodyClassName="space-y-4">
      {!form && !error && <p role="status">{t("Kursaktion wird geladen…")}</p>}
      {error && <ErrorNotice message={error} connectionInline />}
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>{t("Abbrechen")}</Button>
          {form.available ? <Button type="submit" variant="primary" disabled={busy || isRevalidating} title={isRevalidating ? t("Aktualisierung läuft... Bitte warten") : undefined}>{busy ? t("Wird gespeichert…") : label}</Button>
            : <a href={form.ilias_url} target="_blank" rel="noreferrer" className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white">{t("In ILIAS öffnen")}</a>}
        </div>
      </form>}
  </DialogShell>;
};
