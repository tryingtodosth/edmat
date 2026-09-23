"""A volunteer's own shifts as a calendar.

Deliberately built on `events/ics.py`'s own two helpers rather than a second hand-rolled writer:
the escaping rules, the CRLF line endings and the UTC stamps are the only parts of iCalendar that
matter here, they are already right there, and two implementations of an escaping rule is how one
of them starts getting a semicolon wrong. The private names are imported on purpose and this
comment is the notice that they are — if `events/ics.py` ever renames them, this file is the one
that has to move with it.
"""

from events.ics import _vevent, _wrap


def shifts_calendar(assignments, event) -> str:
    """One VEVENT per assignment. The summary names the station, because "Registration desk" is
    what the volunteer needs to read on a phone lock screen — the event's title is already the
    context they are standing in."""
    lines: list[str] = []
    for assignment in assignments:
        shift = assignment.shift
        station = shift.station
        lines += _vevent(
            f'shift-{assignment.pk}@edmat',
            shift.starts_at,
            shift.ends_at,
            f'{station.name} — {event.title}',
            station.briefing_note or shift.note,
            station.location_text or event.location_text,
            event.online_url,
        )
    return _wrap(lines)
