"""Parse native English/German interface text without translating lecturer content."""
import re
from datetime import date, timedelta
from typing import Optional

MONTH_MAP = {
    'jan': 1, 'januar': 1, 'january': 1, 'feb': 2, 'februar': 2, 'february': 2,
    'mär': 3, 'märz': 3, 'maer': 3, 'maerz': 3, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'mai': 5, 'may': 5, 'jun': 6, 'juni': 6, 'june': 6,
    'jul': 7, 'juli': 7, 'july': 7, 'aug': 8, 'august': 8,
    'sep': 9, 'sept': 9, 'september': 9, 'okt': 10, 'oktober': 10, 'oct': 10, 'october': 10,
    'nov': 11, 'november': 11, 'dez': 12, 'dezember': 12, 'dec': 12, 'december': 12,
}
DATE_TOKEN = r'(?:\d{1,2}\.\s*[^\W\d_]+\.?\s*\d{4}|\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})'
RELATIVE_DATE_TOKEN = r'\b(?:Today|Yesterday|Tomorrow|Heute|Gestern|Morgen)\b'
PREVIOUS_SESSIONS = r'(?:previous sessions|vergangene[nr]? sitzungen)'
SESSION_MATERIALS = r'(?:Session Materials|Materialien zur Sitzung|Sitzungsmaterialien)\s*:\s*(\d+)'


def label_key(text: str) -> str:
    return ' '.join(text.split()).strip().rstrip(':').strip().casefold()


def strip_page_prefix(text: str) -> str:
    return re.sub(r'^(?:(?:View|Ansicht|Content|Inhalt):\s*)+', '', text, flags=re.I)


def grade_status(value: str = '', label: str = '') -> Optional[str]:
    """Native option values win; failed must never match the positive suffix."""
    native = label_key(value).replace('_', '').replace(' ', '')
    if native in ('passed', 'failed'):
        return native
    if native == 'notgraded':
        return 'not_graded'
    text = re.sub(r'^status\s*:\s*', '', label_key(label))
    if text in ('failed', 'not passed', 'nicht bestanden', 'durchgefallen'):
        return 'failed'
    if text in ('not graded', 'nicht bewertet', 'noch nicht bewertet', 'unbenotet'):
        return 'not_graded'
    if text in ('passed', 'bestanden'):
        return 'passed'
    return None


def parse_native_date(text: str, reference_date: Optional[date] = None) -> Optional[date]:
    token = label_key(text)
    relative = {'today': 0, 'heute': 0, 'yesterday': -1, 'gestern': -1, 'tomorrow': 1, 'morgen': 1}
    if token in relative:
        return (reference_date or date.today()) + timedelta(days=relative[token])
    match = re.search(DATE_TOKEN, text)
    if not match:
        return None
    value = match.group()
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            return date.fromisoformat(value)
        numeric = re.fullmatch(r'(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})', value)
        if numeric:
            day, month, year = map(int, numeric.groups())
        else:
            parts = re.fullmatch(r'(\d{1,2})\.\s*([^\W\d_]+)\.?\s*(\d{4})', value)
            day, month_name, year = parts.groups()
            day, month, year = int(day), MONTH_MAP[month_name.casefold()], int(year)
        return date(year, month, day)
    except (ValueError, KeyError):
        return None
