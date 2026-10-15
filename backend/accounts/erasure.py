"""Deleting an account (GDPR Art. 17) — the ONE module that decides what happens to every row that
points at a person. The export (`accounts/export.py`, Art. 15 + 20) reads the same registry, so
"what we hold about you" and "what deleting you removes" cannot drift into two answers.

**The `User` row is not deleted. It becomes a tombstone.** Every other design was tried on paper and
broke on the schema as it is:

- A hard `user.delete()` cascades through ~70 `on_delete=CASCADE` foreign keys, and many of them are
  OTHER people's data: a private conversation (`postman.Message` cascades on both parties), every
  comment and the replies under it, a task with everybody's assignments, a course with its
  participants. `contests.Contest.organiser` is `PROTECT`, so the delete simply raises. Changing
  forty apps' `on_delete` is forty migrations, several of them in apps other branches are editing.
- One shared "deleted user" account that everything is re-pointed to collides with real unique
  constraints (one review per author per exercise, one ballot per poll, one note per lesson), so two
  erased people who reviewed the same exercise could not both be re-pointed.

So the row stays, scrubbed: `username='deleted-<pk>'`, no email, no names, an unusable password,
inactive, no staff bits, every profile field back to its default, the avatar file gone, and
`Profile.display_name = DELETED_LABEL`. Every byline in the app already falls back through
`display_name`, so every public contribution now reads "[deleted account]" — which `client.ts`
replaces with the reader's own language at the one fetch seam. What is LEFT pointing at the row is
only what the registry below decided to keep, each with its reason.

The honest limit of that: the tombstone keeps its numeric id, so a reader can still tell that two
anonymised contributions came from the SAME erased account. Nothing ties the id back to a person
once the row is scrubbed; the linkage between contributions is what is left. Named in `LEGAL.md` §5.

**The registry** has one entry per (model, field that points at a user). `test_erasure.py` walks
`apps.get_models()` and FAILS when a model gains a foreign key to the user model — or to `Profile` —
without an entry here, so a new app cannot quietly opt out of erasure (or of the export).

The actions, which the Settings page shows to the person before they confirm:

- `delete`   — private to the person: sessions, history, follows, drafts, schedules, roles.
- `anonymise`— a public contribution licensed to the community (terms § 9): stays, without the name.
- `keep`     — a record of something that happened that other people rely on (a moderation decision,
               a jury's score, a vote counted in a result, a booking the other side had): stays,
               without the name.
- `end`      — something still live with somebody on the other side: cancelled or left, and that
               somebody is told (a future booking, a seat at an upcoming event, a course enrolment).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

#: What every byline shows once an account is erased. Stored, because a dozen serializers read
#: `profile.display_name` directly; translated on the way in by `frontend/src/lib/api/client.ts`,
#: which swaps this exact string for the reader's language. `telemetry`'s `pseudonymise_actor` writes
#: the same words into the audit log's `actor_label`.
DELETED_LABEL = '[deleted account]'

#: The grace period: the account is switched off at once and erased this long after the request.
GRACE_PERIOD = timedelta(days=14)

DELETE = 'delete'
ANONYMISE = 'anonymise'
KEEP = 'keep'
END = 'end'
ACTIONS = (DELETE, ANONYMISE, KEEP, END)

#: The groups the Settings page names. Each is a message key on the frontend
#: (`account_what_<group>` + `account_why_<group>`), so this tuple and `en.json`/`pl.json` must
#: agree — `test_erasure.RegistryShapeTests` checks the backend half.
GROUPS = (
    'account', 'sign_in', 'notifications', 'history', 'follows', 'study', 'education', 'tutoring',
    'bookings', 'participation', 'roles', 'applications', 'submissions', 'contributions',
    'discussion', 'votes', 'hosted', 'records', 'reports', 'terms', 'messages', 'feed', 'mail',
    'request_log', 'audit',
)


@dataclass
class Context:
    user: object
    is_minor: bool
    now: object
    #: The person chose `remove` for their withdrawable (not openly licensed) published content.
    withdraw: bool = False


Split = Callable[[Context, object], dict]
Handler = Callable[[Context, object], None]


@dataclass(frozen=True)
class Rule:
    """What happens to the rows of `model` whose `field` (a lookup path ending at the user) is the
    person. `split` partitions those rows by action when one model needs more than one; `handlers`
    overrides what an action DOES (the default `delete` is a queryset delete, the default
    `anonymise`/`keep` touches nothing — the tombstone does the work). `scrub` blanks personal
    free-text columns on rows that stay. `export=False` only for rows that hold nothing about the
    person worth handing back (a sign-in token)."""

    model: str
    field: str
    action: str
    group: str
    split: Split | None = None
    handlers: dict = field(default_factory=dict)
    scrub: dict = field(default_factory=dict)
    export: bool = True
    export_exclude: tuple = ()

    def queryset(self, user):
        model = apps.get_model(self.model)
        return model._base_manager.filter(**{self.field: user})

    def partition(self, ctx: Context) -> dict:
        qs = self.queryset(ctx.user)
        if self.split is None:
            return {self.action: qs}
        return self.split(ctx, qs)


# ---- the splits and handlers the registry needs -------------------------------------------------

def _pending_vs_decided(ctx, qs):
    """A submission still waiting is withdrawn; a decided one is the record of a decision (house
    rule 12) and stays, without the name."""
    return {DELETE: qs.filter(status='pending'), KEEP: qs.exclude(status='pending')}


def _public_vs_private(ctx, qs):
    return {ANONYMISE: qs.filter(is_public=True), DELETE: qs.filter(is_public=False)}


def _decks(ctx, qs):
    """A deck placed on a course or an event is in somebody else's teaching; a private one is not."""
    shared = Q(is_public=True) | Q(placements__isnull=False)
    return {ANONYMISE: qs.filter(shared).distinct(), DELETE: qs.exclude(shared)}


def _minor_content(ctx, qs):
    """A child's comments and posts go with the account (what a guardian's delete always promised,
    `ChildDetailView`); an adult's stay, without the name. "Go" is a tombstone (`is_removed`), not a
    row delete, so the replies under a child's comment keep their thread."""
    if ctx.is_minor:
        return {DELETE: qs.filter(is_removed=False)}
    return {ANONYMISE: qs}


