"""The creation gate (`config/creation.py`, learning step F — prompts/07-creation-gate.md).

Two halves, because the gate has two halves that can disagree:

1. **The table.** Five kinds of caller (anonymous / minor / ordinary / verified / staff) × the flag
   on and off × all four kinds. The rule is kind-independent today and the table says so by
   asserting all four kinds in every row rather than one and a comment — the first per-kind rule
   will then fail here, which is where it should fail.
2. **The four create paths and the menu's endpoint.** A rule module nothing asks is not a gate, and
   the exact failure the brief names is a word that never reaches the client: these prove
   `403 {"detail": "verification_required"}` arrives at `POST /api/courses/`, `/api/events/`,
   `/api/services/` and `/api/organizations/`, that `GET /api/creation/` says the same thing about
   the same account, and that turning the flag off restores the old behaviour at every one of them
   (a 201, not a different refusal).

`databases` is declared because the request-logging middleware writes to its own shards and a view
test that does not declare them fails on Django's cross-database guard rather than on anything
under test (`tasks/tests.py` and `config/test_nodes.py` carry the identical line).
"""

from datetime import timedelta

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from config.creation import CREATION_KINDS, FLAG_KEY, creation_block_reason, creation_status
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user


def set_gate(on: bool) -> None:
    """The flag is INVERTED: on = the restriction is on. `update_or_create` rather than `update`
    because a test must not depend on migration 0047 having run in the same database."""
    FeatureFlag.objects.update_or_create(key=FLAG_KEY, defaults={'is_enabled': on})


def make_minor(username: str):
    """`Profile.is_minor` is a stored flag, not something derived from a birth year — the only code
    path that sets it is `ChildrenView.post` (accounts/CLAUDE.md), so a test sets it directly."""
    user = make_user(username)
    user.profile.is_minor = True
    user.profile.save(update_fields=['is_minor'])
    return user


