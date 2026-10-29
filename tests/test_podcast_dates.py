from pathlib import Path

import pytest

from backend.scrapers.podcasts import _date_iso, parse_podcast_series


@pytest.mark.parametrize('value,expected', [
    ('30. Sep 2026, 18:00', '2026-09-30T18:00:00+02:00'),
    ('15. Dezember 2026, 09:13', '2026-12-15T09:13:00+01:00'),
    ('3. März 2026', '2026-03-03T00:00:00+01:00'),
    ('2026-10-29T10:30:00Z', '2026-10-29T10:30:00+00:00'),
    ('unknown', None), ('31. Feb 2026', None), (None, None),
])
def test_recording_dates(value, expected):
    assert _date_iso(value) == expected


def test_upload_date_is_distinct_and_only_explicit():
    html = '''<section class="c-entity__container"><h3>Recording</h3>
      <div class="c-entity__main-details"><dl><dt>Datum</dt><dd>30. Sep 2026, 18:00</dd>
      <dt>Hochgeladen am</dt><dd>2. Okt 2026, 09:00</dd></dl></div></section>'''
    episode = parse_podcast_series(html, '60').episodes[0]
    assert episode.recorded_at == '2026-09-30T18:00:00+02:00'
    assert episode.uploaded_at == '2026-10-02T09:00:00+02:00'
    assert episode.uploaded_date == '2. Okt 2026, 09:00'
    assert parse_podcast_series(html.replace('Hochgeladen am', 'Created'), '60').episodes[0].uploaded_at is None


def test_real_pages_have_recording_dates_without_upload_dates():
    html = (Path(__file__).parent / 'fixtures/unibe/unibe_po_podcasts.html').read_text(encoding='utf-8')
    episodes = parse_podcast_series(html, '60').episodes
    assert episodes and all(ep.recorded_at for ep in episodes)
    assert all(ep.uploaded_at is None and ep.uploaded_date is None for ep in episodes)
