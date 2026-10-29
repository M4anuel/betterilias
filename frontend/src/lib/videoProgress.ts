export interface VideoProgress {
  position: number;
  duration: number | null;
  updatedAt: number;
  lastStartedAt: number | null;
  completed: boolean;
}

// Use native identifiers, never routing tokens or expiring CDN URLs.
export function videoProgressKey(sourceUrl: string, sessionId: string | null): string | null {
  try {
    const params = new URL(sourceUrl, 'https://ilias.unibe.ch').searchParams;
    const episode = params.get('eid');
    const series = params.get('ref_id');
    if (!episode || !series) return null;
    return `betterilias_video_progress_${encodeURIComponent(sessionId || 'local')}_${encodeURIComponent(series)}_${encodeURIComponent(episode)}`;
  } catch { return null; }
}

export function readVideoProgress(sourceUrl: string, sessionId: string | null): VideoProgress | null {
  const key = videoProgressKey(sourceUrl, sessionId);
  if (!key) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || typeof saved.position !== 'number' || !Number.isFinite(saved.position) || saved.position < 0) return null;
    return {
      position: saved.position,
      duration: typeof saved.duration === 'number' && Number.isFinite(saved.duration) && saved.duration > 0 ? saved.duration : null,
      updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : 0,
      lastStartedAt: typeof saved.lastStartedAt === 'number' && Number.isFinite(saved.lastStartedAt) ? saved.lastStartedAt : null,
      completed: saved.completed === true,
    };
  } catch { return null; }
}

export function writeVideoProgress(sourceUrl: string, sessionId: string | null, value: VideoProgress) {
  const key = videoProgressKey(sourceUrl, sessionId);
  if (!key || !Number.isFinite(value.position) || value.position < 0) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Playback still works when storage is unavailable. */ }
}
