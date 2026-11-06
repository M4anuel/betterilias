import { useEffect, useState } from 'react';
import { t, useLanguage } from '../lib/i18n';
import { browserStatisticsId, setBrowserStatistics } from '../lib/browserStatistics';

export function BrowserStatisticsSettings() {
  useLanguage();
  const [enabled, setEnabled] = useState(() => !!browserStatisticsId());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const update = () => setEnabled(!!browserStatisticsId());
    window.addEventListener('storage', update);
    window.addEventListener('betterilias-browser-statistics', update);
    const timer = window.setInterval(update, 60000);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('betterilias-browser-statistics', update);
      window.clearInterval(timer);
    };
  }, []);
  return <section className="space-y-3 border-t border-slate-100 py-4 dark:border-slate-800" aria-labelledby="browser-statistics-title">
    <h3 id="browser-statistics-title" className="text-sm font-bold">{t('statistics.title')}</h3>
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('statistics.disclosure')}</p>
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
      <input type="checkbox" checked={enabled} className="h-5 w-5 shrink-0 accent-[#0AACA5]" onChange={event => {
        const saved = setBrowserStatistics(event.target.checked);
        setFailed(!saved);
        setEnabled(!!browserStatisticsId());
      }} />
      <span>{t('statistics.enable')}</span>
    </label>
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('statistics.withdrawal')}</p>
    {failed && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('statistics.storage_error')}</p>}
  </section>;
}