# ---- the one choice the person is asked: content that is not openly licensed ----------------------
#
# A Creative Commons licence cannot be revoked — whoever has a copy keeps the right to it — so openly
# licensed content always stays, under the tombstone. `edmat-only` granted only the operating licence
# of terms § 9 point 2, and `unknown` (an import, or staff's "rights in question") granted nothing the
# person declared; for those the person decides: keep them published, or remove them. "Remove" is a
# hide on the row (`published=False` / `is_removed=True`), never a row delete, so the comments, links
# and history hanging off it keep their target (house rule 12).
#
# Only what the person wrote ALONE is removable. A material another member revised, or a concept
# article with somebody else's revision in it, holds other people's work — it stays either way, and
# the person can still ask for it to be taken down by the ordinary route (terms § 9 point 6).
# Translations are not offered: a translation carries its exercise's licence and is part of somebody
# else's exercise; removing it would take a language away from another person's work.

WITHDRAWABLE_LICENCES = ('edmat-only', 'unknown')

#: model label → (licensing kind, author field, what "remove" writes, what "currently published" means)
WITHDRAW_TARGETS = {
    'exercises.Exercise': ('exercise', 'submitted_by', {'published': False}, {'published': True}),
    'exercises.SolutionEntry': ('solution_entry', 'author', {'is_removed': True}, {'is_removed': False}),
    'materials.Material': ('material', 'submitted_by', {'published': False}, {'published': True}),
    'concepts.ConceptArticle': ('concept_article', 'created_by', {'is_removed': True}, {'is_removed': False}),
}


def withdrawable(user) -> dict:
    """`{'removable': {label: [pk]}, 'shared': {label: [pk]}}` — the person's published content under
    a withdrawable licence, split by whether anybody else's work is in it."""
    from licensing.targets import kind_for

    out = {'removable': {}, 'shared': {}}
    for label, (kind_name, author_field, _hide, live) in WITHDRAW_TARGETS.items():
        model = apps.get_model(label)
        kind = kind_for(kind_name)
        qs = model._base_manager.filter(**{author_field: user, 'licence__in': WITHDRAWABLE_LICENCES, **live})
        for obj in qs:
            others = set(kind.contributors(obj)) - {user.pk} if kind else set()
            out['shared' if others else 'removable'].setdefault(label, []).append(obj.pk)
    return out


def withdrawable_counts(user) -> dict:
    w = withdrawable(user)
    return {k: sum(len(v) for v in w[k].values()) for k in ('removable', 'shared')}


def _licensed_split(label):
    def split(ctx, qs):
        if not ctx.withdraw:
            return {ANONYMISE: qs}
        ids = withdrawable(ctx.user)['removable'].get(label, [])
        return {DELETE: qs.filter(pk__in=ids), ANONYMISE: qs.exclude(pk__in=ids)}

    return split


def _licensed_hide(label):
    hide = WITHDRAW_TARGETS[label][2]

    def handler(ctx, qs):
        qs.update(**hide)

    return handler


def _licensed(label, field):
    return Rule(label, field, ANONYMISE, 'contributions', split=_licensed_split(label),
                handlers={DELETE: _licensed_hide(label)})


def _tombstone_content(ctx, qs):
    qs.update(is_removed=True)


def _future_bookings(ctx, qs):
    from booking.models import OPEN_STATUSES

    live = qs.filter(status__in=OPEN_STATUSES, starts_at__gt=ctx.now)
    return {END: live, KEEP: qs.exclude(pk__in=live.values('pk'))}


def _cancel_bookings(ctx, qs):
    from booking.services import notify_cancelled

    for booking in qs.select_related('service', 'tutor', 'student'):
        claimed = type(booking)._base_manager.filter(pk=booking.pk, status=booking.status).update(
            status='cancelled', cancelled_by=ctx.user
        )
        if claimed:
            booking.status = 'cancelled'
            notify_cancelled(booking, actor=ctx.user)


def _upcoming_attendance(ctx, qs):
    from events.models import SEAT_HOLDING_STATUSES

    live_statuses = set(SEAT_HOLDING_STATUSES) | {'pending', 'waitlisted'}
    upcoming = qs.filter(status__in=live_statuses).filter(
        Q(event__starts_at__isnull=True) | Q(event__starts_at__gt=ctx.now)
    )
    return {END: upcoming, KEEP: qs.exclude(pk__in=upcoming.values('pk'))}


def _withdraw_attendance(ctx, qs):
    """Through the events app's own `withdraw`, so a freed seat goes to the next in line."""
    from events.registration import withdraw

    for row in qs.select_related('event'):
        withdraw(row.event, ctx.user)


def _live_enrolments(ctx, qs):
    live = qs.filter(status__in=['active', 'pending'])
    return {END: live, KEEP: qs.exclude(pk__in=live.values('pk'))}


def _leave_courses(ctx, qs):
    qs.update(status='left')


def _future_shifts(ctx, qs):
    future = qs.filter(shift__starts_at__gt=ctx.now)
    return {DELETE: future, KEEP: qs.exclude(pk__in=future.values('pk'))}


def _contest_registrations(ctx, qs):
    """Before the contest starts a registration is withdrawn; after, it is part of a ranking and a
    jury's record, and stays — without the name, and never published under one again."""
    early = qs.filter(contest__status__in=['draft', 'announced', 'registration_open'])
    return {DELETE: early, KEEP: qs.exclude(pk__in=early.values('pk'))}


def _close_open_courses(ctx, qs):
    """A course with nobody in it (anything else is a blocker, below) stays as content, but closes to
    new participants — nobody is left to admit them."""
    qs.filter(status='open').update(status='finished')


def _cancel_empty_events(ctx, qs):
    """A published, upcoming event with nobody coming (anything else is a blocker) is cancelled — a
    cancelled event stays visible and says so, which is the events app's own rule for this."""
    qs.filter(status='published', starts_at__gt=ctx.now).update(status='cancelled')


