import { useId, useState } from 'react';
import { getLocale, t } from '../lib/i18n';
import type { ActivityBucket, ActivitySummary } from './api';

function time(value: number) { return new Date(value * 1000).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }); }
function count(value: number) { return new Intl.NumberFormat(getLocale()).format(value); }

function Chart({ title, buckets }: { title: string; buckets: ActivityBucket[] }) {
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
    <p className="activity-value" aria-live="polite">{selected ? t('admin.activity_bucket', {
      start: time(selected.start), end: time(selected.end), count: count(selected.count),
    }) : t('admin.no_data')}</p>
    <details><summary>{t('admin.activity_table')}</summary><div className="activity-table" tabIndex={0} role="region" aria-label={title}>
      <table><thead><tr><th>{t('admin.activity_interval')}</th><th>{t('admin.activity_connections')}</th></tr></thead>
        <tbody>{buckets.map((bucket, i) => <tr key={i}><td>{time(bucket.start)}–{time(bucket.end)}</td><td>{count(bucket.count)}</td></tr>)}</tbody>
      </table></div></details>
  </section>;
}

export function Activity({ data }: { data?: ActivitySummary }) {
  return <section className="activity-section" aria-labelledby="activity-title">
    <h2 id="activity-title">{t('admin.activity_title')}</h2>
    <p className="admin-small">{t('admin.activity_hint')}</p>
    {data ? <>
      <div className="activity-totals">
        <div className="admin-panel admin-stat"><span className="admin-stat-label">{t('admin.activity_now')}</span><strong>{count(data.active)}</strong><p className="admin-small">{t('admin.activity_five_minutes')}</p></div>
        <div className="admin-panel admin-stat"><span className="admin-stat-label">{t('admin.activity_day')}</span><strong>{count(data.last_24_hours)}</strong><p className="admin-small">{t('admin.activity_unique')}</p></div>
      </div>
      <div className="activity-charts"><Chart title={t('admin.activity_recent')} buckets={data.recent} /><Chart title={t('admin.activity_hourly')} buckets={data.hourly} /></div>
    </> : <p role="status" className="admin-empty">{t('admin.no_data')}</p>}
  </section>;
}
