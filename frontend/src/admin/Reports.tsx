import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, FolderOpen, RefreshCw } from 'lucide-react';
import { getLocale, t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { AdminError, adminRequest } from './api';

interface Report {
  seq?: number; id: string; created: number; kind: string; code: string; fingerprint: string;
  state: 'open' | 'resolved'; revision: number; resolved_at: number | null;
  payload?: { schema: number; code: string; status: number; policy: number; occurred_at?: number; operation?: string; outcome?: string; request_id?: string; parser?: string;
    structure?: { outline: string; nodes: number; limited: boolean } };
}
interface Page { reports: Report[]; counts: { kind: string; state: string; count: number }[]; next_before: number | null }
const kinds = ['parsing', 'upstream', 'security', 'concurrency', 'application', 'client'];
function text(key: string) { return t(key as TranslationKey); }
function date(value: number) { return new Date(value * 1000).toLocaleString(getLocale()); }

export function ReportsPanel({ onExpired }: { onExpired: () => void }) {
  const language = useLanguage();
  const [state, setState] = useState('open');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState<Page>({ reports: [], counts: [], next_before: null });
  const [selected, setSelected] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const rowTrigger = useRef<HTMLButtonElement | null>(null);
  const stateSelect = useRef<HTMLSelectElement>(null);
  const fail = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    if (err instanceof AdminError && (err.status === 401 || err.status === 404)) onExpired();
    else setError(err instanceof AdminError && (err.status === 409 || err.status === 410) ? 'reports.changed' : 'reports.unavailable');
  }, [onExpired]);
  function path(cursor?: number) {
    const params = new URLSearchParams({ state, limit: '25' });
    if (kind) params.set('kind', kind);
    if (cursor) params.set('before', String(cursor));
    return `reports?${params}`;
  }
  useEffect(() => {
    const current = ++sequence.current;
    ++detailSequence.current; detailAbort.current?.abort(); setSelected(null);
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setLoading(true); setError(''); setPage(previous => ({ ...previous, reports: [], next_before: null }));
    void adminRequest<Page>(path(), { signal: abort.signal }).then(result => { if (current === sequence.current) setPage(result); })
      .catch(err => { if (current === sequence.current) fail(err); }).finally(() => { if (current === sequence.current) setLoading(false); });
    return () => { abort.abort(); detailAbort.current?.abort(); };
  }, [state, kind, refresh, language, fail]);
  async function inspect(id: string) {
    const current = ++detailSequence.current;
    const abort = new AbortController(); detailAbort.current?.abort(); detailAbort.current = abort;
    setError('');
    try {
      const result = await adminRequest<Report>(`reports/${id}`, { signal: abort.signal });
      if (current === detailSequence.current) {
        setSelected(result); window.setTimeout(() => detailHeading.current?.focus(), 0);
      }
    } catch (err) { if (current === detailSequence.current) fail(err); }
  }
  async function update() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      await adminRequest(`reports/${selected.id}`, { method: 'PATCH', body: JSON.stringify({
        state: selected.state === 'open' ? 'resolved' : 'open', revision: selected.revision }) });
      setRefresh(value => value + 1);
      stateSelect.current?.focus();
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  }
  async function more() {
    if (!page.next_before || busy) return;
    const current = sequence.current; setBusy(true);
    try {
      const result = await adminRequest<Page>(path(page.next_before), { signal: controller.current?.signal });
      if (current === sequence.current) setPage(previous => ({ ...result, reports: [...previous.reports, ...result.reports] }));
    } catch (err) { if (current === sequence.current) fail(err); }
    finally { setBusy(false); }
  }
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `diagnostic-${selected.id}.json`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="admin-panel report-panel" aria-labelledby="report-panel-title">
    <div className="admin-section-heading"><div><h2 id="report-panel-title">{t('reports.admin_title')}</h2><p className="admin-small">{t('reports.admin_hint')}</p></div>
      <button type="button" className="admin-button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} aria-hidden="true" /><span>{t('admin.refresh')}</span></button></div>
    <div className="report-folders" aria-label={t('reports.groups')}>{kinds.map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(kind === item ? '' : item)}>
      <FolderOpen size={18} aria-hidden="true" /><span>{text(`reports.kind.${item}`)}</span><strong>{page.counts.filter(count => count.kind === item && (state === 'all' || count.state === state)).reduce((sum, count) => sum + count.count, 0)}</strong>
    </button>)}</div>
    <div className="admin-filters"><div><label htmlFor="report-state">{t('reports.state')}</label><select id="report-state" ref={stateSelect} value={state} onChange={event => setState(event.target.value)} disabled={busy}>
      <option value="open">{t('reports.open')}</option><option value="resolved">{t('reports.resolved')}</option><option value="all">{t('reports.all')}</option></select></div>
      <div><label htmlFor="report-kind">{t('reports.kind')}</label><select id="report-kind" value={kind} onChange={event => setKind(event.target.value)} disabled={busy}><option value="">{t('reports.all_kinds')}</option>{kinds.map(item => <option key={item} value={item}>{text(`reports.kind.${item}`)}</option>)}</select></div></div>
    {error && <div role="alert" className="admin-alert">{text(error)}<button type="button" className="admin-button" onClick={() => selected ? void inspect(selected.id) : setRefresh(value => value + 1)}>{t('admin.retry')}</button></div>}
    {loading ? <p role="status">{t('reports.loading')}</p> : page.reports.length ? <ul className="report-list">{page.reports.map(report => <li key={report.id}>
      <button type="button" className="report-select" aria-expanded={selected?.id === report.id} onClick={event => { rowTrigger.current = event.currentTarget; void inspect(report.id); }}><span><strong>{text(`reports.kind.${report.kind}`)}</strong><code>{report.code}</code></span><span>{date(report.created)}</span><span className="admin-badge">{text(`reports.${report.state === 'open' ? 'open' : 'resolved'}`)}</span></button>
    </li>)}</ul> : !error && <p role="status" className="admin-empty">{t('reports.admin_empty')}</p>}
    {page.next_before && <div className="admin-more"><button type="button" className="admin-button" disabled={busy} onClick={() => void more()}>{t('admin.load_more')}</button></div>}
    {selected && <section className="report-detail" aria-labelledby="report-detail-title">
      <div className="admin-section-heading"><h3 id="report-detail-title" ref={detailHeading} tabIndex={-1}>{t('reports.detail_title')}</h3><button type="button" className="admin-button" onClick={() => { setSelected(null); rowTrigger.current?.focus(); }}>{t('Schliessen')}</button></div>
      <dl className="admin-facts"><div><dt>{t('reports.report_id')}</dt><dd><code>{selected.id}</code></dd></div><div><dt>{t('reports.fingerprint')}</dt><dd><code>{selected.fingerprint.slice(0, 16)}</code></dd></div>
        <div><dt>{t('admin.event_code')}</dt><dd><code>{selected.code}</code></dd></div>
        {selected.payload?.occurred_at && <div><dt>{t('reports.occurred_at')}</dt><dd>{date(selected.payload.occurred_at)}</dd></div>}
        {!!selected.payload?.status && <div><dt>{t('admin.status')}</dt><dd>{selected.payload.status}</dd></div>}
        {selected.payload?.operation && <div><dt>{t('admin.operation')}</dt><dd><code>{selected.payload.operation}</code></dd></div>}
        {selected.payload?.outcome && <div><dt>{t('admin.outcome')}</dt><dd>{text(`admin.outcome.${selected.payload.outcome}`)}</dd></div>}
        {selected.payload?.request_id && <div><dt>{t('admin.request_id')}</dt><dd><code>{selected.payload.request_id}</code></dd></div>}
        {selected.payload?.parser && <div><dt>{t('reports.parser')}</dt><dd><code>{selected.payload.parser}</code></dd></div>}
        <div><dt>{t('reports.state')}</dt><dd>{text(`reports.${selected.state === 'open' ? 'open' : 'resolved'}`)}</dd></div>
        {selected.resolved_at && <div><dt>{t('reports.resolved_at')}</dt><dd>{date(selected.resolved_at)}</dd></div>}</dl>
      {selected.payload?.structure ? <><p className="admin-small">{t('reports.structure_hint')}</p>
        <pre tabIndex={0} role="region" aria-label={t('reports.structure')} className="report-outline">{selected.payload.structure.outline || t('reports.no_structure')}</pre>
        {selected.payload.structure.limited && <p className="admin-small">{t('reports.limited')}</p>}</> : <p className="admin-small">{t('reports.no_structure')}</p>}
      <div className="report-actions"><button type="button" className="admin-button" disabled={busy} onClick={() => void update()}><Archive size={17} aria-hidden="true" /><span>{t(selected.state === 'open' ? 'reports.resolve' : 'reports.reopen')}</span></button>
        <button type="button" className="admin-button" onClick={download}><Download size={17} aria-hidden="true" /><span>{t('reports.download')}</span></button></div>
      <p className="admin-small">{t('reports.archive_hint')}</p>
    </section>}
  </section>;
}