def _deactivate_listings(ctx, qs):
    qs.update(is_active=False)


def _revoke(ctx, qs):
    qs.filter(revoked_at__isnull=True).update(revoked_at=ctx.now)


def _clear_m2m(ctx, qs):
    qs.delete()


# ---- the registry -------------------------------------------------------------------------------
#
# Grouped by app, in the order `apps.get_models()` meets them. Every direct FK to the user model (and
# to `accounts.Profile`) must appear; `test_erasure.RegistryCompletenessTests` enforces it.

R = Rule
REGISTRY: list[Rule] = [
    # Django's own
    R('admin.LogEntry', 'user', KEEP, 'audit'),
    R('auth.User_groups', 'user', DELETE, 'account', export=False),
    R('auth.User_user_permissions', 'user', DELETE, 'account', export=False),
    R('authtoken.Token', 'user', DELETE, 'sign_in', export=False),
    # taxonomy — a proposed discipline / branch / topic is part of the shared tree
    R('taxonomy.Discipline', 'proposed_by', ANONYMISE, 'contributions'),
    R('taxonomy.Branch', 'proposed_by', ANONYMISE, 'contributions'),
    R('taxonomy.Topic', 'proposed_by', ANONYMISE, 'contributions'),
    # exercises
    R('exercises.TagFollow', 'user', DELETE, 'follows'),
    # A tag somebody created while asking (WP16, 2026-10-15): the tag is everybody's once it exists;
    # who coined it is a contribution, anonymised like every other.
    R('exercises.Tag', 'created_by', ANONYMISE, 'contributions'),
    _licensed('exercises.Exercise', 'submitted_by'),
    R('exercises.ExerciseMaterialLink', 'added_by', ANONYMISE, 'contributions'),
    R('exercises.ExerciseTranslation', 'translated_by', ANONYMISE, 'contributions'),
    R('exercises.ExerciseTranslation', 'reviewed_by', KEEP, 'records'),
    _licensed('exercises.SolutionEntry', 'author'),
    R('exercises.SolutionEntry', 'reviewed_by', KEEP, 'records'),
    R('exercises.SolutionEntryVote', 'voter', KEEP, 'votes'),
    R('exercises.ExerciseRequirementVote', 'voter', KEEP, 'votes'),
    R('exercises.ExerciseClaim', 'proposed_by', ANONYMISE, 'contributions'),
    R('exercises.ExerciseClaimVote', 'voter', KEEP, 'votes'),
    R('exercises.ExerciseClaimImportanceVote', 'voter', KEEP, 'votes'),
    # materials
    R('materials.MaterialType', 'proposed_by', ANONYMISE, 'contributions'),
    _licensed('materials.Material', 'submitted_by'),
    R('materials.MaterialReview', 'author', ANONYMISE, 'discussion'),
    R('materials.MaterialRequirementVote', 'voter', KEEP, 'votes'),
    R('materials.MaterialView', 'user', DELETE, 'history'),
    R('materials.MaterialCoverage', 'proposed_by', ANONYMISE, 'contributions'),
    R('materials.MaterialCoverageVote', 'voter', KEEP, 'votes'),
    R('materials.MaterialCoverageImportanceVote', 'voter', KEEP, 'votes'),
    # community
    R('community.Review', 'author', ANONYMISE, 'discussion'),
    R('community.Comment', 'author', ANONYMISE, 'discussion', split=_minor_content,
      handlers={DELETE: _tombstone_content}, export_exclude=('anon_ip_hash',)),
    R('community.SavedComment', 'user', DELETE, 'follows'),
    R('community.CommentVote', 'voter', KEEP, 'votes'),
    R('community.CommentRevision', 'edited_by', ANONYMISE, 'discussion'),
    R('community.CommentRevision', 'hidden_by_moderator', KEEP, 'records'),
    R('community.CommentRevision', 'sealed_by', KEEP, 'records'),
    R('community.InlineImage', 'author', ANONYMISE, 'contributions'),
    R('community.DiscussionLocation', 'updated_by', KEEP, 'records'),
    # moderation
    R('moderation.ExerciseSubmission', 'submitted_by', KEEP, 'submissions', split=_pending_vs_decided),
    R('moderation.ExerciseSubmission', 'reviewed_by', KEEP, 'records'),
    R('moderation.EditSuggestion', 'submitted_by', KEEP, 'submissions', split=_pending_vs_decided),
    R('moderation.EditSuggestion', 'reviewed_by', KEEP, 'records'),
    R('moderation.Report', 'reported_by', KEEP, 'reports'),
    R('moderation.Report', 'resolved_by', KEEP, 'records'),
    R('moderation.ContentView', 'user', DELETE, 'history'),
    R('moderation.NodeGovernor', 'user', DELETE, 'roles'),
    R('moderation.NodeGovernor', 'granted_by', KEEP, 'records'),
    R('moderation.GovernorApplication', 'applicant', DELETE, 'applications'),
    R('moderation.GovernorApplication', 'decided_by', KEEP, 'records'),
    R('moderation.FeatureFlag', 'updated_by', KEEP, 'records'),
    # study
    R('study.ExerciseSet', 'owner', ANONYMISE, 'study', split=_public_vs_private),
    # accounts — `Profile` itself is scrubbed in place by `_scrub_profile`, never deleted
    R('accounts.Profile', 'user', KEEP, 'account', export=False),
    R('accounts.Guardianship', 'guardian', KEEP, 'account', handlers={KEEP: _revoke}),
    R('accounts.Guardianship', 'child', KEEP, 'account', handlers={KEEP: _revoke}),
    R('accounts.AccountErasure', 'user', KEEP, 'account'),
    R('accounts.AccountErasure', 'requested_by', KEEP, 'account', export=False),
    R('accounts.DonationLink', 'profile__user', DELETE, 'account'),
    R('accounts.ExperienceEntry', 'profile__user', DELETE, 'account'),
    R('accounts.SkillEntry', 'profile__user', DELETE, 'account'),
    R('accounts.Certificate', 'profile__user', DELETE, 'account'),
    # notifications
    R('notifications.Notification', 'recipient', DELETE, 'notifications'),
    R('notifications.Notification', 'actor', KEEP, 'records', export=False),
    # services (tutoring listings)
    R('services.Service', 'provider', KEEP, 'tutoring', handlers={KEEP: _deactivate_listings}),
    R('services.ServiceReview', 'author', ANONYMISE, 'discussion'),
    R('services.ServiceWatch', 'user', DELETE, 'follows'),
    # issues — a bug report stays (somebody may be fixing it); the reply-to address goes
    R('issues.Issue', 'reporter', KEEP, 'reports', scrub={'contact_email': ''}),
    R('issues.Issue', 'status_changed_by', KEEP, 'records'),
    # legal — a DSA notice is a record the law asks us to keep and answer (art. 16–17)
    R('legal.LegalNotice', 'reporter', KEEP, 'reports'),
    R('legal.LegalNotice', 'resolved_by', KEEP, 'records'),
    # The acceptance is the evidence of the licence the content that stays published rests on
    # (terms § 9); it holds a version and a date and nothing else about the person.
    R('legal.TermsAcceptance', 'user', KEEP, 'terms'),
    # pictures embedded in content
    R('chem.ChemDrawing', 'author', ANONYMISE, 'contributions'),
    R('sketches.Sketch', 'author', ANONYMISE, 'contributions'),
    R('galleries.GalleryImage', 'uploaded_by', ANONYMISE, 'contributions'),
    # identity — the education profile, its diplomas and grades
    R('identity.EducationProfile', 'user', DELETE, 'education'),
    R('identity.Diploma', 'profile__user', DELETE, 'education'),
    R('identity.CourseGrade', 'profile__user', DELETE, 'education'),
    # courses
    R('courses.Course', 'instructor', KEEP, 'hosted', handlers={KEEP: _close_open_courses}),
    R('courses.Enrollment', 'participant', KEEP, 'participation', split=_live_enrolments,
      handlers={END: _leave_courses}),
    R('courses.CourseStaff', 'user', DELETE, 'roles'),
    R('courses.CourseStaff', 'added_by', KEEP, 'records'),
    R('courses.CourseItem', 'submitted_by', ANONYMISE, 'contributions'),
    R('courses.CourseItem', 'decided_by', KEEP, 'records'),
    R('courses.CourseInvite', 'created_by', KEEP, 'records'),
    R('courses.CourseNote', 'author', DELETE, 'study'),
    R('courses.Attachment', 'uploaded_by', ANONYMISE, 'contributions'),
    R('courses.AttachmentReview', 'author', ANONYMISE, 'discussion'),
    R('courses.LessonReview', 'author', ANONYMISE, 'discussion'),
    R('courses.ChapterReview', 'author', ANONYMISE, 'discussion'),
    R('courses.LessonExerciseSet', 'linked_by', ANONYMISE, 'contributions'),
    R('courses.LessonProgress', 'participant', DELETE, 'study'),
    R('courses.CourseCompletion', 'participant', DELETE, 'education'),
    R('courses.CourseCompletion', 'issued_by', KEEP, 'records'),
    R('courses.CourseClaim', 'proposed_by', ANONYMISE, 'contributions'),
    R('courses.CourseClaimVote', 'voter', KEEP, 'votes'),
    R('courses.CourseClaimImportanceVote', 'voter', KEEP, 'votes'),
    # booking
    R('booking.AvailabilityRule', 'tutor', DELETE, 'tutoring'),
    R('booking.AvailabilityException', 'tutor', DELETE, 'tutoring'),
    R('booking.WeekTemplate', 'tutor', DELETE, 'tutoring'),
    R('booking.WeekSchedule', 'tutor', DELETE, 'tutoring'),
    R('booking.Booking', 'tutor', KEEP, 'bookings', split=_future_bookings, handlers={END: _cancel_bookings}),
    R('booking.Booking', 'student', KEEP, 'bookings', split=_future_bookings, handlers={END: _cancel_bookings}),
    R('booking.Booking', 'cancelled_by', KEEP, 'bookings', export=False),
    # activity — the feed forgets (house rule 9); a post is a contribution like a comment
    R('activity.ActivityEvent', 'actor', DELETE, 'feed'),
    R('activity.Post', 'author', ANONYMISE, 'discussion', split=_minor_content,
      handlers={DELETE: _tombstone_content}),
    # events
    R('events.Event', 'host', KEEP, 'hosted', handlers={KEEP: _cancel_empty_events}),
    R('events.EventPost', 'author', ANONYMISE, 'discussion'),
    R('events.EventAttendance', 'attendee', KEEP, 'participation', split=_upcoming_attendance,
      handlers={END: _withdraw_attendance}, scrub={'note': ''}),
    R('events.EventAttendance', 'registered_by', KEEP, 'records'),
    R('events.EventAttendance', 'checked_in_by', KEEP, 'records'),
    R('events.EventStaff', 'user', DELETE, 'roles'),
    R('events.EventStaff', 'added_by', KEEP, 'records'),
    # A programme entry is the organiser's record of a talk; the link to the account goes, the
    # entry stays. What it says about the person is the organiser's to change (privacy policy).
    R('events.SessionSpeaker', 'user', KEEP, 'participation', scrub={'user': None}),
    R('events.SessionBookmark', 'user', DELETE, 'follows'),
    R('events.Contribution', 'submitter', ANONYMISE, 'contributions'),
    R('events.Contribution', 'decided_by', KEEP, 'records'),
    R('events.ScanEvent', 'scanned_by', KEEP, 'records'),
    R('events.ExportLog', 'user', KEEP, 'records'),
    # co-authoring
    R('coauthoring.MaterialProject', 'created_by', ANONYMISE, 'contributions'),
    R('coauthoring.ProjectMember', 'user', DELETE, 'roles'),
    R('coauthoring.ProjectMember', 'added_by', KEEP, 'records'),
    R('coauthoring.ProjectInvite', 'created_by', KEEP, 'records'),
    R('coauthoring.ProjectJoinRequest', 'user', DELETE, 'applications'),
    R('coauthoring.ProjectJoinRequest', 'decided_by', KEEP, 'records'),
    R('coauthoring.MaterialVersion', 'created_by', ANONYMISE, 'contributions'),
    R('coauthoring.MaterialVersion', 'decided_by', KEEP, 'records'),
    R('materials_coop.CoopSettings', 'updated_by', KEEP, 'records'),
    # concepts
    R('concepts.Concept', 'created_by', ANONYMISE, 'contributions'),
    _licensed('concepts.ConceptArticle', 'created_by'),
    R('concepts.ConceptRevision', 'created_by', ANONYMISE, 'contributions'),
    R('concepts.ConceptRevision', 'reviewed_by', KEEP, 'records'),
    R('concepts.ConceptAsset', 'uploaded_by', ANONYMISE, 'contributions'),
    R('concepts.ConceptLink', 'added_by', ANONYMISE, 'contributions'),
    # the conference layer — door, desk and room records belong to the event
    R('cloakroom.CloakroomDesk', 'closed_by', KEEP, 'records'),
    R('cloakroom.CloakroomDesk', 'created_by', KEEP, 'records'),
    R('cloakroom.CloakroomItem', 'deposited_by', KEEP, 'records'),
    R('cloakroom.CloakroomItem', 'returned_by', KEEP, 'records'),
    R('cloakroom.CloakroomItem', 'exception_verified_by', KEEP, 'records'),
    R('venues.VenueStaff', 'user', DELETE, 'roles'),
    R('venues.VenueStaff', 'added_by', KEEP, 'records'),
    R('venues.RoomBooking', 'decided_by', KEEP, 'records'),
    R('venues.RoomBooking', 'requested_by', KEEP, 'records'),
    R('venues.ChecklistInstance', 'created_by', KEEP, 'records'),
    R('venues.ChecklistInstanceItem', 'done_by', KEEP, 'records'),
    R('venues.ChecklistInstanceItem', 'signed_off_by', KEEP, 'records'),
    R('documents.EventDocument', 'uploaded_by', KEEP, 'records'),
    R('documents.EventDocument', 'removed_by', KEEP, 'records'),
    R('documents.DocumentAcknowledgement', 'user', DELETE, 'participation'),
    R('shifts.Assignment', 'user', KEEP, 'participation', split=_future_shifts),
    R('shifts.Assignment', 'confirmed_by', KEEP, 'records'),
    R('shifts.Assignment', 'credited_by', KEEP, 'records'),
    R('shifts.VolunteerRecord', 'user', DELETE, 'participation'),
    R('shifts.VolunteerRecord', 'consent_recorded_by', KEEP, 'records'),
    # the management layer
    R('organizations.Organization', 'created_by', KEEP, 'hosted'),
    R('organizations.OrganizationMember', 'user', DELETE, 'roles'),
    R('organizations.OrganizationMember', 'added_by', KEEP, 'records'),
    R('organizations.OrganizationLink', 'added_by', ANONYMISE, 'contributions'),
    R('tasks.Task', 'created_by', ANONYMISE, 'hosted'),
    R('tasks.TaskAssignee', 'user', DELETE, 'roles'),
    R('tasks.TaskAssignee', 'assigned_by', KEEP, 'records'),
    R('needs.Need', 'created_by', ANONYMISE, 'hosted'),
    R('needs.NeedApplication', 'user', DELETE, 'applications'),
    R('needs.NeedApplication', 'decided_by', KEEP, 'records'),
    R('needs.VolunteeringOffer', 'volunteer', DELETE, 'applications'),
    R('plans.Plan', 'created_by', ANONYMISE, 'hosted'),
    R('plans.PlanStep', 'done_by', KEEP, 'records'),
    R('plans.PlanSuggestion', 'user', ANONYMISE, 'contributions'),
    R('plans.PlanSuggestion', 'decided_by', KEEP, 'records'),
    R('decisions.Poll', 'closed_by', KEEP, 'records'),
    R('decisions.Poll', 'created_by', ANONYMISE, 'hosted'),
    R('decisions.Ballot', 'user', KEEP, 'votes'),
    R('goals.Goal', 'created_by', ANONYMISE, 'hosted'),
    R('goals.Goal', 'met_by', KEEP, 'records'),
    R('goals.GoalCriterion', 'met_by', KEEP, 'records'),
    # flashcards
    R('flashcards.Deck', 'owner', ANONYMISE, 'study', split=_decks),
    R('flashcards.ReviewState', 'user', DELETE, 'study'),
    R('flashcards.ReviewLog', 'user', DELETE, 'study'),
    R('flashcards.DeckPlacement', 'added_by', KEEP, 'records'),
    # provenance — the "AI-assisted" mark
    R('provenance.AuthorMark', 'declared_by', ANONYMISE, 'contributions'),
    R('provenance.AssistanceVote', 'voter', KEEP, 'votes'),
    R('provenance.ScoreLock', 'locked_by', KEEP, 'records'),
    R('translations.TextVersion', 'written_by', ANONYMISE, 'contributions'),
    # licensing — who changed an item's licence is the evidence of under which licence it was
    # published, which is what the content that stays relies on (terms § 9)
    R('licensing.LicenceChange', 'changed_by', KEEP, 'records'),
    # attachments
    R('attachments.Attachment', 'removed_by', KEEP, 'records'),
    R('attachments.Attachment', 'uploaded_by', ANONYMISE, 'contributions'),
    R('attachments.Acknowledgement', 'user', DELETE, 'participation'),
    R('attachments.AttachmentReview', 'author', ANONYMISE, 'discussion'),
    # contests
    R('contests.Contest', 'organiser', KEEP, 'hosted'),
    R('contests.ContestStaff', 'user', DELETE, 'roles'),
    R('contests.ContestStaff', 'added_by', KEEP, 'records'),
    R('contests.ContestRegistration', 'user', KEEP, 'participation', split=_contest_registrations,
      scrub={'affiliation': '', 'guardian_name': '', 'publish_name': False, 'team_name': ''}),
    R('contests.ContestRegistration', 'decided_by', KEEP, 'records'),
    R('contests.ContestScore', 'juror', KEEP, 'records'),
    R('contests.ContestComplaint', 'answered_by', KEEP, 'records'),
    R('contests.ContestRulesVersion', 'published_by', KEEP, 'records'),
    # mail — the log of what was sent to the person, their confirmation, their digest choice
    R('mail.OutboundEmail', 'user', DELETE, 'mail'),
    R('mail.ConfirmedEmail', 'user', DELETE, 'sign_in'),
    R('mail.MailPreference', 'user', DELETE, 'notifications'),
    # sso — the links to Google / Apple / Microsoft / …, and any sign-in still in flight
    R('sso.SsoIdentity', 'user', DELETE, 'sign_in'),
    R('sso.SsoAttempt', 'user', DELETE, 'sign_in', export=False),
    R('sso.SsoLoginCode', 'user', DELETE, 'sign_in', export=False),
    # A pending "prove this account is yours to connect <Provider>" (sso/, confirm-and-link).
    R('sso.SsoLinkTicket', 'user', DELETE, 'sign_in', export=False),
    # private messages: the other party keeps the conversation — it is their record too. The
    # erased side's name goes with the tombstone; nobody can sign in as it to read them.
    R('postman.Message', 'sender', KEEP, 'messages'),
    R('postman.Message', 'recipient', KEEP, 'messages'),
    R('postman.Message', 'moderation_by', KEEP, 'records', export=False),
]

