"""The call for contributions (AUDIENCE-BRIEF.md §3.4): every state change goes through here,
and each one says who may make it. Single-screen triage — accept, reject with a reason, ask for
revisions, schedule — not a referee matrix."""

from django.utils import timezone

from notifications.services import notify

from .models import REASON_CODE_CHOICES, Contribution, Session, SessionSpeaker

REASON_CODES = {code for code, _ in REASON_CODE_CHOICES}


def call_is_open(event) -> bool:
    if not event.cfp_open:
        return False
    return event.cfp_deadline is None or event.cfp_deadline > timezone.now()


def _tell_submitter(c, actor, note=''):
    notify(c.submitter, 'contribution_decided', actor=actor, target_label=f'{c.title} — {c.event.title}',
           event=c.event, note=note or c.status)


def _tell_organisers(c, actor):
    for row in c.event.staff.select_related('user'):
        if row.role in ('organiser', 'reviewer') and row.user_id != actor.pk:
            notify(row.user, 'contribution_submitted', actor=actor, target_label=f'{c.title} — {c.event.title}', event=c.event)


def submit(c, actor):
    """draft → submitted (the author). Refused when the call is closed."""
    if c.status != 'draft':
        return 'not_draft'
    if not call_is_open(c.event):
        return 'call_closed'
    c.status = 'submitted'
    c.submitted_at = timezone.now()
    c.save()
    _tell_organisers(c, actor)
    return None


def unsubmit(c):
    """submitted → draft (the author, before anybody has started reviewing)."""
    if c.status != 'submitted':
        return 'not_submitted'
    c.status = 'draft'
    c.save()
    return None


def withdraw(c, actor):
    """Any non-final state → withdrawn (the author). A scheduled one vacates its slot: the session
    that was made for it is deleted, which is what marks the gap on the programme."""
    if c.status in ('withdrawn', 'rejected'):
        return 'already_final'
    if c.session_id:
        session = c.session
        c.session = None
        session.delete()
    c.status = 'withdrawn'
    c.save()
    return None


def start_review(c, actor):
    if c.status != 'submitted':
        return 'not_submitted'
    c.status = 'under_review'
    c.save()
    return None


def request_revisions(c, actor, note):
    """under_review → submitted, with a note: re-enables the author's editing."""
    if c.status != 'under_review':
        return 'not_under_review'
    if not note.strip():
        return 'note_required'
    c.status = 'submitted'
    c.review_note = note.strip()
    c.reason_code = 'needs_revision'
    c.decided_by = actor
    c.decided_at = timezone.now()
    c.save()
    _tell_submitter(c, actor, 'revisions')
    return None


def accept(c, actor, note=''):
    if c.status not in ('submitted', 'under_review'):
        return 'not_reviewable'
    c.status = 'accepted'
    c.review_note = note.strip()
    c.reason_code = ''
    c.decided_by = actor
    c.decided_at = timezone.now()
    c.save()
    _tell_submitter(c, actor, 'accepted')
    return None


def reject(c, actor, reason_code, note=''):
    """A rejection is never a bare "no": a reason code from the list, plus whatever the reviewer
    wants to say — the discipline every moderation queue here already holds itself to."""
    if c.status not in ('submitted', 'under_review'):
        return 'not_reviewable'
    if reason_code not in REASON_CODES:
        return 'reason_required'
    c.status = 'rejected'
    c.reason_code = reason_code
    c.review_note = note.strip()
    c.decided_by = actor
    c.decided_at = timezone.now()
    c.save()
    _tell_submitter(c, actor, 'rejected')
    return None


def schedule(c, actor, *, starts_at, duration_minutes=60, track=None, location_text='', online_url=''):
    """accepted → scheduled: a real Session on the programme, with the submitter as its speaker
    (and the co-authors as further speakers)."""
    if c.status != 'accepted':
        return 'not_accepted', None
    session = Session(
        event=c.event, track=track, kind=c.kind if c.kind in ('talk', 'workshop', 'poster') else 'other',
        title=c.title, abstract=c.abstract, starts_at=starts_at, duration_minutes=duration_minutes,
        location_text=location_text, online_url=online_url,
    )
    session.clean()
    session.save()
    profile = getattr(c.submitter, 'profile', None)
    SessionSpeaker.objects.create(
        session=session, user=c.submitter, order=0,
        name=(getattr(profile, 'display_name', '') or c.submitter.username),
    )
    for i, co in enumerate(c.co_authors or [], start=1):
        if isinstance(co, dict) and co.get('name'):
            SessionSpeaker.objects.create(session=session, name=co['name'][:120], affiliation=(co.get('affiliation') or '')[:200], order=i)
    c.session = session
    c.status = 'scheduled'
    c.save()
    _tell_submitter(c, actor, 'scheduled')
    return None, session


def unschedule(c, actor):
    """scheduled → accepted: the slot is released, the proposal stays in the pool."""
    if c.status != 'scheduled':
        return 'not_scheduled'
    if c.session_id:
        session = c.session
        c.session = None
        session.delete()
    c.status = 'accepted'
    c.save()
    return None
