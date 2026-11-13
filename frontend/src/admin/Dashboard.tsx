import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, ChevronDown, LogOut, Moon, RefreshCw, ShieldCheck, Sun, TriangleAlert } from 'lucide-react';
import { getLocale, languages, setLanguage, t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { theme } from '../lib/theme';
import { AdminError, adminRequest } from './api';
import type { AdminEvent, AdminSession, AdminSummary, EventPage } from './api';
import { FeatureRequestsView } from '../components/FeatureRequestsView';
import { ConfirmModal } from '../components/ConfirmModal';
import { ReportsPanel } from './Reports';
import { Activity as ActivityPanel } from './Activity';

const categories = ['security', 'compatibility', 'operational', 'audit', 'request'];
function label(key: string) { return t(key as TranslationKey); }
function number(value: number | null | undefined) { return value == null ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value); }
function date(value: number | null | undefined) { return value ? new Date(value * 1000).toLocaleString(getLocale()) : t('admin.no_data'); }

export function AdminDashboard() {
  const language = useLanguage();
  const [dark, setDark] = useState(theme.isDarkEffective());
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const authVersion = useRef(0);
  const authenticated = !!session?.authenticated;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { theme.applyTheme(); setDark(theme.isDarkEffective()); };
    media.addEventListener('change', update);
    window.addEventListener('storage', update);
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', update); };
  }, []);
  useEffect(() => { document.title = `${t('admin.title')} · BetterIlias`; }, [language]);
  const check = useCallback(async () => {
    const current = ++authVersion.current;
    setChecking(true); setError(''); setDisabled(false);
    try {
      const result = await adminRequest<AdminSession>('session');
      if (current === authVersion.current) setSession(result);
    }
    catch (err) {
      if (current !== authVersion.current) return;
      if (err instanceof AdminError && err.status === 404) setDisabled(true);
      else setError('admin.unavailable');
    } finally { if (current === authVersion.current) setChecking(false); }
  }, []);
  useEffect(() => { void check(); return () => { ++authVersion.current; }; }, [check]);
  useEffect(() => {
    if (!authenticated || !session?.expires_at) return;
    const timer = window.setTimeout(() => { ++authVersion.current; setSession(null); setError('admin.expired'); },
      Math.max(0, session.expires_at * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [authenticated, session?.expires_at]);
  useEffect(() => { if (!checking && !authenticated && !disabled && !signingIn) password.current?.focus(); }, [checking, authenticated, disabled, signingIn]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!key || signingIn) return;
    const body = JSON.stringify({ key });
    ++authVersion.current;
    setKey(''); setError(''); setSigningIn(true);
    try { setSession(await adminRequest<AdminSession>('session', { method: 'POST', body })); }
    catch (err) {
      setError(err instanceof AdminError && err.status === 429 ? 'admin.throttled' :
        err instanceof AdminError && err.status === 401 ? 'admin.login_failed' : 'admin.unavailable');
      password.current?.focus();
    } finally { setSigningIn(false); }
  }
  async function logout() {
    ++authVersion.current;
    try { await adminRequest('session', { method: 'DELETE' }); setSession(null); setError(''); }
    catch { setError('admin.logout_failed'); }
  }
  const expired = useCallback(() => { ++authVersion.current; setSession(null); setError('admin.expired'); }, []);

  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-main">{t('admin.skip')}</a>
    <header className="admin-header"><div className="admin-header-inner">
      <a href="/" className="admin-brand" aria-label={t('admin.back_app')}><span>Better</span><span>Ilias</span></a>
      <span className="admin-header-label"><ShieldCheck size={16} aria-hidden="true" />{t('admin.title')}</span>
      <div className="admin-header-actions">
        <div className="admin-language"><label htmlFor="admin-language" className="sr-only">{t('admin.language')}</label>
          <select id="admin-language" value={language} onChange={e => setLanguage(e.target.value)}>{Object.entries(languages).map(([code, item]) => <option key={code} value={code}>{item.name}</option>)}</select>
        </div>
        <button type="button" className="admin-icon-button" aria-label={t(dark ? 'admin.light' : 'admin.dark')} onClick={() => { theme.setThemeMode(dark ? 'light' : 'dark'); setDark(!dark); }}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
        {authenticated && <button type="button" className="admin-button admin-logout" aria-label={t('admin.logout')} onClick={() => void logout()}><LogOut size={17} aria-hidden="true" /><span>{t('admin.logout')}</span></button>}
      </div>
    </div></header>
    <main id="admin-main" className="admin-main">
      {authenticated ? <>
        {error && <div role="alert" className="admin-alert">{label(error)}</div>}
        <a className="admin-button" href="#feature-requests">{t('requests.manage')}</a>
        <Overview onExpired={expired} expires={session.expires_at} />
        <ReportsPanel onExpired={expired} />
        <FeatureRequestsView admin />
        <ConfirmModal />
      </> : <section className="admin-login admin-panel" aria-labelledby="admin-login-title">
        <div className="admin-emblem"><ShieldCheck size={28} aria-hidden="true" /></div>
        <p className="admin-eyebrow">BetterIlias · {t('admin.title')}</p>
        <h1 id="admin-login-title">{t('admin.sign_in')}</h1>
        <p className="admin-muted">{t('admin.login_hint')}</p>
        {checking ? <p role="status">{t('admin.checking')}</p> : disabled ? <div className="admin-alert" role="status">{t('admin.disabled')}</div> : <>
          {error && <div role="alert" className="admin-alert">{label(error)}</div>}
          <form onSubmit={login}>
            <label htmlFor="admin-key">{t('admin.key')}</label>
            <input ref={password} id="admin-key" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} required maxLength={256} disabled={signingIn} />
            <button className="admin-button admin-primary" type="submit" disabled={signingIn || !key}>{t(signingIn ? 'admin.signing_in' : 'admin.sign_in')}<ArrowRight size={18} aria-hidden="true" /></button>
          </form>
          {error && <button type="button" className="admin-button admin-retry" onClick={() => void check()}>{t('admin.retry')}</button>}
        </>}
        <p className="admin-login-note">{t('admin.session_hint')}</p>
        <a href="/" className="admin-back"><ArrowLeft size={16} aria-hidden="true" />{t('admin.back_app')}</a>
      </section>}
      <footer className="admin-footer"><ShieldCheck size={15} aria-hidden="true" />{t('admin.privacy')}</footer>
    </main>
  </div>;
}

