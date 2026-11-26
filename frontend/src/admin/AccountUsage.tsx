import { useEffect, useId, useState } from 'react';
import { adminRequest, AdminError } from './api';
import type { AccountPage, AdminSummary } from './api';
import { getLocale, t, useLanguage } from '../lib/i18n';

export function AccountUsage({ data, onExpired }: { data?: AdminSummary['accounts']; onExpired: () => void }) {
  const language = useLanguage(), id = useId();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AccountPage | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  const count = (value: number) => new Intl.NumberFormat(getLocale()).format(value);
  useEffect(() => {
    if (!open) { setPage(null); return; }
    const controller = new AbortController(); let current = true;
    setLoading(true); setError(false); setPage(null);
    const timer = setTimeout(() => {
      void adminRequest<AccountPage>('accounts/query', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ query, offset, limit: 50 }) }).then(result => {
        if (current) setPage(result);
      }).catch(failure => {
        if (!current || failure instanceof DOMException && failure.name === 'AbortError') return;
        setPage(null);
        if (failure instanceof AdminError && [401, 404].includes(failure.status)) onExpired();
        else setError(true);
      }).finally(() => { if (current) setLoading(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [open, query, offset, refresh, language, onExpired]);
  return <section className="activity-section account-usage" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{t('admin.accounts_title')}</h2>
    <p className="admin-small">{t('admin.accounts_hint', { days: data?.retention_days || 30 })}</p>
    {data && <div className="account-usage-totals">
      <div className="admin-panel admin-stat"><span>{t('admin.accounts_active')}</span><strong>{count(data.active)}</strong><p className="admin-small">{t('admin.activity_five_minutes')}</p></div>
      <div className="admin-panel admin-stat"><span>{t('admin.accounts_day')}</span><strong>{count(data.last_24_hours)}</strong><p className="admin-small">{t('admin.accounts_unique')}</p></div>
      <div className="admin-panel admin-stat"><span>{t('admin.accounts_retained', { days: data.retention_days })}</span><strong>{count(data.retained)}</strong><p className="admin-small">{t('admin.accounts_unique')}</p></div>
    </div>}
    <div className="admin-panel">
      <button type="button" className="admin-button" aria-expanded={open} aria-controls={`${id}-names`} onClick={() => setOpen(value => !value)}>
        {open ? t('admin.accounts_hide_names') : t('admin.accounts_show_names')}
      </button>
      {open && <div id={`${id}-names`} className="account-usage-names">
        <form role="search" method="post" action="/api/admin/accounts/query" onSubmit={event => { event.preventDefault(); setRefresh(value => value + 1); }}>
          <label htmlFor={`${id}-search`}>{t('admin.accounts_search')}</label>
          <div className="account-usage-search"><input id={`${id}-search`} type="search" name="query" value={query} maxLength={120} autoComplete="off" spellCheck={false}
            onChange={event => { setQuery(event.target.value); setOffset(0); }} />
            <button type="submit" className="admin-button" disabled={loading}>{t('admin.refresh')}</button></div>
        </form>
        {loading && <p role="status" className="admin-small">{t('admin.accounts_loading')}</p>}
        {error && <p role="alert" className="admin-error">{t('admin.accounts_failed')}</p>}
        {page && <>
          <p className="admin-small" role="status">{t('admin.accounts_results', { from: count(page.total ? offset + 1 : 0), to: count(offset + page.accounts.length), count: count(page.total) })}</p>
          <ul className="account-usage-list">{page.accounts.map(account => <li key={account.id}>
            <strong><bdi>{account.name || t('admin.accounts_unknown')}</bdi></strong>
            <span className="admin-small">{t('admin.accounts_last_seen')}: <time dateTime={new Date(account.last_seen * 1000).toISOString()}>{new Date(account.last_seen * 1000).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</time></span>
          </li>)}</ul>
          {!page.accounts.length && <p className="admin-empty">{t('admin.accounts_empty')}</p>}
          <div className="account-usage-pages">
            <button type="button" className="admin-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{t('admin.accounts_previous')}</button>
            <button type="button" className="admin-button" disabled={loading || offset + page.accounts.length >= page.total} onClick={() => setOffset(value => value + 50)}>{t('admin.accounts_next')}</button>
          </div>
        </>}
      </div>}
    </div>
  </section>;
}
