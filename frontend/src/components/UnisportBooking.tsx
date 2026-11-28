import { useEffect, useId, useRef, useState } from 'react';
import { t, useLanguage } from '../lib/i18n';
import { unisportFetch } from '../lib/unisport';
import { clearPrivate } from '../lib/unisportCache';
import { UnisportOffer, unisportDate } from '../lib/unisportOffers';
import { useNavigationGuard } from '../lib/navigationGuard';
import { Button } from './ui/Button';
import { DialogShell } from './ui/DialogShell';
import { FeedbackBanner } from './ui/FeedbackBanner';
import { ErrorNotice } from './ErrorNotice';
import { UnisportParticipants } from './UnisportParticipants';

type Field = {
  id: string; kind: string; title: string; required: boolean;
  choices: { id: string; title: string }[]; when: { id: string; value: string }[];
};
type Operation = {
  intent: string; phase: 'ready' | 'form' | 'confirmation' | 'dispatched' | 'uncertain' | 'confirmed' | 'rejected' | 'unsupported' | 'expired';
  kind: 'apply' | 'cancel'; offer: UnisportOffer; begin: string; fields: Field[];
  confirmation: string; provider_status: string; reason?: string; expires_at: number;
};
type Props = {
  credential: string; scope: string; affiliation: string; offerId: number; begin: string;
  kind?: 'auto' | 'apply' | 'cancel'; quick?: boolean; onChanged?: () => void; onBookingClosed?: () => void;
  cardAction?: boolean;
};
const control = 'min-h-12 w-full rounded-xl border border-slate-400 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-500 dark:bg-slate-950';
const profileFields: Record<string, string> = {
  'first name': 'given-name', vorname: 'given-name',
  'last name': 'family-name', surname: 'family-name', nachname: 'family-name',
  'full name': 'name', 'vollständiger name': 'name',
  email: 'email', 'e-mail': 'email', 'e-mail-adresse': 'email',
  'phone number': 'tel', telefonnummer: 'tel', mobilnummer: 'tel',
};

