const DEPTH = 'betteriliasDepth';

export function appHistoryDepth(): number | null {
  const depth = window.history.state?.[DEPTH];
  return Number.isSafeInteger(depth) && depth >= 0 ? depth : null;
}

export function pushAppHistory(state: object, unused: string, url: string) {
  window.history.pushState({ ...state, [DEPTH]: (appHistoryDepth() ?? 0) + 1 }, unused, url);
}

export function replaceAppHistory(state: object, unused: string, url: string) {
  window.history.replaceState({ ...state, [DEPTH]: 0 }, unused, url);
}
