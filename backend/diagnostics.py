"""Local retention job: python -m backend.diagnostics prune.

Schedule this under the backend OS account, including while the web server is
stopped. Never copies or exports diagnostics or raw pages.
"""
import argparse
import json
import sqlite3

from backend.observability import configure_logging, get_store, shutdown
from backend.scrapers.dumper import prune_failed_dumps
from backend.coordination import CoordinationBusy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prune',))
    parser.parse_args()
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
