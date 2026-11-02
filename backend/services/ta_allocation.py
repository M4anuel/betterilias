import hashlib
import json
import re
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

# Marker protocol prefix
MARKER_PREFIX = "[BI:"
MARKER_SUFFIX = "]"
MAX_NOTICE_LENGTH = 200

class TAInfo(BaseModel):
    id: str  # stable slot id e.g. "ta1", "ta2"
    name: str  # human name e.g. "Ada", "TA 1"
    quota: int = 0
    assigned_count: int = 0

class AllocationItem(BaseModel):
    unit_id: str  # "team:<id>" or "user:<id>"
    member_id: str  # native member_id / participant_id used for form POST
    student_name: str
    team_id: Optional[str] = None
    submission_status: str
    submission_time: Optional[str] = None
    passed_status: Optional[str] = None
    mark: Optional[str] = None
    existing_notice: str = ""
    assigned_ta_id: Optional[str] = None
    assigned_ta_name: Optional[str] = None
    new_notice: Optional[str] = None
    exceeds_limit: bool = False

class AllocationPreviewResponse(BaseModel):
    exercise_ref_id: str
    ass_id: str
    total_units: int
    eligible_units: int
    unassigned_count: int
    assistants: List[TAInfo] = Field(default_factory=list)
    items: List[AllocationItem] = Field(default_factory=list)
    has_conflicts: bool = False
    conflict_count: int = 0
    fingerprint: str = ""

class ApplyAllocationRequest(BaseModel):
    exercise_ref_id: str
    ass_id: str
    fingerprint: str
    items: List[Dict[str, str]] = Field(default_factory=list)  # list of {"member_id": "...", "notice": "..."}

class ApplyAllocationResponse(BaseModel):
    success: bool
    updated_count: int
    failed_count: int
    message: str
    errors: List[str] = Field(default_factory=list)

def parse_ta_marker(notice: Optional[str]) -> Tuple[Optional[str], Optional[str], str]:
    """
    Parses notice text for [BI:slot_id|name|ver] marker.
    Returns (ta_id, ta_name, clean_human_notice).
    """
    if not notice:
        return None, None, ""

    # Match [BI:<slot_id>|<name>|...] or [BI:<slot_id>|<name>]
    match = re.search(r"\[BI:([^\|\]]+)\|([^\|\]]+)(?:\|[^\]]*)?\]", notice)
    if not match:
        return None, None, notice.strip()

    ta_id = match.group(1).strip()
    ta_name = match.group(2).strip()

    # Clean the notice by removing the marker and stripping
    clean_notice = (notice[:match.start()] + notice[match.end():]).strip()
    return ta_id, ta_name, clean_notice

def format_ta_marker(clean_notice: str, ta_id: str, ta_name: str) -> str:
    """
    Appends compact [BI:ta_id|ta_name] to the clean notice.
    """
    # Sanitize ta_id and ta_name to avoid delimiter issues
    clean_id = re.sub(r"[\|\]\[]", "", ta_id).strip()
    clean_name = re.sub(r"[\|\]\[]", "", ta_name).strip()
    marker = f"{MARKER_PREFIX}{clean_id}|{clean_name}{MARKER_SUFFIX}"

    if clean_notice:
        return f"{clean_notice} {marker}"
    return marker

def compute_distribution_fingerprint(unit_ids: List[str], current_notices: List[str]) -> str:
    """
    Generates a deterministic fingerprint based on unit IDs and current notices
    to prevent stale overwrites.
    """
    hasher = hashlib.sha256()
    for uid, note in zip(unit_ids, current_notices):
        hasher.update(uid.encode("utf-8"))
        hasher.update(b":")
        hasher.update(note.encode("utf-8"))
        hasher.update(b";")
    return hasher.hexdigest()[:16]

def distribute_units(
    eligible_items: List[AllocationItem],
    assistants: List[TAInfo],
    priority_order: List[str],
) -> List[AllocationItem]:
    """
    Distributes eligible items evenly among assistants using priority order for remainders.
    Contiguous block allocation preserving the incoming sort order.
    """
    M = len(eligible_items)
    N = len(assistants)
    if N == 0 or M == 0:
        return eligible_items

    # Map assistant id to object
    asst_map = {a.id: a for a in assistants}
    ordered_tas = [asst_map[pid] for pid in priority_order if pid in asst_map]
    # In case any assistants were missing from priority order
    for a in assistants:
        if a not in ordered_tas:
            ordered_tas.append(a)

    base_quota = M // N
    remainder = M % N

    quotas: Dict[str, int] = {}
    for idx, ta in enumerate(ordered_tas):
        q = base_quota + (1 if idx < remainder else 0)
        quotas[ta.id] = q
        ta.quota = q
        ta.assigned_count = q

    # Assign contiguous blocks in priority order
    current_idx = 0
    for ta in ordered_tas:
        q = quotas[ta.id]
        for _ in range(q):
            if current_idx < M:
                item = eligible_items[current_idx]
                item.assigned_ta_id = ta.id
                item.assigned_ta_name = ta.name
                current_idx += 1

    return eligible_items
