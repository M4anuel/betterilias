import { useId, useState } from 'react';
import { getLocale, t } from '../lib/i18n';
import type { ActivityBucket, ActivitySummary } from './api';

function time(value: number) { return new Date(value * 1000).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }); }
function count(value: number) { return new Intl.NumberFormat(getLocale()).format(value); }

function Chart({ title, buckets, browser }: { title: string; buckets: ActivityBucket[]; browser: boolean }) {
  const id = useId();
  const [selection, setSelection] = useState<number | null>(null);
  const index = Math.min(selection ?? buckets.length - 1, buckets.length - 1);
  const selected = buckets[index];
  const max = Math.max(1, ...buckets.map(bucket => bucket.count));
  return <section className="admin-panel activity-chart" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    <p className="admin-small">{t('admin.activity_scale', { count: count(max) })}</p>
    <svg viewBox="0 0 480 150" role="img" aria-label={title}>
      <line x1="0" x2="480" y1="144" y2="144" stroke="currentColor" opacity="0.25" />
      {buckets.map((bucket, i) => <rect key={i} x={i * 480 / buckets.length + 2} y={144 - bucket.count / max * 132}
        width={480 / buckets.length - 4} height={bucket.count / max * 132} rx="3"
        className={i === index ? 'activity-selected' : ''} />)}
    </svg>
    <div className="activity-axis" aria-hidden="true"><span>{buckets[0] && time(buckets[0].start)}</span><span>{buckets.at(-1) && time(buckets.at(-1)!.end)}</span></div>
    <label htmlFor={`${id}-range`} className="admin-small">{t('admin.activity_select')}</label>
    <input id={`${id}-range`} className="activity-range" type="range" min="0" max={Math.max(0, buckets.length - 1)} value={Math.max(0, index)}
      aria-valuetext={selected ? `${time(selected.start)}–${time(selected.end)}: ${count(selected.count)}` : t('admin.no_data')}
      onChange={event => setSelection(Number(event.target.value))} />
    <p className="activity-value" aria-live="polite">{selected ? t(browser ? 'admin.activity_browser_bucket' : 'admin.activity_bucket', {
      start: time(selected.start), end: time(selected.end), count: count(selected.count),
    }) : t('admin.no_data')}</p>
    <details><summary>{t('admin.activity_table')}</summary><div className="activity-table" tabIndex={0} role="region" aria-label={title}>
      <table><thead><tr><th>{t('admin.activity_interval')}</th><th>{t(browser ? 'admin.activity_browsers' : 'admin.activity_connections')}</th></tr></thead>
        <tbody>{buckets.map((bucket, i) => <tr key={i}><td>{time(bucket.start)}–{time(bucket.end)}</td><td>{count(bucket.count)}</td></tr>)}</tbody>
      </table></div></details>
  </section>;
}

export function Activity({ data }: { data?: ActivitySummary }) {
  const [subject, setSubject] = useState('connections');
  const values = subject === 'browsers' ? data?.browsers : data;
  return <section className="activity-section" aria-labelledby="activity-title">
    <h2 id="activity-title">{t('admin.activity_title')}</h2>
    <p className="admin-small">{t('admin.activity_hint')}</p>
    <label htmlFor="activity-subject" className="admin-small">{t('admin.activity_subject')}</label>
    <select id="activity-subject" value={subject} onChange={event => setSubject(event.target.value)} className="activity-subject">
      <option value="connections">{t('admin.activity_connections')}</option><option value="browsers">{t('admin.activity_browsers')}</option>
    </select>
    {subject === 'browsers' && <p className="admin-small">{t('admin.activity_browser_hint')}</p>}
    {values ? <>
      <div className="activity-totals">
        <div className="admin-panel admin-stat"><span className="admin-stat-label">{t(subject === 'browsers' ? 'admin.activity_browser_now' : 'admin.activity_now')}</span><strong>{count(values.active)}</strong><p className="admin-small">{t('admin.activity_five_minutes')}</p></div>
        <div className="admin-panel admin-stat"><span className="admin-stat-label">{t(subject === 'browsers' ? 'admin.activity_browser_day' : 'admin.activity_day')}</span><strong>{count(values.last_24_hours)}</strong><p className="admin-small">{t(subject === 'browsers' ? 'admin.activity_browsers' : 'admin.activity_unique')}</p></div>
      </div>
      <div className="activity-charts"><Chart key={subject + '-recent'} title={t('admin.activity_recent')} buckets={values.recent} browser={subject === 'browsers'} /><Chart key={subject + '-hourly'} title={t('admin.activity_hourly')} buckets={values.hourly} browser={subject === 'browsers'} /></div>
    </> : <p role="status" className="admin-empty">{t('admin.no_data')}</p>}
  </section>;
}