function Overview({ onExpired, expires }: { onExpired: () => void; expires: number | null }) {
  const language = useLanguage();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [requestDraft, setRequestDraft] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<number | null>(null);
  const generation = useRef(0);
  const previousFilter = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  function query(cursor?: number) {
    const params = new URLSearchParams({ limit: '50' });
    if (category) params.set('category', category);
    if (code) params.set('code', code);
    if (requestId) params.set('request_id', requestId);
    if (cursor) params.set('before', String(cursor));
    return `events?${params}`;
  }
  const failed = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    if (err instanceof AdminError && (err.status === 401 || err.status === 404)) onExpired();
    else setError('admin.refresh_failed');
  }, [onExpired]);
  useEffect(() => {
    const current = ++generation.current;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setLoading(true); setMore(false); setError('');
    const filter = `${category}:${code}:${requestId}`;
    if (previousFilter.current !== filter) { setEvents([]); setBefore(null); previousFilter.current = filter; }
    void Promise.all([adminRequest<AdminSummary>('summary', { signal: abort.signal }),
      adminRequest<EventPage>(query(), { signal: abort.signal })]).then(([data, page]) => {
      if (current !== generation.current) return;
      setSummary(data); setEvents(page.events); setBefore(page.next_before); setUpdated(Date.now() / 1000);
    }).catch(err => { if (current === generation.current) failed(err); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => abort.abort();
  }, [category, code, requestId, refresh, language, failed]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (!document.hidden && !loading && !more) setRefresh(n => n + 1); }, 30000);
    return () => window.clearInterval(timer);
  }, [auto, loading, more]);
  async function loadMore() {
    if (!before || more || loading) return;
    const current = generation.current; setMore(true); setError('');
    try {
      const page = await adminRequest<EventPage>(query(before), { signal: controller.current?.signal });
      if (current !== generation.current) return;
      setEvents(previous => [...previous, ...page.events.filter(event => !previous.some(item => item.id === event.id))]);
      setBefore(page.next_before);
    } catch (err) { if (current === generation.current) failed(err); }
    finally { if (current === generation.current) setMore(false); }
  }
  const diagnostic = summary?.diagnostics;
  const counts = diagnostic?.retained_counts || {};
  const security = Object.entries(counts).reduce((sum, [name, count]) => sum + (name.startsWith('auth.') || name.startsWith('input.invalid_identifier') || name.startsWith('admin.rejected') || ['outbound.malformed_url', 'outbound.origin_not_allowed', 'outbound.ambiguous_command', 'outbound.unsafe_command', 'outbound.external_write', 'outbound.private_address'].includes(name) ? count : 0), 0);
  const codes = Object.entries(summary?.event_catalogue || {}).filter(([, group]) => !category || group === category).map(([name]) => name).sort();
  if (code && !codes.includes(code)) codes.push(code);
  return <>
    <div className="admin-heading"><div><p className="admin-eyebrow">{t('admin.console')}</p><h1>{t('admin.overview')}</h1><p className="admin-muted">{t('admin.overview_hint')}</p></div>
      <button type="button" className="admin-button" disabled={loading || more} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={17} aria-hidden="true" />{t(loading ? 'admin.refreshing' : 'admin.refresh')}</button>
    </div>
    <div className="admin-update"><span>{t('admin.updated', { time: date(updated) })}</span><span>{t('admin.expires', { time: date(expires) })}</span></div>
    {error && <div role="alert" className="admin-alert">{label(error)}<button className="admin-button" onClick={() => setRefresh(n => n + 1)}>{t('admin.retry')}</button></div>}
    <section className="admin-stat-grid" aria-label={t('admin.metrics')} aria-busy={loading}>
      <Stat title={t('admin.requests')} value={number(diagnostic?.retained_request_metrics.count)} note={t('admin.retained')} icon={<Activity size={19} />} />
      <Stat title={t('admin.errors')} value={number(diagnostic?.retained_request_metrics.server_errors)} note={t('admin.server_errors_hint')} alert={!!diagnostic?.retained_request_metrics.server_errors} />
      <Stat title={t('admin.rejections')} value={diagnostic ? number(security) : '—'} note={t('admin.rejections_hint')} />
      <Stat title={t('admin.dropped')} value={number(diagnostic?.dropped)} note={t('admin.current_worker')} alert={!!diagnostic?.dropped} />
    </section>
    <ActivityPanel data={summary?.activity} />
    <div className="admin-health-grid">
      <section className="admin-panel" aria-labelledby="admin-writer"><div className="admin-section-heading"><h2 id="admin-writer">{t('admin.writer')}</h2>{diagnostic && <span className={`admin-badge ${diagnostic.writer_alive && !diagnostic.storage_errors ? 'admin-good' : 'admin-bad'}`}>{diagnostic.writer_alive && !diagnostic.storage_errors ? <Check size={14} /> : <TriangleAlert size={14} />}{t(diagnostic.writer_alive && !diagnostic.storage_errors ? 'admin.running' : 'admin.attention')}</span>}</div>
        <dl className="admin-facts"><Fact name={t('admin.queue')} value={number(diagnostic?.queue_depth)} /><Fact name={t('admin.storage_errors')} value={number(diagnostic?.storage_errors)} /><Fact name={t('admin.console_errors')} value={number(diagnostic?.console_errors)} /><Fact name={t('admin.last_write')} value={date(diagnostic?.last_write)} /><Fact name={t('admin.worker_id')} value={<code>{diagnostic?.worker || '—'}</code>} /><Fact name={t('admin.retention')} value={diagnostic ? t('admin.days', { count: number(diagnostic.retention_seconds / 86400) }) : '—'} /></dl>
        <p className="admin-small">{t('admin.worker_hint')}</p>
      </section>
      <section className="admin-panel" aria-labelledby="admin-outbound"><h2 id="admin-outbound">{t('admin.outbound')}</h2><dl className="admin-facts"><Fact name={t('admin.admitted')} value={number(summary?.outbound.requests)} /><Fact name={t('admin.waiting')} value={number(summary?.outbound.queued)} /><Fact name={t('admin.refused')} value={number(summary?.outbound.rejected)} /><Fact name={t('admin.throttles')} value={number(summary?.outbound.throttles)} /><Fact name={t('admin.mean_latency')} value={t('admin.ms', { value: number(diagnostic?.retained_request_metrics.mean_ms) })} /><Fact name={t('admin.cooldown')} value={summary && summary.outbound.cooldown_until > Date.now() / 1000 ? date(summary.outbound.cooldown_until) : t('admin.none')} /></dl><p className="admin-small">{t('admin.outbound_hint')}</p></section>
    </div>
    <section className="admin-panel admin-events" aria-labelledby="admin-events-title">
      <div className="admin-section-heading"><div><h2 id="admin-events-title">{t('admin.events')}</h2><p className="admin-small">{t('admin.events_hint')}</p></div><label className="admin-auto"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />{t('admin.auto')}</label></div>
      <div className="admin-filters"><div><label htmlFor="admin-category">{t('admin.category')}</label><select id="admin-category" value={category} onChange={e => { setCategory(e.target.value); setCode(''); }}><option value="">{t('admin.all_categories')}</option>{categories.map(item => <option key={item} value={item}>{label(`admin.category.${item}`)}</option>)}</select></div><div><label htmlFor="admin-code">{t('admin.event_code')}</label><select id="admin-code" value={code} onChange={e => setCode(e.target.value)}><option value="">{t('admin.all_codes')}</option>{codes.map(item => <option key={item} value={item}>{item}</option>)}</select></div></div>
      <form className="admin-request-filter" onSubmit={event => { event.preventDefault(); setRequestId(requestDraft.trim()); }}>
        <div><label htmlFor="admin-request-filter">{t('admin.request_filter')}</label>
          <input id="admin-request-filter" value={requestDraft} onChange={event => setRequestDraft(event.target.value.toLowerCase())}
            autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={32} aria-describedby="admin-request-hint" />
          <p id="admin-request-hint" className="admin-small">{t('admin.request_filter_hint')}</p></div>
        <button type="submit" className="admin-button" disabled={!!requestDraft.trim() && !/^[a-f0-9]{32}$/.test(requestDraft.trim())}>{t('admin.apply_filter')}</button>
        <button type="button" className="admin-button" disabled={!requestId && !requestDraft} onClick={() => { setRequestId(''); setRequestDraft(''); }}>{t('admin.clear_filter')}</button>
      </form>
      {loading && <p role="status" className="admin-small">{t('admin.loading')}</p>}
      {events.length ? <ul className="admin-event-list">{events.map(event => <EventRow key={event.id} event={event} onRelated={id => {
        setRequestId(id); setRequestDraft(id); setCategory(''); setCode('');
      }} />)}</ul> : !loading && <p className="admin-empty" role="status">{t(error ? 'admin.no_results_error' : 'admin.empty')}</p>}
      {before && !loading && <div className="admin-more"><button className="admin-button" disabled={more} onClick={() => void loadMore()}>{t(more ? 'admin.loading' : 'admin.load_more')}<ChevronDown size={17} aria-hidden="true" /></button></div>}
    </section>
  </>;
}

