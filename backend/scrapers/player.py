"""Parse the JSON argument of the native Paella initializer, never execute JS."""
import json
import math
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from backend.schemas import MediaChapter, MediaRendition, MediaStream, VideoStreamResponse
from backend.scrapers.dumper import safe_parser


def media_url(value):
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return value if parsed.scheme in {'http', 'https'} and parsed.hostname and not parsed.username and not parsed.password else None


@safe_parser(context_name='opencast_player')
def parse_player(html_content: str, video_url: str) -> VideoStreamResponse:
    soup = BeautifulSoup(html_content, 'lxml')
    config = None
    for script in soup.find_all('script'):
        text = script.get_text()
        for match in re.finditer(r'Opencast\.Paella\.player\.init\s*\(', text):
            try:
                candidate, _ = json.JSONDecoder().raw_decode(text[match.end():].lstrip())
            except (ValueError, TypeError):
                continue
            if isinstance(candidate, dict) and isinstance(candidate.get('streams'), list):
                config = candidate
                break
        if config is not None:
            break
    if config is None:
        raise ValueError('Unsupported or missing Paella configuration')
    streams = []
    for item in config['streams']:
        renditions = []
        for source in item.get('sources', {}).get('mp4', []):
            url = media_url(source.get('src'))
            if url:
                res = source.get('res') or {}
                renditions.append(MediaRendition(url=url, width=max(0, int(res.get('w', 0))),
                                                height=max(0, int(res.get('h', 0)))))
        if renditions:
            streams.append(MediaStream(content=item.get('content', 'video'), main_audio=item.get('role') == 'mainAudio',
                                       renditions=sorted(renditions, key=lambda source: source.height)))
    if not streams or (len(streams) > 1 and sum(stream.main_audio for stream in streams) != 1):
        raise ValueError('No playable MP4 streams or ambiguous main audio')
    if len(streams) == 1:
        streams[0].main_audio = True
    metadata = config.get('metadata') or {}
    duration = float(metadata.get('duration') or 0) / 1000
    duration = duration if math.isfinite(duration) and duration > 0 else None
    frames = {}
    for frame in config.get('frameList') or []:
        try:
            timestamp = float(frame.get('time'))
        except (TypeError, ValueError):
            continue
        image = media_url(frame.get('thumb')) or media_url(frame.get('url'))
        if image and math.isfinite(timestamp) and timestamp >= 0 and (duration is None or timestamp < duration):
            frames[timestamp] = MediaChapter(time=timestamp, image=image, text=frame.get('text') or '')
    audio = next(stream for stream in streams if stream.main_audio)
    return VideoStreamResponse(streams=streams, chapters=[frames[key] for key in sorted(frames)],
                               duration=duration, title=metadata.get('title'), preview_url=media_url(metadata.get('preview')),
                               mp4_url=audio.renditions[-1].url, video_url=video_url, fallback_url=video_url)