#: Models whose rows hang off the person through a non-FK column or another database. Not in the
#: completeness walk (it cannot see them), so listed by hand; the export and the preview read them.
SHARD_FIELDS = {
    'telemetry.RequestLog': 'user_id',
    'telemetry.AuditEvent': 'actor_id',
}


def rule_index() -> dict[tuple[str, str], Rule]:
    return {(r.model, r.field): r for r in REGISTRY}


# ---- who may ask, and what is in the way --------------------------------------------------------

def blockers(user) -> list[dict]:
    """Things the person runs that other people are still in. Erasing them now would leave those
    people with an owner nobody can reach, so the request is refused until each is handed over or
    closed (house rule 6: the refusal names them). Past and empty things are not blockers — they
    stay, without the name (the registry's `hosted` group)."""
    now = timezone.now()
    out: list[dict] = []

    from courses.models import Course, Enrollment

    for course in Course.objects.filter(instructor=user, status__in=['open', 'running']):
        if Enrollment.objects.filter(course=course, status__in=['active', 'pending']).exclude(participant=user).exists():
            out.append({'kind': 'course', 'id': course.pk, 'title': course.title, 'reason': 'course_has_participants'})

    from events.models import Event, EventAttendance

    upcoming = Event.objects.filter(host=user, status='published').filter(
        Q(starts_at__isnull=True) | Q(starts_at__gt=now)
    )
    for event in upcoming:
        if EventAttendance.objects.filter(event=event, status__in=['going', 'promoted', 'pending', 'waitlisted']).exclude(attendee=user).exists():
            out.append({'kind': 'event', 'id': event.pk, 'title': event.title, 'reason': 'event_has_attendees'})

    from contests.models import Contest

    for contest in Contest.objects.filter(organiser=user).exclude(status__in=['draft', 'closed', 'cancelled']):
        out.append({'kind': 'contest', 'id': contest.pk, 'title': contest.title, 'reason': 'contest_running'})

    from organizations.models import OrganizationMember

    for m in OrganizationMember.objects.filter(user=user, role='owner').select_related('organization'):
        org = m.organization
        other_owner = OrganizationMember.objects.filter(organization=org, role='owner').exclude(user=user).exists()
        others = OrganizationMember.objects.filter(organization=org).exclude(user=user).exists()
        if others and not other_owner:
            out.append({'kind': 'organization', 'id': org.pk, 'slug': org.slug, 'title': org.name, 'reason': 'sole_owner'})

    from coauthoring.models import ProjectMember

    for m in ProjectMember.objects.filter(user=user, role='owner').select_related('project'):
        if ProjectMember.objects.filter(project=m.project).exclude(user=user).exists():
            out.append({'kind': 'material_project', 'id': m.project_id, 'title': str(m.project), 'reason': 'sole_owner'})
    return out