function Stat({ title, value, note, icon, alert }: { title: string; value: string; note: string; icon?: ReactNode; alert?: boolean }) {
  return <div className={`admin-panel admin-stat ${alert ? 'admin-stat-alert' : ''}`}><div className="admin-stat-label">{title}{icon}</div><strong>{value}</strong><p className="admin-small">{note}</p></div>;
}
function Fact({ name, value }: { name: string; value: ReactNode }) { return <div><dt>{name}</dt><dd>{value}</dd></div>; }
function EventRow({ event, onRelated }: { event: AdminEvent; onRelated: (id: string) => void }) {
  const level = event.level || (event.code === 'request.failed' || event.code === 'runtime.error' || (event.status || 0) >= 500 ? 'ERROR' :
    event.category === 'security' || event.category === 'compatibility' || event.code === 'runtime.warning' ||
    (event.status || 0) >= 400 || ['partial', 'uncertain', 'failed', 'rejected'].includes(event.outcome || '') ? 'WARNING' : 'INFO');
  return <li><details className="admin-event"><summary><span className={`admin-badge admin-level-${level.toLowerCase()}`}>{label(`admin.level.${level}`)}</span><span className="admin-event-name"><strong>{label(`admin.event.${event.code}`)}</strong><code>{event.code}</code></span><time dateTime={new Date(event.timestamp * 1000).toISOString()}>{date(event.timestamp)}</time><ChevronDown size={16} aria-hidden="true" /></summary><dl className="admin-event-detail">
    <Fact name={t('admin.category')} value={label(`admin.category.${event.category}`)} />
    {event.request_id && <Fact name={t('admin.request_id')} value={<code>{event.request_id}</code>} />}
    {event.operation_id && <Fact name={t('admin.operation_id')} value={<code>{event.operation_id}</code>} />}
    {event.worker && <Fact name={t('admin.worker_id')} value={<code>{event.worker}</code>} />}
    {event.operation && <Fact name={t('admin.operation')} value={<code>{event.operation}</code>} />}
    {event.outcome && <Fact name={t('admin.outcome')} value={label(`admin.outcome.${event.outcome}`)} />}
    {event.component && <Fact name={t('admin.component')} value={<code>{event.component}</code>} />}
    {event.method && <Fact name={t('admin.method')} value={<code>{event.method}</code>} />}
    {event.status != null && <Fact name={t('admin.status')} value={number(event.status)} />}
    {event.duration_ms != null && <Fact name={t('admin.duration')} value={t('admin.ms', { value: number(event.duration_ms) })} />}
    {event.route && <Fact name={t('admin.route_template')} value={<code>{event.route === 'unmatched' ? t('admin.route_unmatched') : event.route}</code>} />}
    {event.parser && <Fact name={t('admin.parser')} value={<code>{event.parser}</code>} />}
    {event.reason && <Fact name={t('admin.failure_reason')} value={label(`admin.reason.${event.reason}`)} />}
    {event.error_kind && event.error_kind !== event.reason && <Fact name={t('admin.error_kind')} value={label(`admin.reason.${event.error_kind}`)} />}
    {event.app_version && <Fact name={t('admin.app_version')} value={<code>{event.app_version}</code>} />}
    {event.build && <Fact name={t('admin.backend_build')} value={<code>{event.build}</code>} />}
    {event.source && <Fact name={t('admin.source_location')} value={<code>{event.source.file}:{event.source.line} · {event.source.function}</code>} />}
    {!!event.stack?.length && <Fact name={t('admin.code_stack')} value={<div className="admin-code-stack" tabIndex={0} role="region" aria-label={t('admin.code_stack')}><ol>
      {event.stack.map((frame, index) => <li key={index}><code>{frame.file}:{frame.line} · {frame.function}</code></li>)}
    </ol></div>} />}
    {event.stack_truncated && <Fact name={t('admin.code_stack')} value={t('admin.stack_truncated')} />}
  </dl>{event.request_id && <div className="admin-event-actions"><button type="button" className="admin-button" onClick={() => onRelated(event.request_id!)}>{t('admin.related_events')}</button></div>}</details></li>;
}
