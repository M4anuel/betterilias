import { useEffect, useRef, useSyncExternalStore } from 'react';
import de from '../../../locales/de.json';
import en from '../../../locales/en.json';

export type ConnectionIssue = 'offline' | 'unavailable' | null;
let issue: ConnectionIssue = null;
const listeners = new Set<() => void>();
const failures = new Map<string, { issue: Exclude<ConnectionIssue, null>; retry?: () => Promise<unknown> }>();
export function reportConnection(next: ConnectionIssue, source: string, retry?: () => Promise<unknown>) {
  if (next) failures.set(source, { issue: next, retry });
  else failures.delete(source);
  const current = [...failures.values()];
  const nextIssue = current.some(value => value.issue === 'offline') ? 'offline' : current.length ? 'unavailable' : null;
  if (issue === nextIssue) return;
  issue = nextIssue;
  listeners.forEach(listener => listener());
}
export function useConnectionIssue() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => issue);
}
export const sharedFailure = (message: string) => [de, en].some(locale =>
  message === locale['connection.auth'] || message === locale['connection.failed']);
export const authFailure = (message: string) => [de, en].some(locale => message === locale['connection.auth']);

// Probe failed reads, then refresh mounted views. Never replay writes or reload drafts.
export async function retryConnection() {
  await Promise.allSettled([...failures.values()].map(failure => failure.retry?.()));
  window.dispatchEvent(new Event('betterilias-retry'));
}
export function useConnectionRetry(retry: () => void) {
  const current = useRef(retry);
  current.current = retry;
  useEffect(() => {
    const listener = () => current.current();
    window.addEventListener('betterilias-retry', listener);
    return () => window.removeEventListener('betterilias-retry', listener);
  }, []);
}
