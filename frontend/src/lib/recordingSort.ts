import { PodcastEpisode } from '../types';
import { RecordingSort } from './playerPreferences';

function dateValue(episode: PodcastEpisode): number | null {
  for (const value of [episode.uploaded_at, episode.recorded_at]) {
    const parsed = Date.parse(value || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  // Cached responses from before canonical date metadata was introduced.
  const match = episode.date?.match(/^(\d{1,2})\.\s*([\p{L}]+)\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/u);
  if (!match) return null;
  const months: Record<string, number> = { jan:0,january:0,januar:0,feb:1,february:1,februar:1,mar:2,march:2,'mär':2,'märz':2,maerz:2,
    apr:3,april:3,may:4,mai:4,jun:5,june:5,juni:5,jul:6,july:6,juli:6,aug:7,august:7,sep:8,sept:8,september:8,
    oct:9,october:9,okt:9,oktober:9,nov:10,november:10,dec:11,december:11,dez:11,dezember:11 };
  const month = months[match[2].toLowerCase()];
  return month === undefined ? null : Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
}

export function sortRecordings(episodes: PodcastEpisode[], sort: RecordingSort, locale: string): PodcastEpisode[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...episodes].sort((a, b) => {
    const byTitle = a.title.localeCompare(b.title, locale, { numeric: true });
    if (sort.field === 'title') return direction * byTitle || a.id.localeCompare(b.id);
    const first = dateValue(a), second = dateValue(b);
    if (first === null || second === null) return first === second ? byTitle || a.id.localeCompare(b.id) : first === null ? 1 : -1;
    return direction * (first - second) || byTitle || a.id.localeCompare(b.id);
  });
}
