import { FeedbackBanner } from '../components/ui/FeedbackBanner';
import { Button } from '../components/ui/Button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, FolderOpen, RefreshCw, Server, Share2 } from 'lucide-react';
import { getLocale, t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { AdminError, adminRequest } from './api';

interface Report {
  seq?: number;
  id: string;
  created: number;
  kind: string;
  code: string;
  fingerprint: string;
  state: 'open' | 'resolved';
  revision: number;
  resolved_at: number | null;
  distribution?: string;
  app_version?: string;
  build?: string;
  source?: string;
  payload?: {
    schema: number;
    code: string;
    status: number;
    policy: number;
    occurred_at?: number;
    operation?: string;
    outcome?: string;
    request_id?: string;
    parser?: string;
    distribution?: string;
    app_version?: string;
    build?: string;
    instance_origin?: string;
    structure?: { outline: string; nodes: number; limited: boolean };
  };
}

interface Page {
  reports: Report[];
  counts: { kind: string; state: string; count: number }[];
  distribution_counts?: { distribution: string; state: string; count: number }[];
  versions?: string[];
  next_before: number | null;
}

const kinds = ['parsing', 'upstream', 'security', 'concurrency', 'application', 'client'];
function text(key: string) { return t(key as TranslationKey); }
function date(value: number) { return new Date(value * 1000).toLocaleString(getLocale()); }

export function ReportsPanel({ onExpired }: { onExpired: () => void }) {
  const language = useLanguage();
  const [distribution, setDistribution] = useState<'all' | 'local' | 'self-hosted'>('local');
  const [versionFilter, setVersionFilter] = useState('');
  const [state, setState] = useState('open');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState<Page>({ reports: [], counts: [], next_before: null });
  const [selected, setSelected] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forwardSuccess, setForwardSuccess] = useState<string | null>(null);
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
    if (distribution && distribution !== 'all') params.set('distribution', distribution);
    if (versionFilter) params.set('app_version', versionFilter);
    if (cursor) params.set('before', String(cursor));
    return `reports?${params}`;
  }

  useEffect(() => {
    const current = ++sequence.current;
    ++detailSequence.current;
    detailAbort.current?.abort();
    setSelected(null);
    setForwardSuccess(null);
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setLoading(true);
    setError('');
    setPage((previous) => ({ ...previous, reports: [], next_before: null }));

    void adminRequest<Page>(path(), { signal: abort.signal })
      .then((result) => {
        if (current === sequence.current) setPage(result);
      })
      .catch((err) => {
        if (current === sequence.current) fail(err);
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });

    return () => {
      abort.abort();
      detailAbort.current?.abort();
    };
  }, [distribution, versionFilter, state, kind, refresh, language, fail]);

  async function inspect(id: string) {
    const current = ++detailSequence.current;
    const abort = new AbortController();
    detailAbort.current?.abort();
    detailAbort.current = abort;
    setError('');
    setForwardSuccess(null);
    try {
      const result = await adminRequest<Report>(`reports/${id}`, { signal: abort.signal });
      if (current === detailSequence.current) {
        setSelected(result);
        window.setTimeout(() => detailHeading.current?.focus(), 0);
      }
    } catch (err) {
      if (current === detailSequence.current) fail(err);
    }
  }

  async function update() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await adminRequest(`reports/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          state: selected.state === 'open' ? 'resolved' : 'open',
          revision: selected.revision,
        }),
      });
      setRefresh((value) => value + 1);
      stateSelect.current?.focus();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function forwardToUpstream(reportId: string) {
    if (busy) return;
    setBusy(true);
    setForwardSuccess(null);
    setError('');
    try {
      const res = await adminRequest<{ shared: boolean }>(`reports/${reportId}/share-upstream`, {
        method: 'POST',
      });
      if (res.shared) {
        setForwardSuccess(t('reports.forward_success'));
        setTimeout(() => setForwardSuccess(null), 4000);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function more() {
    if (!page.next_before || busy) return;
    const current = sequence.current;
    setBusy(true);
    try {
      const result = await adminRequest<Page>(path(page.next_before), {
        signal: controller.current?.signal,
      });
      if (current === sequence.current) {
        setPage((previous) => ({
          ...result,
          reports: [...previous.reports, ...result.reports],
        }));
      }
    } catch (err) {
      if (current === sequence.current) fail(err);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diagnostic-${selected.id}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const localCount =
    page.distribution_counts
      ?.filter((c) => c.distribution === 'local' && (state === 'all' || c.state === state))
      .reduce((sum, c) => sum + c.count, 0) ?? 0;
  const selfHostedCount =
    page.distribution_counts
      ?.filter((c) => c.distribution === 'self-hosted' && (state === 'all' || c.state === state))
      .reduce((sum, c) => sum + c.count, 0) ?? 0;
  const allCount = localCount + selfHostedCount;

  return (
    <section className="admin-panel report-panel" aria-labelledby="report-panel-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="report-panel-title">{t('reports.admin_title')}</h2>
          <p className="admin-small">{t('reports.admin_hint')}</p>
        </div>
        <button
          type="button"
          className="admin-button"
          disabled={loading || busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={17} aria-hidden="true" />
          <span>{t('admin.refresh')}</span>
        </button>
      </div>

      {/* Distribution Segmentation: Local vs Self-Hosted Distribution Error Logs */}
      <div className="report-distribution-tabs" role="tablist" aria-label={t('reports.distribution_tabs')}>
        <button
          type="button"
          role="tab"
          aria-selected={distribution === 'local'}
          onClick={() => {
            setDistribution('local');
            setVersionFilter('');
          }}
          className={`report-tab ${distribution === 'local' ? 'report-tab-active' : ''}`}
        >
          <Server size={16} aria-hidden="true" />
          <span>{t('reports.dist_local')}</span>
          <span className="admin-badge">{localCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={distribution === 'self-hosted'}
          onClick={() => {
            setDistribution('self-hosted');
          }}
          className={`report-tab ${distribution === 'self-hosted' ? 'report-tab-active' : ''}`}
        >
          <Share2 size={16} aria-hidden="true" />
          <span>{t('reports.dist_self_hosted')}</span>
          <span className="admin-badge admin-badge-warning">{selfHostedCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={distribution === 'all'}
          onClick={() => {
            setDistribution('all');
          }}
          className={`report-tab ${distribution === 'all' ? 'report-tab-active' : ''}`}
        >
          <span>{t('reports.dist_all')}</span>
          <span className="admin-badge">{allCount}</span>
        </button>
      </div>

      {/* Context Banner for Self-Hosted Distribution Logs */}
      {distribution === 'self-hosted' && (
        <div className="admin-alert mb-4">
          <Share2 size={20} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <strong>{t('reports.self_hosted_section_title')}</strong>
            <p className="text-xs mt-1 text-slate-600 dark:text-slate-300">
              {t('reports.self_hosted_section_desc')}
            </p>
          </div>
        </div>
      )}

      {/* Category Folders */}
      <div className="report-folders" aria-label={t('reports.groups')}>
        {kinds.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={kind === item}
            onClick={() => setKind(kind === item ? '' : item)}
          >
            <FolderOpen size={18} aria-hidden="true" />
            <span>{text(`reports.kind.${item}`)}</span>
            <strong>
              {page.counts
                .filter((count) => count.kind === item && (state === 'all' || count.state === state))
                .reduce((sum, count) => sum + count.count, 0)}
            </strong>
          </button>
        ))}
      </div>

      {/* Filter Controls */}
      <div className="admin-filters">
        <div>
          <label htmlFor="report-state">{t('reports.state')}</label>
          <select
            id="report-state"
            ref={stateSelect}
            value={state}
            onChange={(event) => setState(event.target.value)}
            disabled={busy}
          >
            <option value="open">{t('reports.open')}</option>
            <option value="resolved">{t('reports.resolved')}</option>
            <option value="all">{t('reports.all')}</option>
          </select>
        </div>

        <div>
          <label htmlFor="report-kind">{t('reports.kind')}</label>
          <select
            id="report-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            disabled={busy}
          >
            <option value="">{t('reports.all_kinds')}</option>
            {kinds.map((item) => (
              <option key={item} value={item}>
                {text(`reports.kind.${item}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Version Filter when self-hosted or all is selected */}
        {page.versions && page.versions.length > 0 && (distribution === 'self-hosted' || distribution === 'all') && (
          <div>
            <label htmlFor="report-version">{t('reports.version_filter')}</label>
            <select
              id="report-version"
              value={versionFilter}
              onChange={(event) => setVersionFilter(event.target.value)}
              disabled={busy}
            >
              <option value="">{t('reports.all_versions')}</option>
              {page.versions.map((ver) => (
                <option key={ver} value={ver}>
                  v{ver}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {forwardSuccess && <FeedbackBanner tone="success" message={forwardSuccess} />}
      {error && (
        <FeedbackBanner
          tone="error"
          message={text(error)}
          actions={
            <Button onClick={() => (selected ? void inspect(selected.id) : setRefresh((value) => value + 1))}>
              {t('admin.retry')}
            </Button>
          }
        />
      )}

      {loading ? (
        <p role="status">{t('reports.loading')}</p>
      ) : page.reports.length ? (
        <ul className="report-list">
          {page.reports.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                className="report-select"
                aria-expanded={selected?.id === report.id}
                onClick={(event) => {
                  rowTrigger.current = event.currentTarget;
                  void inspect(report.id);
                }}
              >
                <span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>{text(`reports.kind.${report.kind}`)}</strong>
                    {report.distribution === 'self-hosted' ? (
                      <span className="admin-badge admin-badge-warning">
                        {t('reports.self_hosted_badge')} · v{report.app_version || '1.0.0'}
                      </span>
                    ) : (
                      <span className="admin-badge">
                        {t('reports.local_badge')}
                      </span>
                    )}
                  </div>
                  <code>{report.code}</code>
                  {report.source && report.distribution === 'self-hosted' && (
                    <span className="text-[11px] text-slate-400 block mt-1">{report.source}</span>
                  )}
                </span>
                <span>{date(report.created)}</span>
                <span className="admin-badge">{text(`reports.${report.state === 'open' ? 'open' : 'resolved'}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !error && <p role="status" className="admin-empty">{t('reports.admin_empty')}</p>
      )}

      {page.next_before && (
        <div className="admin-more">
          <button type="button" className="admin-button" disabled={busy} onClick={() => void more()}>
            {t('admin.load_more')}
          </button>
        </div>
      )}

      {selected && (
        <section className="report-detail" aria-labelledby="report-detail-title">
          <div className="admin-section-heading">
            <h3 id="report-detail-title" ref={detailHeading} tabIndex={-1}>
              {t('reports.detail_title')}
            </h3>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                setSelected(null);
                rowTrigger.current?.focus();
              }}
            >
              {t('Schliessen')}
            </button>
          </div>

          <dl className="admin-facts">
            <div>
              <dt>{t('reports.report_id')}</dt>
              <dd>
                <code>{selected.id}</code>
              </dd>
            </div>
            <div>
              <dt>{t('reports.fingerprint')}</dt>
              <dd>
                <code>{selected.fingerprint.slice(0, 16)}</code>
              </dd>
            </div>
            <div>
              <dt>{t('reports.distribution')}</dt>
              <dd>
                <span className={`admin-badge ${selected.distribution === 'self-hosted' ? 'admin-badge-warning' : ''}`}>
                  {selected.distribution === 'self-hosted' ? t('reports.dist_self_hosted') : t('reports.dist_local')}
                </span>
              </dd>
            </div>
            {selected.app_version && (
              <div>
                <dt>{t('reports.app_version')}</dt>
                <dd>
                  <code>v{selected.app_version}</code>
                </dd>
              </div>
            )}
            {selected.build && (
              <div>
                <dt>{t('reports.build')}</dt>
                <dd>
                  <code>{selected.build}</code>
                </dd>
              </div>
            )}
            {selected.source && (
              <div>
                <dt>{t('reports.source')}</dt>
                <dd>
                  <code>{selected.source}</code>
                </dd>
              </div>
            )}
            <div>
              <dt>{t('admin.event_code')}</dt>
              <dd>
                <code>{selected.code}</code>
              </dd>
            </div>
            {selected.payload?.occurred_at && (
              <div>
                <dt>{t('reports.occurred_at')}</dt>
                <dd>{date(selected.payload.occurred_at)}</dd>
              </div>
            )}
            {!!selected.payload?.status && (
              <div>
                <dt>{t('admin.status')}</dt>
                <dd>{selected.payload.status}</dd>
              </div>
            )}
            {selected.payload?.operation && (
              <div>
                <dt>{t('admin.operation')}</dt>
                <dd>
                  <code>{selected.payload.operation}</code>
                </dd>
              </div>
            )}
            {selected.payload?.outcome && (
              <div>
                <dt>{t('admin.outcome')}</dt>
                <dd>{text(`admin.outcome.${selected.payload.outcome}`)}</dd>
              </div>
            )}
            {selected.payload?.request_id && (
              <div>
                <dt>{t('admin.request_id')}</dt>
                <dd>
                  <code>{selected.payload.request_id}</code>
                </dd>
              </div>
            )}
            {selected.payload?.parser && (
              <div>
                <dt>{t('reports.parser')}</dt>
                <dd>
                  <code>{selected.payload.parser}</code>
                </dd>
              </div>
            )}
            <div>
              <dt>{t('reports.state')}</dt>
              <dd>{text(`reports.${selected.state === 'open' ? 'open' : 'resolved'}`)}</dd>
            </div>
            {selected.resolved_at && (
              <div>
                <dt>{t('reports.resolved_at')}</dt>
                <dd>{date(selected.resolved_at)}</dd>
              </div>
            )}
          </dl>

          {selected.payload?.structure ? (
            <>
              <p className="admin-small">{t('reports.structure_hint')}</p>
              <pre
                tabIndex={0}
                role="region"
                aria-label={t('reports.structure')}
                className="report-outline"
              >
                {selected.payload.structure.outline || t('reports.no_structure')}
              </pre>
              {selected.payload.structure.limited && (
                <p className="admin-small">{t('reports.limited')}</p>
              )}
            </>
          ) : (
            <p className="admin-small">{t('reports.no_structure')}</p>
          )}

          <div className="report-actions">
            <button
              type="button"
              className="admin-button"
              disabled={busy}
              onClick={() => void update()}
            >
              <Archive size={17} aria-hidden="true" />
              <span>{t(selected.state === 'open' ? 'reports.resolve' : 'reports.reopen')}</span>
            </button>
            <button type="button" className="admin-button" onClick={download}>
              <Download size={17} aria-hidden="true" />
              <span>{t('reports.download')}</span>
            </button>
            {selected.distribution !== 'self-hosted' && (
              <button
                type="button"
                className="admin-button"
                disabled={busy}
                onClick={() => void forwardToUpstream(selected.id)}
              >
                <Share2 size={17} aria-hidden="true" />
                <span>{t('reports.forward_upstream')}</span>
              </button>
            )}
          </div>
          <p className="admin-small">{t('reports.archive_hint')}</p>
        </section>
      )}
    </section>
  );
}