def sole_guardian_children(user) -> list:
    """Children for whom this person is the only active guardian. Erasing the guardian erases them
    too (what `accounts.signals.cascade_children` always did on a hard delete), unless another
    guardian remains."""
    from .models import Guardianship

    out = []
    for g in Guardianship.objects.filter(guardian=user, revoked_at__isnull=True).select_related('child'):
        others = Guardianship.objects.filter(child=g.child, revoked_at__isnull=True).exclude(guardian=user)
        if not others.exists():
            out.append(g.child)
    return out


def live_request(user):
    from .models import AccountErasure

    return AccountErasure.objects.filter(user=user, status__in=['pending', 'erasing']).first()


def self_refusal(user) -> str | None:
    """Why this person may not ask for their own account to be deleted, or None.

    A child's account is opened and answered for by a guardian (GDPR Art. 8, `minors.py`), and the
    guardian deletes it from their own Settings → Children; the child's own request goes there. The
    child keeps the right of access — the export is not refused."""
    from .minors import is_minor

    if is_minor(user):
        return 'guardian_managed'
    if not user.has_usable_password():
        return 'password_required'
    return None


# ---- the preview ---------------------------------------------------------------------------------

def _context(user, withdraw: bool = False) -> Context:
    from .minors import is_minor

    return Context(user=user, is_minor=is_minor(user), now=timezone.now(), withdraw=withdraw)


