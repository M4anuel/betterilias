export interface PlayerPreferences {
  layout: 'inset' | 'split' | 'slides';
  swapped: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  audioHeight: number | null;
  slidesHeight: number | null;
  captions: boolean;
  captionLanguage: string | null;
}
export interface RecordingSort { field: 'title' | 'date'; direction: 'asc' | 'desc' }
const defaults: PlayerPreferences = { layout: 'inset', swapped: false, volume: 1, muted: false, rate: 1,
  audioHeight: null, slidesHeight: null, captions: false, captionLanguage: null };
const key = (scope: string | null) => `betterilias_player_preferences_${encodeURIComponent(scope || 'local')}`;

export function readPlayerPreferences(scope: string | null): PlayerPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key(scope)) || '{}');
    return {
      layout: ['inset', 'split', 'slides'].includes(value.layout) ? value.layout : defaults.layout,
      swapped: value.swapped === true,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : 1,
      muted: value.muted === true,
      rate: [.5, .75, 1, 1.25, 1.5, 1.75, 2].includes(value.rate) ? value.rate : 1,
      audioHeight: Number.isInteger(value.audioHeight) && value.audioHeight > 0 ? value.audioHeight : null,
      slidesHeight: Number.isInteger(value.slidesHeight) && value.slidesHeight > 0 ? value.slidesHeight : null,
      captions: value.captions === true,
      captionLanguage: typeof value.captionLanguage === 'string' ? value.captionLanguage : null,
    };
  } catch { return { ...defaults }; }
}

export function writePlayerPreferences(scope: string | null, value: PlayerPreferences) {
  try { localStorage.setItem(key(scope), JSON.stringify(value)); } catch { /* Storage is optional for playback. */ }
}

export function preferredRendition(sources: { height: number }[], height: number | null, fallback: number): number {
  if (height === null) return fallback;
  let best = 0;
  sources.forEach((source, index) => { if (source.height <= height) best = index; });
  return best;
}

export function readRecordingSort(scope: string | null): RecordingSort {
  try {
    const value = JSON.parse(localStorage.getItem(`${key(scope)}_recordings`) || '{}');
    return { field: value.field === 'title' ? 'title' : 'date', direction: value.direction === 'asc' ? 'asc' : 'desc' };
  } catch { return { field: 'date', direction: 'desc' }; }
}
export function writeRecordingSort(scope: string | null, value: RecordingSort) {
  try { localStorage.setItem(`${key(scope)}_recordings`, JSON.stringify(value)); } catch { /* Keep the active choice in memory. */ }
}
