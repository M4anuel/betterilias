import { useSyncExternalStore } from 'react';
import { cache } from './cache';

function subscribe(update: () => void) {
  window.addEventListener('storage', update);
  window.addEventListener('betterilias-unisport-settings-changed', update);
  return () => {
    window.removeEventListener('storage', update);
    window.removeEventListener('betterilias-unisport-settings-changed', update);
  };
}

export function useUnisportAutoSignIn() {
  return useSyncExternalStore(subscribe, cache.getUnisportAutoSignInEnabled);
}