def preview(user, *, withdraw: bool = False) -> list[dict]:
    """`[{group, action, count}]` — every non-empty (group, action) pair, from the registry. What
    the person reads before they confirm, and the same computation `erase` runs."""
    ctx = _context(user, withdraw)
    totals: dict[tuple[str, str], int] = {}
    for rule in REGISTRY:
        if rule.model in ('accounts.AccountErasure', 'accounts.Profile'):
            continue
        for action, qs in rule.partition(ctx).items():
            n = qs.count()
            if n:
                key = (rule.group, action)
                totals[key] = totals.get(key, 0) + n
    # The profile itself, and the two log tables that live in other databases.
    totals[('account', DELETE)] = totals.get(('account', DELETE), 0) + 1
    shard_counts = _shard_counts(user)
    if shard_counts['telemetry.RequestLog']:
        totals[('request_log', KEEP)] = shard_counts['telemetry.RequestLog']
    if shard_counts['telemetry.AuditEvent']:
        totals[('audit', KEEP)] = totals.get(('audit', KEEP), 0) + shard_counts['telemetry.AuditEvent']
    order = {g: i for i, g in enumerate(GROUPS)}
    return [
        {'group': g, 'action': a, 'count': n}
        for (g, a), n in sorted(totals.items(), key=lambda kv: (ACTIONS.index(kv[0][1]), order.get(kv[0][0], 99)))
    ]


