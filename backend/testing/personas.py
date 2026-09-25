"""The conference personas and the sandbox event they live on (CONFERENCE-BRIEF.md §3.B).

Why personas rather than "log in as". The research report's §5 sets out the two patterns an
administrator has for seeing what somebody else sees: a **role preview**, where the viewer stays
themselves and the interface is narrowed, and **session impersonation**, where the server hands
the viewer a token belonging to a real person. EdMat builds only the first. The second is what
the 2018 Facebook "View As" breach was built out of — a read-only preview that turned out to
render one interactive widget, and that widget minted an access token for the person being viewed.
No token for anybody else is ever issued here, so there is nothing to mint and nothing to audit.

What replaces it is this: seven ordinary accounts on one ordinary event, each holding exactly one
role, so "what does a volunteer see" is answered by signing in as the volunteer. They are ordinary
in every respect — no `is_sandbox` flag on `Event`, no `PreviewUser` proxy, no impersonation
ledger (all three proposed by the report and all three rejected in the brief's §1). The only thing
that marks them is their `@edmat.example` addresses, which are a reserved domain that can never
receive mail.

`make_personas()` is called by `manage.py seed_conference_personas` and by
`events/test_permission_matrix.py`, which is the point: the matrix asserts the permissions of the
very accounts a person can then sign in as, so a row of the table and a click in the browser are
talking about the same thing.

Re-running updates rather than duplicates. Every account is keyed by username and every piece of
the event by (event, title), so a second run resets the passwords and the schedule and leaves one
of everything.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import Guardianship
from events.models import (
    Contribution,
    Event,
    EventStaff,
    RegistrationField,
    Session,
    Track,
)

User = get_user_model()

#: The default `--password`. One password for all seven on purpose: these are demonstration
#: accounts on a demonstration event, and seven different passwords would only ever be copied into
#: the same note anyway.
DEFAULT_PASSWORD = 'persona-pass-2026'

#: Every seeded event's title starts with this, and nothing else in the product does. A demo
#: conference and a real one sit in the same `events.Event` table and the same public list, and a
#: reader who has to work out which is which from the content has already been misled once. The
#: marker is deliberately ugly and deliberately not a translated string: it must survive a copied
#: link, a screenshot and a Polish interface unchanged. `conference_demo.py` imports it rather than
#: repeating the literal, and `test_conference_demo.py` asserts every seeded event carries it.
FAKE_PREFIX = 'TEST=FAKE '

#: The event's title is its key — `make_personas` finds it by (host, title), so the string is part
#: of the contract and not decoration. Prefixed, which means an installation seeded before
#: 2026-09-25 holds a row under the OLD title that this code can no longer find: reseeding leaves
#: the unprefixed one behind, so delete it by hand there. A database that has never been seeded
#: has nothing to strand.
SANDBOX_TITLE = FAKE_PREFIX + 'Sandbox conference'

#: username → (display name, event role in words). `persona.child` is absent: a minor is not made
#: here but through the guardian flow below, which is the only code path in this project that may
#: mark an account a minor's (`accounts/CLAUDE.md`).
PERSONA_USERNAMES = {
    'persona.organiser': 'Anna Organiser',
    'persona.reviewer': 'Paweł Reviewer',
    'persona.volunteer': 'Tomasz Volunteer',
    'persona.attendee': 'Kasia Attendee',
    'persona.guardian': 'Ewa Guardian',
    'persona.stranger': 'Marek Stranger',
}

#: Who may do what, as words. Printed by the seed command and asserted — endpoint by endpoint — by
#: `events/test_permission_matrix.py`. Keep the two in step: this table is the promise, that file
#: is the proof.
CAPABILITY_TABLE = [
    # (persona, may, may not)
    ('organiser', 'everything: edit the event, the programme, staff, registrations, decisions, the export',
     '—'),
    ('reviewer', 'read the staff list and the registrations; review and decide contributions',
     'edit the event or its programme; schedule an accepted proposal'),
    ('volunteer', 'read the staff list and the registrations; check people in',
     'decide a registration or a contribution; edit anything'),
    ('attendee', 'read the event, the programme and the roster; answer; propose a contribution',
     'see the staff list, the registrations or the export'),
    ('guardian', 'everything an attendee may, plus answering on behalf of their own child',
     'answer for anybody else’s child'),
    ('child (minor)', 'read the event and the programme; be registered by their guardian',
     'host an event; message anybody'),
    ('stranger', 'read a published, public event and its programme',
     'see a draft at all (404, not 403 — for them it does not exist)'),
]


def _account(username: str, display_name: str, password: str):
    """One persona. Created if missing, and its password reset on every run so `--password` means
    something the second time it is passed."""
    user, created = User.objects.get_or_create(
        username=username, defaults={'email': f'{username}@edmat.example'}
    )
    if not created and user.email != f'{username}@edmat.example':
        user.email = f'{username}@edmat.example'
    user.set_password(password)
    user.save()
    profile = user.profile  # accounts/signals.py makes one on first save
    if profile.display_name != display_name:
        profile.display_name = display_name
        profile.save(update_fields=['display_name'])
    return user


def _child(guardian, password: str):
    """A real minor, made the way `accounts.views.ChildrenView.post` makes one — a username and a
    password and NO email, `is_minor` set on the profile, the profile private, and a
    `Guardianship` row.

    Deliberately a faithful copy of that view's five lines rather than a call into it (it is a
    DRF view, not a service function), and deliberately not `Profile.is_minor = True` on a
    self-registered account: `accounts/CLAUDE.md` records that the guardian flow is the ONE path
    that marks an account a minor's, and the age-gate kill switch is only safe while that stays
    true. If `ChildrenView` ever grows a rule, this is the other place that needs it — said here
    because that is where the drift would otherwise be found.
    """
    child, _ = User.objects.get_or_create(username='persona.child', defaults={'email': ''})
    child.email = ''
    child.set_password(password)
    child.save()
    profile = child.profile
    profile.is_minor = True
    # A plain two-word name on purpose: the public roster masks a display name to "first name +
    # last initial" (`registration.mask_name`), and a name like "Antoni (12)" masks to "Antoni (." —
    # which is what the preview rendered until somebody looked at the screenshot. The age belongs in
    # the seed command's printed line, not in the name.
    profile.display_name = 'Antoni Nowak'
    profile.show_profile_publicly = False
    profile.save()
    # `update_or_create`, so a run after somebody demonstrated "revoke the guardianship" puts the
    # consent back rather than leaving a persona that can no longer answer for their own child.
    Guardianship.objects.update_or_create(guardian=guardian, child=child, defaults={'revoked_at': None})
    return child


def make_personas(password: str = DEFAULT_PASSWORD) -> dict:
    """Build (or refresh) the personas and the Sandbox conference. Returns a dict of the accounts
    plus `event`, `sessions`, `track`, `contribution` and `attendance` for a caller that wants to
    address them.

    The event's schedule is recomputed from *now* on every run — a sandbox whose conference
    happened last March demonstrates nothing, and an upcoming date is what makes the registration
    and check-in surfaces answer at all (`response_block_reason` refuses a past event).
    """
    people = {
        key.split('.')[1]: _account(key, name, password)
        for key, name in PERSONA_USERNAMES.items()
    }
    people['child'] = _child(people['guardian'], password)

    # `localtime` rather than `now()`, so the hour means 09:00 in `settings.TIME_ZONE` rather than
    # 09:00 UTC. Today those are the same thing (TIME_ZONE is 'UTC'), and the day that changes this
    # line is what keeps the sandbox starting in the morning. What it does NOT fix, and cannot: the
    # page draws the instant in the READER's browser timezone, so this conference reads 11:00 to a
    # browser in Warsaw. That is the standing "no per-account timezone" gap in the root CLAUDE.md,
    # noticed here by looking at the rendered page beside the command's own output.
    starts = (timezone.localtime(timezone.now()) + timedelta(days=14)).replace(
        hour=9, minute=0, second=0, microsecond=0
    )
    event, _ = Event.objects.get_or_create(
        host=people['organiser'],
        title=SANDBOX_TITLE,
        defaults={'status': 'published', 'visibility': 'public'},
    )
    event.summary = 'A conference that exists so the permissions can be looked at.'
    event.description = (
        'Every role in the events app has an account on this event. Sign in as one of them to see '
        'exactly what that role sees — nobody is ever signed in as anybody else.'
    )
    event.status = 'published'
    event.visibility = 'public'
    event.audience = 'university'
    event.language = 'pl'
    event.starts_at = starts
    # Multi-day, which is what makes it a conference rather than a talk: `runs_until` rather than a
    # long `duration_minutes`, so the second day's sessions have somewhere legal to sit.
    event.runs_until = starts + timedelta(days=1, hours=8)
    event.duration_minutes = 8 * 60
    event.location_kind = 'onsite'
    event.location_text = 'Aula, Banacha 2'
    event.capacity = 40
    event.registration_mode = 'form'
    event.show_attendees_publicly = True
    event.cfp_open = True
    event.cfp_deadline = starts - timedelta(days=3)
    event.full_clean()
    event.save()

    # Staff. The host already holds an `organiser` row (`Event.save()`), so only the other two are
    # created here; `update_or_create` rather than `get_or_create` so a second run puts a
    # hand-edited role back where the table says it is.
    EventStaff.objects.update_or_create(
        event=event, user=people['reviewer'], defaults={'role': 'reviewer', 'added_by': people['organiser']}
    )
    EventStaff.objects.update_or_create(
        event=event, user=people['volunteer'], defaults={'role': 'volunteer', 'added_by': people['organiser']}
    )

    track, _ = Track.objects.get_or_create(event=event, name='Room A', defaults={'colour': '#3b6ea5'})
    sessions = []
    for index, (title, kind, day, hour, duration) in enumerate(
        [
            ('Opening lecture', 'talk', 0, 10, 60),
            ('Exercises workshop', 'workshop', 0, 13, 90),
            ('Closing round table', 'other', 1, 11, 60),
        ]
    ):
        moment = (starts + timedelta(days=day)).replace(hour=hour)
        session, created = Session.objects.get_or_create(
            event=event, title=title, defaults={'starts_at': moment, 'kind': kind}
        )
        session.track = track
        session.kind = kind
        session.starts_at = moment
        session.duration_minutes = duration
        session.location_text = 'Room A'
        session.order = index
        # `capacity` on exactly one session, so the per-session seat rule has something to be
        # demonstrated on.
        session.capacity = 12 if kind == 'workshop' else 0
        session.full_clean()
        session.save()
        sessions.append(session)

    RegistrationField.objects.get_or_create(
        event=event, label='Affiliation', defaults={'kind': 'text', 'required': False, 'order': 0}
    )

    # The attendee holds a seat and has been through the door. Written directly rather than through
    # `registration.register()` on purpose: that function notifies, and a seed command re-run every
    # time somebody demonstrates the feature must not put a fresh bell on the organiser's account
    # for an answer nobody gave again.
    attendance, _ = event.attendances.get_or_create(
        attendee=people['attendee'], defaults={'status': 'going'}
    )
    attendance.status = 'going'
    attendance.answers = {'_attendance_mode': 'onsite', '_needs': ''}
    attendance.checked_in_at = attendance.checked_in_at or timezone.now()
    attendance.checked_in_by = people['organiser']
    attendance.save()

    # The guardian's child, registered by the guardian — `registered_by` is what makes a
    # primary-school attendee reachable at all (AUDIENCE-BRIEF.md §2).
    child_row, _ = event.attendances.get_or_create(
        attendee=people['child'],
        defaults={'status': 'going', 'registered_by': people['guardian']},
    )
    if child_row.registered_by_id is None:
        child_row.registered_by = people['guardian']
        child_row.save(update_fields=['registered_by'])

    # One proposal waiting for a decision, so the reviewer has something to review and the
    # volunteer has something to be refused.
    contribution, _ = Contribution.objects.get_or_create(
        event=event,
        submitter=people['attendee'],
        title='Fourier series in one lecture',
        defaults={
            'kind': 'talk',
            'abstract': 'What every second-year should know, in fifty minutes.',
            'audience': 'university',
            'status': 'submitted',
            'submitted_at': timezone.now(),
        },
    )
    if contribution.status == 'draft':
        contribution.status = 'submitted'
        contribution.submitted_at = timezone.now()
        contribution.save(update_fields=['status', 'submitted_at'])

    return {
        **people,
        'event': event,
        'track': track,
        'sessions': sessions,
        'attendance': attendance,
        'child_attendance': child_row,
        'contribution': contribution,
        'password': password,
    }
