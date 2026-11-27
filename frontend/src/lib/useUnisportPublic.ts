import { useEffect, useRef, useState } from 'react';
import { t, useLanguage } from './i18n';
import { unisportFetch } from './unisport';
import { fresh, readPublic, writePublic, type Snapshot } from './unisportCache';

/** Keep the last complete snapshot visible across a failed refresh. */
export function useUnisportPublic<T>(resource: string | null, credential: string, ttl: number, valid: (data: T) => boolean) {
  const locale = useLanguage();
  const key = resource ? resource + ':' + locale : '';
  const [snapshot, setSnapshot] = useState<{ key: string; data: Snapshot<T> }>();
  const [state, setState] = useState({ key: '', loading: true, error: '' });
  const current = useRef<AbortController | null>(null);
  const validator = useRef(valid);
  validator.current = valid;

  async function load(force = false) {
    current.current?.abort();
    if (!resource) return;
    const controller = new AbortController();
    current.current = controller;
    const active = () => !controller.signal.aborted;
    // Preserve existing IndexedDB keys across upgrades.
    const storageKey = resource === 'catalogue' ? 'catalogue:' + locale : 'offer:' + locale + ':' + resource.split('/')[1];
    setState({ key, loading: true, error: '' });
    let error = '';
    try {
      const cached = await readPublic<T>(storageKey);
      if (!active()) return;
      if (cached && validator.current(cached)) {
        setSnapshot({ key, data: cached });
        if (!force && fresh(cached, ttl)) return;
      }
      const data = await unisportFetch<Snapshot<T>>('/' + resource + (force ? '?refresh=true' : ''), credential, 'GET', undefined, controller.signal);
      if (!active()) return;
      if (!validator.current(data)) throw new Error(t('unisport.read_failed'));
      setSnapshot({ key, data });
      void writePublic(storageKey, data);
      if (data.stale) error = t('unisport.stale_warning');
    } catch (failure) {
      error = failure instanceof Error ? failure.message : t('unisport.read_failed');
    } finally {
      if (active()) setState({ key, loading: false, error });
    }
  }

  useEffect(() => {
    void load();
    return () => current.current?.abort();
  }, [key, credential]);

  return {
    data: snapshot?.key === key ? snapshot.data : null,
    loading: Boolean(key) && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
    refresh: () => void load(true),
  };
}
