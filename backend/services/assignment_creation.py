"""Private receipts for retrying a create request without repeating its native POST.

The caller holds the exercise-write lock. Dispatched receipts do not expire:
losing the ability to reconcile an old request must never turn it into a new write.
"""
import hashlib
import json

from backend.config import settings
from backend.coordination import atomic_json
from backend.i18n import t


class AssignmentCreationUncertain(ValueError):
    def __init__(self):
        super().__init__(t('editor.creation_uncertain'))


def receipt_path(manager, exercise_id, operation_id):
    key = hashlib.sha256(json.dumps([manager.session_id, exercise_id, operation_id]).encode()).hexdigest()
    return settings.coordination_path / 'assignment-creations' / (key + '.json')


def fingerprint(data):
    payload = data.model_dump(mode='json', exclude={'operation_id'})
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def load(path):
    if not path.exists():
        return None
    # A corrupt receipt is not permission to dispatch the same operation again.
    try:
        result = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(result, dict) or result.get('state') not in ('dispatched', 'confirmed', 'rejected'):
            raise ValueError('Invalid receipt')
        return result
    except (ValueError, OSError) as exc:
        raise AssignmentCreationUncertain() from exc


def save(path, receipt):
    atomic_json(path, receipt)