def _shard_counts(user) -> dict:
    from telemetry.models import AuditEvent, RequestLog
    from telemetry.routers import shard_for_user

    shard = shard_for_user(user.pk)
    try:
        return {
            'telemetry.RequestLog': RequestLog.objects.using(shard).filter(user_id=user.pk).count(),
            'telemetry.AuditEvent': AuditEvent.objects.using(shard).filter(actor_id=user.pk).count(),
        }
    except Exception:  # noqa: BLE001 — a shard that is not there yet holds nothing about anybody
        return {'telemetry.RequestLog': 0, 'telemetry.AuditEvent': 0}


# ---- asking, cancelling --------------------------------------------------------------------------

class Refusal(Exception):
    def __init__(self, reason: str, *, status: int = 400, detail: dict | None = None):
        super().__init__(reason)
        self.reason = reason
        self.status = status
        self.detail = detail or {}


CONTENT_CHOICES = ('keep', 'remove')


def request_erasure(user, *, requested_by=None, withdrawable_content: str = 'keep'):
    """Switch the account off now and schedule its erasure for `GRACE_PERIOD` from now.

    Refusals (`Refusal.reason`): `already_pending` (409) and `blocked` (409, with the list). The
    re-authentication and the minor rule are the endpoint's (`erasure_views.py`), because a guardian
    asking for a child passes neither — the guardianship is their authority."""
    from rest_framework.authtoken.models import Token

    from .models import AccountErasure

    if live_request(user) is not None:
        raise Refusal('already_pending', status=409)
    found = blockers(user)
    if found:
        raise Refusal('blocked', status=409, detail={'blockers': found})
    by_guardian = requested_by is not None and requested_by.pk != user.pk
    try:
        erasure = AccountErasure.objects.create(
            user=user,
            requested_by=requested_by or user,
            by_guardian=by_guardian,
            withdrawable_content=withdrawable_content if withdrawable_content in CONTENT_CHOICES else 'keep',
            due_at=timezone.now() + GRACE_PERIOD,
        )
    except IntegrityError:
        raise Refusal('already_pending', status=409) from None
    # Off at once: `authenticate()` and TokenAuthentication both refuse an inactive account, so the
    # very next request from any device fails, and the public profile is withheld from now
    # (`UserPublicView.retrieve`: the name the bylines show, nothing else).
    type(user)._base_manager.filter(pk=user.pk).update(is_active=False)
    user.is_active = False
    Token.objects.filter(user=user).delete()
    _delete_sessions(user)
    if not by_guardian:
        _mail_cancel_link(user)
    return erasure


def cancel_erasure(user, *, by=None) -> bool:
    """Back to normal: the request is cancelled and the account is active again. Returns whether a
    pending request was there to cancel. One WHERE-anchored update, so a cancel can never land on a
    request `erase_due_accounts` has already claimed (`backend/CLAUDE.md`, SQLite rule 1)."""
    from .models import AccountErasure

    claimed = AccountErasure.objects.filter(user=user, status='pending').update(
        status='cancelled', cancelled_at=timezone.now()
    )
    if not claimed:
        return False
    type(user)._base_manager.filter(pk=user.pk).update(is_active=True)
    user.is_active = True
    return True


def cancel_refusal(user) -> str | None:
    """A child cannot undo what their guardian decided; everybody else can undo their own."""
    erasure = live_request(user)
    if erasure is None or erasure.status != 'pending':
        return 'nothing_pending'
    if erasure.by_guardian:
        return 'guardian_requested'
    return None


CANCEL_SALT = 'accounts.erasure-cancel'


def cancel_token(user) -> str | None:
    from django.core import signing

    erasure = live_request(user)
    if erasure is None:
        return None
    return signing.dumps({'u': user.pk, 'r': erasure.pk}, salt=CANCEL_SALT)


def user_for_cancel_token(token: str):
    """`(user, None)` or `(None, reason)` — 'invalid' | 'nothing_pending'."""
    from django.core import signing

    from .models import AccountErasure

    try:
        data = signing.loads(token or '', salt=CANCEL_SALT, max_age=int(GRACE_PERIOD.total_seconds()) + 86400)
    except signing.BadSignature:
        return None, 'invalid'
    erasure = AccountErasure.objects.filter(pk=data.get('r'), user_id=data.get('u')).select_related('user').first()
    if erasure is None:
        return None, 'invalid'
    if erasure.status != 'pending':
        return None, 'nothing_pending'
    return erasure.user, None


def _mail_cancel_link(user) -> None:
    """The safety net against a stolen session: whoever asked, the owner's inbox hears about it,
    with a link that cancels. Sent only to a CONFIRMED address — an unconfirmed one may not be
    theirs."""
    if not user.email:
        return
    from mail.services import is_confirmed, send_erasure_notice

    if is_confirmed(user):
        send_erasure_notice(user)


def _delete_sessions(user) -> None:
    from django.contrib.sessions.models import Session

    for s in Session.objects.filter(expire_date__gt=timezone.now()):
        try:
            if str(s.get_decoded().get('_auth_user_id')) == str(user.pk):
                s.delete()
        except Exception:  # noqa: BLE001 — an undecodable session is nobody's
            continue


# ---- the erasure itself --------------------------------------------------------------------------

