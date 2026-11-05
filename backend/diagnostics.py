"""Private log inspection and retention: python -m backend.diagnostics --help.

Schedule this under the backend OS account, including while the web server is
stopped. Never copies or exports diagnostics or raw pages.
"""
import argparse
import json
import sqlite3

from backend.observability import CATEGORIES, EVENTS, configure_logging, get_store, read_events, shutdown
from backend.config import settings
from backend.scrapers.dumper import prune_failed_dumps
from backend.coordination import CoordinationBusy


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('prune', help='Apply retention without exporting logs')
    events = commands.add_parser('events', help='Read retained events as JSON; newest first')
    events.add_argument('--category', choices=sorted(CATEGORIES))
    events.add_argument('--code', choices=sorted(EVENTS))
    events.add_argument('--limit', type=int, default=50)
    events.add_argument('--before', type=int)
    args = parser.parse_args(argv)
    if args.command == 'events':
        if not 1 <= args.limit <= 200:
            parser.error('limit must be between 1 and 200')
        if args.before is not None and not 1 <= args.before <= 9223372036854775807:
            parser.error('before must be a positive 64-bit cursor')
        try:
            rows = read_events(settings.observability_path / 'events.sqlite3',
                retention_seconds=settings.observability_retention_days * 86400,
                category=args.category, code=args.code, before=args.before, limit=args.limit)
            print(json.dumps({'events': rows,
                              'next_before': rows[-1]['id'] if len(rows) == args.limit else None}))
            return 0
        except (OSError, sqlite3.Error):
            print(json.dumps({'status': 'unavailable'}))
            return 1
    configure_logging()
    store = get_store()
    try:
        with store._connect() as db:
            store._prune(db)
        prune_failed_dumps(strict=True)
        print(json.dumps({'status': 'pruned'}))
    except (OSError, sqlite3.Error, CoordinationBusy):
        print(json.dumps({'status': 'unavailable'}))
        return 1
    finally:
        shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
