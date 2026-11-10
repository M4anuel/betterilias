import { cache } from './cache';
import type { ExerciseTab } from '../types';

type RememberedTab = 'assignments' | 'info' | 'submissions';

function key(courseId: string): string | null {
  const account = cache.getSessionId();
  return account && courseId
    ? `betterilias_exercise_tab_${encodeURIComponent(account)}_${encodeURIComponent(courseId)}` : null;
}

export function rememberedExerciseTab(courseId: string): RememberedTab {
  try {
    const storageKey = key(courseId);
    const tab = storageKey ? localStorage.getItem(storageKey) : null;
    return tab === 'info' || tab === 'submissions' ? tab : 'assignments';
  } catch { return 'assignments'; }
}

export function rememberExerciseTab(courseId: string, tab: ExerciseTab): void {
  if (tab !== 'assignments' && tab !== 'info' && tab !== 'submissions') return;
  try {
    const storageKey = key(courseId);
    if (storageKey) localStorage.setItem(storageKey, tab);
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
}