def due_requests(now=None, *, ignore_grace: bool = False):
    from .models import AccountErasure

    qs = AccountErasure.objects.filter(status__in=['pending', 'erasing'])
    if not ignore_grace:
        qs = qs.filter(due_at__lte=now or timezone.now())
    return qs.select_related('user')


def claim(erasure) -> bool:
    """`pending` → `erasing`, once. A row already `erasing` (a run that died) is ours to finish."""
    from .models import AccountErasure

    if erasure.status == 'erasing':
        return True
    return bool(AccountErasure.objects.filter(pk=erasure.pk, status='pending').update(status='erasing'))


def erase(user) -> dict:
    """Carry out the registry for one account. Idempotent: every step either deletes what is still
    there, updates rows to a value they may already have, or scrubs fields to their defaults — so a
    second run (after a crash, or by hand) changes nothing that the first did not. Returns the
    per-(model, action) counts that `AccountErasure.summary` records.

    Deliberately NOT one `atomic()`: it touches forty apps, and a whole-run write lock is exactly
    what `backend/CLAUDE.md`'s SQLite rule 2 forbids. Idempotence is what makes a partial run safe."""
    from .models import AccountErasure

    live = AccountErasure.objects.filter(user=user, status__in=['pending', 'erasing']).first()
    ctx = _context(user, withdraw=bool(live and live.withdrawable_content == 'remove'))
    summary: dict[str, int] = {}

    # Children first, while the guardianship rows still say whose they are.
    for child in sole_guardian_children(user):
        if AccountErasure.objects.filter(user=child, status='done').exists():
            continue
        if not AccountErasure.objects.filter(user=child, status__in=['pending', 'erasing']).update(status='erasing'):
            AccountErasure.objects.create(
                user=child, requested_by=user, by_guardian=True, status='erasing', due_at=ctx.now,
                withdrawable_content='remove',
            )
        child_summary = erase(child)
        AccountErasure.objects.filter(user=child, status='erasing').update(
            status='done', completed_at=timezone.now(), summary=child_summary
        )
        summary['accounts.children'] = summary.get('accounts.children', 0) + 1

    for rule in REGISTRY:
        for action, qs in rule.partition(ctx).items():
            n = qs.count()
            if not n:
                continue
            handler = rule.handlers.get(action)
            if handler is not None:
                handler(ctx, qs)
            elif action == DELETE:
                qs.delete()
            if rule.scrub and action != DELETE:
                rule.queryset(user).update(**rule.scrub)
            key = f'{rule.model}.{rule.field}:{action}'
            summary[key] = summary.get(key, 0) + n

    _delete_sessions(user)
    _delete_unlinked(user)
    _scrub_profile(user)
    _scrub_user(user)

    from telemetry.management.commands.enforce_log_retention import pseudonymise_actor

    try:
        summary['telemetry.AuditEvent.actor_id:keep'] = pseudonymise_actor(user.pk)
    except Exception:  # noqa: BLE001 — a missing shard has nothing to pseudonymise
        pass
    return summary


def _delete_unlinked(user) -> None:
    """Rows that hold the person's address but no foreign key: mail sent to it before the account
    linked it, and a sign-up ticket still in flight. Read BEFORE `_scrub_user` blanks the address."""
    if not user.email:
        return
    from mail.models import OutboundEmail
    from sso.models import SsoSignupTicket

    OutboundEmail.objects.filter(to__iexact=user.email).delete()
    SsoSignupTicket.objects.filter(email__iexact=user.email).delete()


#: Profile fields that are not the person's: derived counters (house rule 5 — recounted, never
#: written by hand) and the row's own identity. Everything else goes back to its default.
_PROFILE_KEEP = {'id', 'user', 'joined_at'}


def _scrub_profile(user) -> None:
    from .models import Profile

    profile = Profile.objects.filter(user=user).first()
    if profile is None:
        profile = Profile.objects.create(user=user)
    if profile.avatar:
        profile.avatar.delete(save=False)
    for f in profile._meta.concrete_fields:
        if f.name in _PROFILE_KEEP or f.name.endswith('_count'):
            continue
        setattr(profile, f.attname, f.get_default())
    profile.display_name = DELETED_LABEL
    profile.show_profile_publicly = False
    profile.save()


def _scrub_user(user) -> None:
    User = get_user_model()
    user.username = f'deleted-{user.pk}'
    user.email = ''
    user.first_name = ''
    user.last_name = ''
    user.set_unusable_password()
    user.is_active = False
    user.is_staff = False
    user.is_superuser = False
    user.last_login = None
    User._base_manager.filter(pk=user.pk).update(
        username=user.username, email='', first_name='', last_name='', password=user.password,
        is_active=False, is_staff=False, is_superuser=False, last_login=None,
    )


def run_due(now=None, *, ignore_grace: bool = False, only_user_id: int | None = None, dry_run: bool = False) -> list[dict]:
    """What `manage.py erase_due_accounts` does: every request past its grace period, claimed and
    erased. `ignore_grace` is for tests and for an operator acting on a written request."""
    results = []
    qs = due_requests(now, ignore_grace=ignore_grace)
    if only_user_id is not None:
        qs = qs.filter(user_id=only_user_id)
    for erasure in qs:
        if dry_run:
            results.append({'user_id': erasure.user_id, 'erasure': erasure.pk, 'dry_run': True})
            continue
        if not claim(erasure):
            continue
        summary = erase(erasure.user)
        type(erasure).objects.filter(pk=erasure.pk).update(
            status='done', completed_at=timezone.now(), summary=summary
        )
        results.append({'user_id': erasure.user_id, 'erasure': erasure.pk, 'rows': sum(summary.values())})
    return results


def is_erased_or_pending(user) -> bool:
    from .models import AccountErasure

    return AccountErasure.objects.filter(user=user, status__in=['pending', 'erasing', 'done']).exists()


def grace_days() -> int:
    return GRACE_PERIOD.days


__all__ = [
    'DELETED_LABEL', 'GRACE_PERIOD', 'REGISTRY', 'SHARD_FIELDS', 'Refusal', 'blockers', 'cancel_erasure',
    'cancel_refusal', 'erase', 'preview', 'request_erasure', 'run_due', 'self_refusal',
]
