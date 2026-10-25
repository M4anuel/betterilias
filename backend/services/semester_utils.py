import re
from datetime import datetime
from typing import List, Optional, Tuple


def parse_semester_id(sem_id: str) -> Optional[Tuple[str, int]]:
    """Parse semester code like 'HS2026' or 'FS2027' into (term, year)."""
    match = re.match(r"^(FS|HS)\s*(\d{4})$", sem_id.strip(), re.IGNORECASE)
    if not match:
        return None
    return match.group(1).upper(), int(match.group(2))


def get_current_semester(reference_date: Optional[datetime] = None) -> str:
    """
    Determine the current academic semester at Uni Bern based on calendar date.
    - Frühjahrssemester (FS): starts after the 2nd week of February (Feb 15) through September 14.
    - Herbstsemester (HS): starts after the 2nd week of September (Sep 15) through February 14 of following year.
    """
    if reference_date is None:
        reference_date = datetime.now()

    year = reference_date.year
    month = reference_date.month
    day = reference_date.day

    if (month == 2 and day >= 15) or (3 <= month <= 8) or (month == 9 and day < 15):
        return f"FS{year}"
    elif month == 1 or (month == 2 and day < 15):
        return f"HS{year - 1}"
    else:
        return f"HS{year}"


def get_next_semester(sem_id: str) -> str:
    """Return the semester immediately following the given semester."""
    parsed = parse_semester_id(sem_id)
    if not parsed:
        return sem_id
    term, year = parsed
    if term == "FS":
        return f"HS{year}"
    else:
        return f"FS{year + 1}"


def get_previous_semester(sem_id: str) -> str:
    """Return the semester immediately preceding the given semester."""
    parsed = parse_semester_id(sem_id)
    if not parsed:
        return sem_id
    term, year = parsed
    if term == "HS":
        return f"FS{year}"
    else:
        return f"HS{year - 1}"


def semester_order_key(sem_id: str) -> int:
    """Generate an integer for chronological comparison."""
    parsed = parse_semester_id(sem_id)
    if not parsed:
        return 0
    term, year = parsed
    return year * 2 + (1 if term == "HS" else 0)


def generate_semester_list(
    target_sem: Optional[str] = None,
    current_sem: Optional[str] = None,
    min_years_back: int = 5,
    preview_count: int = 1,
) -> List[str]:
    """
    Generate an ordered list of semester codes (descending from preview down to history).
    Ensures:
    1. The preview semester(s) are included.
    2. The current semester is included.
    3. At least `min_years_back` years (e.g. 10 semesters) are covered.
    4. If `target_sem` is older than min_years_back, the list extends down to `target_sem`.
    """
    if not current_sem:
        current_sem = get_current_semester()

    # Determine highest semester (preview)
    top_sem = current_sem
    for _ in range(preview_count):
        top_sem = get_next_semester(top_sem)

    if target_sem and semester_order_key(target_sem) > semester_order_key(top_sem):
        top_sem = target_sem

    # Determine lowest semester (at least min_years_back semesters)
    bot_sem = current_sem
    for _ in range(min_years_back * 2):
        bot_sem = get_previous_semester(bot_sem)

    if target_sem and semester_order_key(target_sem) < semester_order_key(bot_sem):
        bot_sem = target_sem

    # Generate descending list
    sem_list: List[str] = []
    curr = top_sem
    # Safety limit of 40 semesters (20 years)
    for _ in range(40):
        sem_list.append(curr)
        if curr == botSem if "botSem" in locals() else (curr == bot_sem):
            break
        curr = get_previous_semester(curr)

    if target_sem and target_sem not in sem_list:
        sem_list.insert(0, target_sem)

    return sem_list