class CreationGateTableTests(TestCase):
    """The rule itself, with no HTTP in the way."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.ordinary = make_user('gate-ordinary')
        self.verified = make_user('gate-verified', is_verified_contributor=True)
        self.staff = make_user('gate-staff', is_staff=True)
        self.minor = make_minor('gate-minor')

    def assert_every_kind(self, user, expected):
        for kind in CREATION_KINDS:
            with self.subTest(kind=kind):
                self.assertEqual(creation_block_reason(user, kind), expected)

    # --- the flag ON (the seeded state, and production until USOS lands) -------------------------

    def test_a_signed_out_caller_is_anonymous_for_every_kind(self):
        """Both shapes a caller arrives as: DRF hands views an `AnonymousUser`, and the management
        modules (`config/nodes.py`) are routinely called with a plain `None`."""
        set_gate(True)
        self.assert_every_kind(AnonymousUser(), 'anonymous')
        self.assert_every_kind(None, 'anonymous')

    def test_an_ordinary_account_is_verification_required_for_every_kind(self):
        set_gate(True)
        self.assert_every_kind(self.ordinary, 'verification_required')

    def test_a_verified_contributor_passes_every_kind(self):
        set_gate(True)
        self.assert_every_kind(self.verified, None)

    def test_staff_pass_every_kind(self):
        """`feature_gate`'s own `is_staff` bypass, for the same reason: a moderator has to be able
        to found something to see what the restriction does before deciding to flip it."""
        set_gate(True)
        self.assert_every_kind(self.staff, None)

    def test_a_minor_is_minor_for_every_kind_and_not_verification_required(self):
        """The narrower, older rule answers first, so the sentence the person reads is the true
        one: being under 16 is not something a moderator can verify away."""
        set_gate(True)
        self.assert_every_kind(self.minor, 'minor')

    # --- the flag OFF (the day USOS lands) ------------------------------------------------------

    def test_with_the_flag_off_an_ordinary_account_passes_every_kind(self):
        set_gate(False)
        self.assert_every_kind(self.ordinary, None)

    def test_with_the_flag_off_verified_and_staff_still_pass(self):
        set_gate(False)
        self.assert_every_kind(self.verified, None)
        self.assert_every_kind(self.staff, None)

    def test_with_the_flag_off_a_signed_out_caller_is_still_anonymous(self):
        """The flag governs ONE of the three refusals. Turning it off is not a way in for somebody
        with no account at all."""
        set_gate(False)
        self.assert_every_kind(AnonymousUser(), 'anonymous')

    def test_with_the_flag_off_a_minor_is_still_refused(self):
        """GDPR Art. 8 does not answer to a FeatureFlag (`accounts/minors.py`)."""
        set_gate(False)
        self.assert_every_kind(self.minor, 'minor')

    # --- the two things that are easy to get wrong ----------------------------------------------

    def test_a_missing_flag_row_keeps_the_restriction_on(self):
        """`is_feature_enabled` fails OPEN, which for an INVERTED flag means the restriction holds
        when the row is somehow absent — the safe direction for an anti-abuse gate, and the same
        reversal `material_uploads_verified_only` documents in `coauthoring/services.py`."""
        FeatureFlag.objects.filter(key=FLAG_KEY).delete()
        self.assert_every_kind(self.ordinary, 'verification_required')

    def test_verification_is_read_off_the_profile_and_nothing_else(self):
        """`Profile.is_verified_contributor` is the ONLY signal (staff-set, never client-writable).
        Granting it mid-session changes the answer with no other state involved."""
        set_gate(True)
        self.assertEqual(creation_block_reason(self.ordinary, 'course'), 'verification_required')
        self.ordinary.profile.is_verified_contributor = True
        self.ordinary.profile.save(update_fields=['is_verified_contributor'])
        self.ordinary.refresh_from_db()
        self.assertIsNone(creation_block_reason(self.ordinary, 'course'))

    def test_creation_status_answers_every_kind_and_nothing_else(self):
        set_gate(True)
        self.assertEqual(
            creation_status(self.ordinary),
            {kind: 'verification_required' for kind in CREATION_KINDS},
        )
        set_gate(False)
        self.assertEqual(creation_status(self.ordinary), {kind: None for kind in CREATION_KINDS})

    def test_an_unknown_kind_is_a_programming_error_not_a_refusal(self):
        with self.assertRaises(AssertionError):
            creation_block_reason(self.ordinary, 'galaxy')


class CreationGateRequestTests(TestCase):
    """The word has to arrive. One create path per test, each proving the 403 and the restored 201.

    Payloads are the minimum each serializer accepts — this is about the gate, which runs before
    any of them is validated, and the 201 half only needs a body the app itself considers valid.
    """

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.ordinary = make_user('path-ordinary')
        self.staff = make_user('path-staff', is_staff=True)
        set_gate(True)

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def assert_refused(self, response):
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.data['detail'], 'verification_required')

    def event_payload(self):
        return {
            'title': 'Warsztat',
            'visibility': 'public',
            'starts_at': (timezone.now() + timedelta(days=5)).isoformat(),
            'duration_minutes': 90,
            'location_kind': 'onsite',
            'location_text': 'sala 12',
            'status': 'published',
        }

    # --- one per create path --------------------------------------------------------------------

    def test_founding_a_course_is_refused_with_the_word_and_restored_by_the_flag(self):
        client = self.as_(self.ordinary)
        self.assert_refused(client.post('/api/courses/', {'title': 'Kurs'}, format='json'))
        from courses.models import Course

        self.assertFalse(Course.objects.filter(title='Kurs').exists())

        set_gate(False)
        self.assertEqual(
            client.post('/api/courses/', {'title': 'Kurs'}, format='json').status_code, 201
        )

    def test_hosting_an_event_is_refused_with_the_word_and_restored_by_the_flag(self):
        client = self.as_(self.ordinary)
        self.assert_refused(client.post('/api/events/', self.event_payload(), format='json'))
        from events.models import Event

        self.assertFalse(Event.objects.filter(title='Warsztat').exists())

        set_gate(False)
        self.assertEqual(
            client.post('/api/events/', self.event_payload(), format='json').status_code, 201
        )

    def test_listing_tutoring_is_refused_with_the_word_and_restored_by_the_flag(self):
        client = self.as_(self.ordinary)
        self.assert_refused(client.post('/api/services/', {'title': 'Korepetycje'}, format='json'))
        from services.models import Service

        self.assertFalse(Service.objects.filter(title='Korepetycje').exists())

        set_gate(False)
        self.assertEqual(
            client.post('/api/services/', {'title': 'Korepetycje'}, format='json').status_code, 201
        )

    def test_founding_an_organisation_is_refused_with_the_word_and_restored_by_the_flag(self):
        client = self.as_(self.ordinary)
        self.assert_refused(client.post('/api/organizations/', {'name': 'Koło'}, format='json'))
        from organizations.models import Organization

        self.assertFalse(Organization.objects.filter(name='Koło').exists())

        set_gate(False)
        self.assertEqual(
            client.post('/api/organizations/', {'name': 'Koło'}, format='json').status_code, 201
        )

    # --- what the gate does NOT do --------------------------------------------------------------

    def test_staff_found_all_four_while_the_gate_is_on(self):
        client = self.as_(self.staff)
        self.assertEqual(client.post('/api/courses/', {'title': 'S'}, format='json').status_code, 201)
        self.assertEqual(
            client.post('/api/events/', self.event_payload(), format='json').status_code, 201
        )
        self.assertEqual(client.post('/api/services/', {'title': 'S'}, format='json').status_code, 201)
        self.assertEqual(
            client.post('/api/organizations/', {'name': 'S'}, format='json').status_code, 201
        )

    def test_a_minor_still_hears_the_older_word_at_every_path(self):
        """The per-app minors refusals stay (`events/views.py`, `services/views.py`,
        `organizations/access.py`); `courses` had none and now answers the same word from the rule
        module, which is the one behaviour this step deliberately widens (HISTORY §17BR.F)."""
        client = self.as_(make_minor('path-minor'))
        for url, payload in (
            ('/api/courses/', {'title': 'K'}),
            ('/api/events/', self.event_payload()),
            ('/api/services/', {'title': 'K'}),
            ('/api/organizations/', {'name': 'K'}),
        ):
            with self.subTest(url=url):
                response = client.post(url, payload, format='json')
                self.assertEqual(response.status_code, 403, response.content)
                self.assertEqual(response.data['detail'], 'minor')

    def test_reading_joining_and_enrolling_are_untouched(self):
        """The gate is asked on `create` only. A refused account must still be able to read the
        four surfaces and to enrol in somebody else's course — that is the whole reason the refusal
        can be this blunt."""
        from courses.models import Course

        course = Course.objects.create(
            instructor=self.staff,
            title='Open',
            visibility='public',
            status='open',
            enrollment_policy='open',
        )
        client = self.as_(self.ordinary)
        for url in ('/api/courses/', '/api/events/', '/api/services/', '/api/organizations/'):
            with self.subTest(url=url):
                self.assertEqual(client.get(url).status_code, 200)
        # 201 — `enrol` creates an `Enrollment` row, so it answers Created, not OK.
        self.assertEqual(client.post(f'/api/courses/{course.pk}/enrol/').status_code, 201)

    def test_an_anonymous_create_is_still_a_401_rather_than_this_refusal(self):
        """All four viewsets are `IsAuthenticatedOrReadOnly`, so DRF answers before the gate is
        reached. The `anonymous` word belongs to `GET /api/creation/`, which is `AllowAny`."""
        client = APIClient()
        self.assertEqual(client.post('/api/courses/', {'title': 'K'}, format='json').status_code, 401)
        self.assertEqual(
            client.post('/api/organizations/', {'name': 'K'}, format='json').status_code, 401
        )


class CreationStatusEndpointTests(TestCase):
    """`GET /api/creation/` — the Add… menu's side. It must answer exactly what the create paths
    would do, for the same account, or the menu shows a button the server refuses."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.ordinary = make_user('status-ordinary')
        self.verified = make_user('status-verified', is_verified_contributor=True)
        self.staff = make_user('status-staff', is_staff=True)
        set_gate(True)

    def get(self, user=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        response = client.get('/api/creation/')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_signed_out_reader_hears_anonymous_for_every_kind(self):
        self.assertEqual(self.get(), {kind: 'anonymous' for kind in CREATION_KINDS})

    def test_an_ordinary_account_hears_verification_required_for_every_kind(self):
        self.assertEqual(self.get(self.ordinary), {kind: 'verification_required' for kind in CREATION_KINDS})

    def test_a_verified_contributor_and_staff_hear_null_for_every_kind(self):
        self.assertEqual(self.get(self.verified), {kind: None for kind in CREATION_KINDS})
        self.assertEqual(self.get(self.staff), {kind: None for kind in CREATION_KINDS})

    def test_a_minor_hears_minor_for_every_kind(self):
        self.assertEqual(self.get(make_minor('status-minor')), {kind: 'minor' for kind in CREATION_KINDS})

    def test_turning_the_flag_off_opens_every_kind_for_an_ordinary_account(self):
        set_gate(False)
        self.assertEqual(self.get(self.ordinary), {kind: None for kind in CREATION_KINDS})

    def test_the_body_carries_exactly_the_five_kinds(self):
        """The frontend reads five fixed keys off this body; another kind is a frontend change too,
        so the shape is pinned here rather than inferred. `contest` became the fifth on
        2026-10-09 (CONTESTS-BRIEF.md §2): founding one promises a prize to strangers."""
        self.assertEqual(
            sorted(self.get(self.ordinary)), ['contest', 'course', 'event', 'organization', 'service']
        )