/** One mounted instance owns its form draft and exact account/occurrence receipt. */
export function UnisportBooking({ credential, scope, affiliation, offerId, begin, kind = 'auto', quick = false, onChanged, onBookingClosed, cardAction }: Props) {
  const language = useLanguage();
  const prefix = useId();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [filenames, setFilenames] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsCheck, setNeedsCheck] = useState(false);
  const pending = useRef(false), alive = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = 'betterilias_unisport_booking:' + JSON.stringify(kind === 'cancel'
    ? [scope, affiliation, offerId, begin, kind] : [scope, affiliation, offerId, begin]);
  const [receipt, setReceipt] = useState(() => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  });
  const request = (path: string, method = 'GET', body?: unknown) =>
    unisportFetch<Operation>(path, credential, method, body, undefined, scope, affiliation);
  useNavigationGuard({ isDirty: Object.keys(answers).length > 0 && operation?.phase === 'form', isPending: busy });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || !operation) return;
    const heading = dialog.current?.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [operation?.phase, open]);

  function receive(next: Operation) {
    setOperation(next); setReceipt(next.intent); setNeedsCheck(false);
    try { sessionStorage.setItem(key, next.intent); } catch { /* The server receipt still prevents replay. */ }
    if (next.phase !== 'ready') {
      clearPrivate();
      window.dispatchEvent(new CustomEvent('unisport-booking-changed', { detail: { scope, affiliation } }));
      onChanged?.();
    }
  }
  async function run(action: () => Promise<Operation>, showWhilePending = true) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    if (showWhilePending) setOpen(true);
    try {
      const next = await action();
      if (alive.current) receive(next);
    } catch (failure) {
      if (alive.current) {
        setError(failure instanceof Error ? failure.message : t('unisport.read_failed'));
        setNeedsCheck(true);
      }
    } finally {
      pending.current = false;
      if (alive.current) { setBusy(false); setOpen(true); }
    }
  }
  const check = () => void run(() => request(`/bookings/${operation?.intent || receipt}`));
  const start = () => {
    if (operation) { setOpen(true); return; }
    if (receipt) { check(); return; }
    void run(async () => {
      const prepared = await request(`/offers/${offerId}/booking`, 'POST', { kind, begin });
      if (!quick || !alive.current || prepared.phase !== 'ready') return prepared;
      // Save the receipt before dispatch so a lost response can be checked
      // without entering another write path.
      receive(prepared);
      return request(`/bookings/${prepared.intent}`, 'POST', { step: 'quick' });
    }, !quick);
  };
  const phase = operation?.phase;
  const canSubmit = operation && ['ready', 'form', 'confirmation'].includes(operation.phase) && !needsCheck;
  const active = (field: Field): boolean => field.when.every(rule => {
    const parent = operation?.fields.find(item => item.id === rule.id);
    return parent !== undefined && active(parent) && (answers[rule.id] || []).includes(rule.value);
  });
  const set = (id: string, values: string[]) => setAnswers(previous => ({ ...previous, [id]: values }));
  async function file(field: Field, input: HTMLInputElement) {
    const selected = input.files?.[0];
    input.setCustomValidity('');
    setFilenames(previous => ({ ...previous, [field.id]: selected?.name || '' }));
    if (!selected) { set(field.id, []); return; }
    if (selected.size > 1_000_000) { input.setCustomValidity(t('unisport.file_limit')); setError(t('unisport.file_limit')); set(field.id, []); return; }
    setBusy(true); pending.current = true;
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      if (alive.current) { set(field.id, [btoa(binary)]); setError(''); }
    } catch { input.value = ''; if (alive.current) { set(field.id, []); setError(t('unisport.file_failed')); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function fieldControl(field: Field) {
    const id = prefix + field.id;
    const selected = answers[field.id] || [];
    const title = <>{field.title || t('unisport.additional_field')}{field.required && <span> ({t('unisport.required')})</span>}</>;
    if (field.kind === 'checkBox' || field.kind === 'radioType') return <fieldset key={field.id} className="space-y-1">
      <legend className="text-sm font-semibold">{title}</legend>
      {field.choices.map((choice, index) => <label key={choice.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
        <input type={field.kind === 'checkBox' ? 'checkbox' : 'radio'} name={id} value={choice.id}
          className="h-5 w-5 shrink-0 accent-teal-700 focus-visible:outline-2 focus-visible:outline-teal-500"
          required={field.required && (field.kind === 'radioType' || index === 0 && selected.length === 0)}
          checked={selected.includes(choice.id)} onChange={event => set(field.id, field.kind === 'radioType' ? [choice.id]
            : event.target.checked ? [...selected, choice.id] : selected.filter(value => value !== choice.id))} />
        <span className="min-w-0 break-words">{choice.title || choice.id}</span>
      </label>)}
    </fieldset>;
    return <div key={field.id} className="space-y-1">
      <label htmlFor={id} className="block break-words text-sm font-semibold">{title}</label>
      {field.kind === 'dropDown' ? <select id={id} name={id} className={control} value={selected[0] || ''} required={field.required}
        onChange={event => set(field.id, event.target.value ? [event.target.value] : [])}>
        <option value="">{t('unisport.choose_answer')}</option>
        {field.choices.map(choice => <option key={choice.id} value={choice.id}>{choice.title || choice.id}</option>)}
      </select> : field.kind === 'textArea' ? <textarea id={id} name={id} className={control + ' min-h-28 py-3'} rows={4}
        maxLength={8000} required={field.required} value={selected[0] || ''} onChange={event => set(field.id, [event.target.value])} />
        : field.kind === 'fileType' ? <>
          <input id={id} name={id} type="file" className={control + ' py-3'} required={field.required && !selected.length}
            aria-describedby={id + '-hint'} onChange={event => void file(field, event.currentTarget)} />
          <p id={id + '-hint'} className="text-xs text-slate-600 dark:text-slate-400">{t('unisport.file_limit')}</p>
          {selected.length > 0 && <p className="break-words text-sm">{t('unisport.selected_file', { name: filenames[field.id] || '' })}</p>}
        </> : <input id={id} name={id} type={field.kind === 'dateType' ? 'date' : 'text'} className={control}
          autoComplete={field.kind === 'textField' ? profileFields[field.title.trim().toLowerCase()] : undefined}
          maxLength={8000} required={field.required} value={selected[0] || ''} onChange={event => set(field.id, [event.target.value])} />}
    </div>;
  }

  return <>
    <Button variant={cardAction ? 'ghost' : quick ? 'primary' : 'outline'} loading={busy && !open} onClick={start}
      className={cardAction ? `w-full !rounded-none !px-1 ${kind !== 'cancel' ? 'text-teal-800 dark:text-teal-300' : ''}` : undefined}>
      {t(cardAction ? kind === 'cancel' ? 'unisport.card_cancel' : 'unisport.card_register'
        : kind === 'cancel' ? 'unisport.cancel_registration' : quick ? 'unisport.register_now' : 'unisport.manage_registration')}
    </Button>
    {open && <DialogShell ref={dialog} title={t(operation?.kind === 'cancel' ? 'unisport.cancel_registration' : 'unisport.manage_registration')}
      closeDisabled={busy} onRequestClose={() => {
        setOpen(false);
        if (operation?.phase === 'confirmed') onBookingClosed?.();
      }} description={operation?.offer.title} className="unisport-booking-dialog">
      <div className="space-y-4">
        {busy && <p role="status">{t('unisport.booking_pending')}</p>}
        {error && <ErrorNotice message={error} connectionInline />}
        {operation && <>
          <p className="text-sm font-semibold">{unisportDate(operation.begin, language)}</p>
          {phase === 'ready' && <>
            <FeedbackBanner tone="warning" message={t(operation.kind === 'apply' ? 'unisport.booking_terms' : 'unisport.cancel_terms')} />
            {operation.offer.status && <p className="whitespace-pre-wrap text-sm">{operation.offer.status}</p>}
            {operation.offer.infos?.map((info, index) => <div key={index} className="space-y-1 break-words">
              <h3 className="text-sm font-semibold">{info.title}</h3><p className="whitespace-pre-wrap text-sm">{info.content}</p>
            </div>)}
            {operation.offer.important && <p className="whitespace-pre-wrap text-sm">{operation.offer.important}</p>}
            {operation.offer.special && <p className="whitespace-pre-wrap text-sm">{operation.offer.special}</p>}
          </>}
          {phase === 'confirmation' && <FeedbackBanner tone="warning" message={operation.confirmation} />}
          {phase === 'confirmed' && <FeedbackBanner tone="success" message={t(operation.kind === 'apply' ? 'unisport.registration_confirmed' : 'unisport.cancellation_confirmed')} />}
          {(operation.kind === 'apply' && phase === 'confirmed' || operation.kind === 'cancel' && (phase === 'ready' || phase === 'confirmation')) &&
            <UnisportParticipants offerUrl={operation.offer.url} scope={scope} affiliation={affiliation} />}
          {operation.provider_status && <p role="status" className="whitespace-pre-wrap text-sm font-semibold">{operation.provider_status}</p>}
          {phase === 'rejected' && <FeedbackBanner tone="error" message={operation.reason || t('unisport.booking_rejected')} />}
          {phase === 'unsupported' && <FeedbackBanner tone="warning" message={t('unisport.unsupported_form')} />}
          {phase === 'expired' && <FeedbackBanner tone="warning" message={t('unisport.intent_expired')} />}
          {(phase === 'uncertain' || phase === 'dispatched' || needsCheck) && <FeedbackBanner tone="warning" message={t('unisport.booking_uncertain')} />}
          {canSubmit && <form action={`/api/unisport/bookings/${operation.intent}`} method="post" aria-labelledby={prefix + '-form-title'}
            className="space-y-4" onSubmit={event => {
              event.preventDefault();
              void run(() => request(`/bookings/${operation.intent}`, 'POST', {
                step: phase === 'form' ? 'answers' : phase === 'confirmation' ? 'confirm' : 'start',
                answers: Object.fromEntries(operation.fields.filter(active).map(field => [field.id, answers[field.id] || []])),
              }));
            }}>
            <h3 id={prefix + '-form-title'} className="font-semibold">{t(phase === 'form' ? 'unisport.additional_details' : 'unisport.confirm_action')}</h3>
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <legend className="sr-only">{t('unisport.additional_details')}</legend>
              {phase === 'form' && operation.fields.filter(active).map(fieldControl)}
              {phase === 'ready' && operation.kind === 'apply' && <label className="flex min-h-12 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" name="accept" required checked={accepted} onChange={event => setAccepted(event.target.checked)} className="h-5 w-5 shrink-0 accent-teal-700" />
                <span>{t('unisport.accept_terms')}</span>
              </label>}
              <Button type="submit" loading={busy} variant={operation.kind === 'cancel' ? 'danger' : 'primary'} className="min-h-12 w-full sm:w-auto">
                {t(phase === 'form' ? 'unisport.submit_registration' : operation.kind === 'cancel' ? 'unisport.confirm_cancellation' : 'unisport.register_now')}
              </Button>
            </fieldset>
          </form>}
          {['uncertain', 'dispatched'].includes(operation.phase) || needsCheck ? <Button loading={busy} onClick={check}>{t('unisport.check_booking')}</Button> : null}
          {['confirmed', 'rejected', 'expired'].includes(operation.phase) && <Button loading={busy} onClick={() => {
            setAnswers({}); setFilenames({}); setAccepted(false);
            void run(() => request(`/offers/${offerId}/booking`, 'POST', { kind, begin }));
          }}>{t('unisport.manage_registration')}</Button>}
          {operation.offer.url && <a href={operation.offer.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center text-sm font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300">{t('unisport.official_offer')}</a>}
        </>}
        {!operation && !busy && <Button onClick={() => { if (receipt) check(); else { setNeedsCheck(false); start(); } }}>{t(receipt ? 'unisport.check_booking' : 'Erneut versuchen')}</Button>}
      </div>
    </DialogShell>}
  </>;
}
