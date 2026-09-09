"""iCalendar output for an event's programme and a person's own agenda (AUDIENCE-BRIEF.md §3.5).
Hand-rolled: two VEVENT shapes do not justify a dependency, and the format's own rules that matter
here are few — CRLF line endings, backslash-escaped commas/semicolons/newlines, UTC instants."""

from datetime import timezone as dt_timezone

from django.utils import timezone


def _esc(text: str) -> str:
    return (text or '').replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')


def _stamp(dt) -> str:
    return timezone.localtime(dt, dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def _vevent(uid: str, start, end, summary: str, description: str = '', location: str = '', url: str = '') -> list[str]:
    lines = [
        'BEGIN:VEVENT',
        f'UID:{uid}',
        f'DTSTAMP:{_stamp(timezone.now())}',
        f'DTSTART:{_stamp(start)}',
        f'DTEND:{_stamp(end)}',
        f'SUMMARY:{_esc(summary)}',
    ]
    if description:
        lines.append(f'DESCRIPTION:{_esc(description)}')
    if location:
        lines.append(f'LOCATION:{_esc(location)}')
    if url:
        lines.append(f'URL:{url}')
    lines.append('END:VEVENT')
    return lines


def _wrap(lines: list[str]) -> str:
    body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EdMat//events//EN', 'CALSCALE:GREGORIAN', *lines, 'END:VCALENDAR']
    return '\r\n'.join(body) + '\r\n'


def session_vevent(session, event=None) -> list[str]:
    event = event or session.event
    place = session.location_text or event.location_text
    url = session.online_url or event.online_url
    return _vevent(
        f'session-{session.pk}@edmat', session.starts_at, session.ends_at,
        f'{session.title} — {event.title}', session.abstract, place, url,
    )


def event_calendar(event, sessions) -> str:
    """The whole programme when there is one, else the event itself as a single block."""
    lines: list[str] = []
    if sessions:
        for s in sessions:
            lines += session_vevent(s, event)
    elif event.starts_at is not None:
        lines += _vevent(f'event-{event.pk}@edmat', event.starts_at, event.ends_at, event.title, event.summary or event.description, event.location_text, event.online_url)
    return _wrap(lines)


def agenda_calendar(sessions, events) -> str:
    lines: list[str] = []
    for s in sessions:
        lines += session_vevent(s)
    for e in events:
        if e.starts_at is not None:
            lines += _vevent(f'event-{e.pk}@edmat', e.starts_at, e.ends_at, e.title, e.summary or e.description, e.location_text, e.online_url)
    return _wrap(lines)
