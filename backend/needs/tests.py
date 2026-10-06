"""Tests for `needs` (MANAGEMENT-BRIEF.md §3.C, §4 rule 14) — refusals first."""

from django.test import TestCase
from rest_framework.test import APIClient

from courses.models import Course
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Need, NeedApplication, VolunteeringOffer
from .rules import (
    ALREADY_APPLIED,
    ALREADY_DECIDED,
    FULL,
    MINOR,
    NOT_OPEN,
    OWN_NODE,
    apply_block_reason,
    can_manage,
    decide_block_reason,
    node_needs,
    public_needs,
    recount,
)


def _course(instructor, *, visibility='public', title='Analiza I'):
    # `Course.save()` creates the owner `CourseStaff` row itself (courses/CLAUDE.md) — creating one
    # by hand here would double it and trip the partial-unique-owner index.
    return Course.objects.create(
        instructor=instructor, title=title, visibility=visibility, status='open',
        enrollment_policy='open',
    )


class NeedsBaseTestCase(TestCase):
    # The request-logging middleware writes to its own shards; a view test that does not declare
    # them fails on Django's cross-database guard rather than on anything under test, so the line
    # lives here once and every class in this file inherits it.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        FeatureFlag.objects.update_or_create(key='needs', defaults={'is_enabled': True})
        self.manager = make_user('manager')
        self.stranger = make_user('stranger')
        self.applicant = make_user('applicant')
        self.course = _course(self.manager)
        self.client = APIClient()


class RulesTests(NeedsBaseTestCase):
    def _make_need(self, **kwargs):
        from django.contrib.contenttypes.models import ContentType

        ct = ContentType.objects.get_for_model(Course)
        defaults = dict(
            content_type=ct, object_id=self.course.pk, title='Help with grading',
            created_by=self.manager,
        )
        defaults.update(kwargs)
        return Need.objects.create(**defaults)

    def test_public_needs_shows_open_needs_on_visible_nodes(self):
        need = self._make_need()
        self.assertIn(need, public_needs(self.stranger))
        self.assertIn(need, public_needs(None))

    def test_public_needs_hides_non_open_needs_from_non_staff(self):
        need = self._make_need(status='in_progress')
        self.assertNotIn(need, public_needs(self.stranger))
        self.assertIn(need, public_needs(self.manager))

    def test_node_needs_narrows_to_open_for_non_staff(self):
        open_need = self._make_need(title='Open one')
        hidden_need = self._make_need(title='Hidden one', status='cancelled')
        rows = list(node_needs(self.stranger, self.course))
        self.assertIn(open_need, rows)
        self.assertNotIn(hidden_need, rows)
        rows_for_manager = list(node_needs(self.manager, self.course))
        self.assertIn(hidden_need, rows_for_manager)

    def test_can_manage_is_the_node_manager_only(self):
        need = self._make_need()
        self.assertTrue(can_manage(self.manager, need))
        self.assertFalse(can_manage(self.stranger, need))
        self.assertFalse(can_manage(self.applicant, need))

    def test_apply_block_reason_not_open(self):
        need = self._make_need(status='cancelled')
        self.assertEqual(apply_block_reason(self.applicant, need), NOT_OPEN)

    def test_apply_block_reason_own_node(self):
        need = self._make_need()
        self.assertEqual(apply_block_reason(self.manager, need), OWN_NODE)

    def test_apply_block_reason_minor(self):
        need = self._make_need()
        minor = make_user('kid')
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])
        self.assertEqual(apply_block_reason(minor, need), MINOR)

    def test_apply_block_reason_already_applied(self):
        need = self._make_need()
        NeedApplication.objects.create(need=need, user=self.applicant)
        self.assertEqual(apply_block_reason(self.applicant, need), ALREADY_APPLIED)

    def test_apply_block_reason_full(self):
        need = self._make_need(wanted_count=1)
        accepted_user = make_user('accepted')
        NeedApplication.objects.create(need=need, user=accepted_user, status='accepted')
        self.assertEqual(apply_block_reason(self.applicant, need), FULL)

    def test_apply_block_reason_none_when_open(self):
        need = self._make_need()
        self.assertIsNone(apply_block_reason(self.applicant, need))

    def test_decide_block_reason(self):
        need = self._make_need()
        application = NeedApplication.objects.create(need=need, user=self.applicant)
        self.assertIsNone(decide_block_reason(application))
        application.status = 'accepted'
        self.assertEqual(decide_block_reason(application), ALREADY_DECIDED)

    def test_recount_marks_fulfilled_and_never_touches_cancelled(self):
        need = self._make_need(wanted_count=1)
        NeedApplication.objects.create(need=need, user=self.applicant, status='accepted')
        recount(need)
        need.refresh_from_db()
        self.assertEqual(need.status, 'fulfilled')

        cancelled = self._make_need(wanted_count=1, status='cancelled')
        NeedApplication.objects.create(need=cancelled, user=self.applicant, status='accepted')
        recount(cancelled)
        cancelled.refresh_from_db()
        self.assertEqual(cancelled.status, 'cancelled')

    def test_recount_reopens_when_an_accepted_applicant_leaves(self):
        need = self._make_need(wanted_count=1, status='fulfilled')
        application = NeedApplication.objects.create(need=need, user=self.applicant, status='accepted')
        application.status = 'withdrawn'
        application.save(update_fields=['status'])
        recount(need)
        need.refresh_from_db()
        self.assertEqual(need.status, 'open')


class ApiTests(NeedsBaseTestCase):
    def setUp(self):
        super().setUp()
        from django.contrib.contenttypes.models import ContentType

        self.ct = ContentType.objects.get_for_model(Course)

    def _need(self, **kwargs):
        defaults = dict(
            content_type=self.ct, object_id=self.course.pk, title='Help with grading',
            created_by=self.manager,
        )
        defaults.update(kwargs)
        return Need.objects.create(**defaults)

    def test_feature_flag_off_blocks_non_staff(self):
        FeatureFlag.objects.filter(key='needs').update(is_enabled=False)
        self.client.force_authenticate(self.stranger)
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 403)

    def test_feature_flag_off_does_not_block_staff(self):
        FeatureFlag.objects.filter(key='needs').update(is_enabled=False)
        staff = make_user('staffer', is_staff=True)
        self.client.force_authenticate(staff)
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 200)

    def test_board_lists_open_needs(self):
        self._need()
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertIn('node', response.data[0])
        self.assertEqual(response.data[0]['node']['kind'], 'course')

    def test_board_filters_by_kind_and_remote(self):
        self._need(kind='equipment', title='A laptop', is_remote=True)
        self._need(kind='help', title='Grading', is_remote=False)
        response = self.client.get('/api/needs/?kind=equipment')
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['title'], 'A laptop')
        response = self.client.get('/api/needs/?remote=1')
        self.assertEqual(len(response.data), 1)
        self.assertTrue(response.data[0]['isRemote'] if 'isRemote' in response.data[0] else response.data[0]['is_remote'])

    def test_stranger_cannot_see_a_needs_detail_404(self):
        # A course a stranger genuinely cannot view (members-only) makes the need itself invisible.
        private_course = Course.objects.create(
            instructor=self.manager, title='Private', visibility='only_you', status='open',
            enrollment_policy='open',
        )
        need = Need.objects.create(
            content_type=self.ct, object_id=private_course.pk, title='Secret', created_by=self.manager
        )
        self.client.force_authenticate(self.stranger)
        response = self.client.get(f'/api/needs/{need.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_node_nested_create_requires_manager(self):
        self.client.force_authenticate(self.stranger)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/', {'title': 'X', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_manager')

    def test_node_nested_create_by_manager(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/',
            {'title': 'Grading help', 'kind': 'help', 'wanted_count': 2},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'open')
        self.assertEqual(Need.objects.count(), 1)

    def test_cannot_create_directly_fulfilled(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/',
            {'title': 'X', 'kind': 'help', 'status': 'fulfilled'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_apply_and_accept_flow(self):
        need = self._need(wanted_count=1)
        self.client.force_authenticate(self.applicant)
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {'message': 'I can help!'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        application_id = response.data['id']

        # A second application from the same person is refused, not a second row.
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], ALREADY_APPLIED)

        # The manager decides.
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/need-applications/{application_id}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'accepted')

        need.refresh_from_db()
        self.assertEqual(need.status, 'fulfilled')

        # Deciding again is refused — the world already moved.
        response = self.client.post(
            f'/api/need-applications/{application_id}/decide/', {'decision': 'decline'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], ALREADY_DECIDED)

    def test_stranger_cannot_decide(self):
        need = self._need()
        application = NeedApplication.objects.create(need=need, user=self.applicant)
        self.client.force_authenticate(self.stranger)
        response = self.client.post(
            f'/api/need-applications/{application.pk}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    def test_applications_queue_is_manager_only(self):
        need = self._need()
        NeedApplication.objects.create(need=need, user=self.applicant)
        self.client.force_authenticate(self.stranger)
        response = self.client.get(f'/api/needs/{need.pk}/applications/')
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.manager)
        response = self.client.get(f'/api/needs/{need.pk}/applications/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_withdraw(self):
        need = self._need()
        self.client.force_authenticate(self.applicant)
        self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        response = self.client.post(f'/api/needs/{need.pk}/withdraw/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'withdrawn')

        response = self.client.post(f'/api/needs/{need.pk}/withdraw/')
        self.assertEqual(response.status_code, 409)

    def test_manager_cannot_apply_to_own_need(self):
        need = self._need()
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], OWN_NODE)

    def test_only_manager_can_put_either(self):
        """The same rule through the other verb.

        `NeedViewSet` takes `UpdateModelMixin`, which binds BOTH `PUT → update` and
        `PATCH → partial_update`; only the second was overridden, so `PUT` ran DRF's own `update`,
        which asks `get_queryset()` (= `public_needs`, *visibility*) and no authority question at
        all. Any signed-in reader of an open posting could rewrite it. Found by
        `events/test_permission_matrix.py` when the management rows landed (§17BI.H).
        """
        need = self._need()
        self.client.force_authenticate(self.stranger)
        response = self.client.put(
            f'/api/needs/{need.pk}/', {'title': 'Mine now', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_manager')
        need.refresh_from_db()
        self.assertEqual(need.title, 'Help with grading')

        self.client.force_authenticate(self.manager)
        response = self.client.put(
            f'/api/needs/{need.pk}/', {'title': 'Renamed', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Renamed')

    def test_only_manager_can_patch(self):
        need = self._need()
        self.client.force_authenticate(self.stranger)
        response = self.client.patch(f'/api/needs/{need.pk}/', {'title': 'Renamed'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.client.force_authenticate(self.manager)
        response = self.client.patch(f'/api/needs/{need.pk}/', {'status': 'cancelled'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'cancelled')


class WorkItemsTests(NeedsBaseTestCase):
    def setUp(self):
        super().setUp()
        from django.contrib.contenttypes.models import ContentType

        self.ct = ContentType.objects.get_for_model(Course)
        self.need = Need.objects.create(
            content_type=self.ct, object_id=self.course.pk, title='Grading help', created_by=self.manager
        )

    def test_applicant_sees_own_pending_application(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        rows = work_items(self.applicant)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'need_application')

    def test_manager_sees_pending_decision_row(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        rows = work_items(self.manager)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'need_decision')
        self.assertEqual(rows[0]['status'], '1 pending')

    def test_stranger_sees_nothing(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        self.assertEqual(work_items(self.stranger), [])


class VolunteeringOfferTests(TestCase):
    """The supply side (2026-10-01). Refusals first, as this file's header says, and then the one
    thing the owner actually asked for by name: that an offer can be written and found in a
    language other than the reader's."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        FeatureFlag.objects.update_or_create(key='volunteering', defaults={'is_enabled': True})
        self.volunteer = make_user('offer-volunteer')
        self.stranger = make_user('offer-stranger')
        self.client = APIClient()

    def _post(self, user, **overrides):
        body = {'title': 'I can run a maths club', 'kind': 'expertise', 'language': 'pl'}
        body.update(overrides)
        client = APIClient()
        client.force_authenticate(user)
        return client.post('/api/volunteering-offers/', body, format='json')

    # ---- who may post, and what is refused ----------------------------------------------------

    def test_an_anonymous_visitor_may_read_the_board_but_not_post(self):
        self._post(self.volunteer)

        self.assertEqual(self.client.get('/api/volunteering-offers/').status_code, 200)
        self.assertEqual(len(self.client.get('/api/volunteering-offers/').json()), 1)
        self.assertEqual(
            self.client.post('/api/volunteering-offers/', {'title': 'x'}, format='json').status_code,
            401,
        )

    def test_a_minor_may_not_publish_an_offer(self):
        """The same refusal a tutoring listing makes, for the same reason (accounts/minors.py):
        a public posting inviting strangers to make contact. A minor may still volunteer through
        an event's rota, where an organiser is accountable for them."""
        minor = make_user('offer-minor')
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])

        response = self._post(minor)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['detail'], MINOR)

    def test_the_flag_takes_the_whole_surface_away(self):
        """403, and signed in — the same two things this file's `needs` kill-switch test pins.
        `feature_gate` blocks every action, reads included, so a killed board genuinely vanishes
        from the API rather than only from the nav that hides its own link."""
        self._post(self.volunteer)
        FeatureFlag.objects.filter(key='volunteering').update(is_enabled=False)
        self.client.force_authenticate(self.stranger)

        self.assertEqual(self.client.get('/api/volunteering-offers/').status_code, 403)

    def test_the_flag_does_not_lock_staff_out(self):
        self._post(self.volunteer)
        FeatureFlag.objects.filter(key='volunteering').update(is_enabled=False)
        self.client.force_authenticate(make_user('offer-staffer', is_staff=True))

        self.assertEqual(self.client.get('/api/volunteering-offers/').status_code, 200)

    def test_the_needs_flag_does_not_govern_offers(self):
        """Two boards, two switches — turning the demand side off must not take the supply side
        with it (house rule 3 read precisely)."""
        FeatureFlag.objects.update_or_create(key='needs', defaults={'is_enabled': False})
        self._post(self.volunteer)

        self.assertEqual(self.client.get('/api/volunteering-offers/').status_code, 200)

    # ---- visibility ---------------------------------------------------------------------------

    def test_a_paused_offer_is_the_volunteers_own_business(self):
        offer_id = self._post(self.volunteer).json()['id']
        owner = APIClient()
        owner.force_authenticate(self.volunteer)
        owner.patch(f'/api/volunteering-offers/{offer_id}/', {'status': 'paused'}, format='json')

        stranger = APIClient()
        stranger.force_authenticate(self.stranger)
        self.assertEqual(stranger.get(f'/api/volunteering-offers/{offer_id}/').status_code, 404)
        self.assertEqual(len(stranger.get('/api/volunteering-offers/').json()), 0)

        self.assertEqual(owner.get(f'/api/volunteering-offers/{offer_id}/').status_code, 200)
        mine = owner.get('/api/volunteering-offers/?mine=true').json()
        self.assertEqual([row['status'] for row in mine], ['paused'])

    def test_somebody_elses_offer_is_not_yours_to_rewrite_by_either_verb(self):
        """`UpdateModelMixin` binds PUT as well as PATCH — the exact hole `NeedViewSet.update`
        records having shipped once."""
        offer_id = self._post(self.volunteer).json()['id']
        stranger = APIClient()
        stranger.force_authenticate(self.stranger)

        for method in (stranger.patch, stranger.put):
            response = method(
                f'/api/volunteering-offers/{offer_id}/',
                {'title': 'mine now', 'kind': 'help'},
                format='json',
            )
            self.assertEqual(response.status_code, 404, method)
        self.assertEqual(stranger.delete(f'/api/volunteering-offers/{offer_id}/').status_code, 404)

    # ---- "in different languages", which is what was asked for --------------------------------

    def test_an_offer_declares_the_language_it_is_written_in_and_lists_narrow_by_it(self):
        self._post(self.volunteer, title='Mogę poprowadzić kółko', language='pl')
        self._post(self.volunteer, title='I can run a club', language='en')
        self._post(self.volunteer, title='Можу вести гурток', language='uk')

        response = self.client.get('/api/volunteering-offers/?content_locales=uk')

        self.assertEqual([row['language'] for row in response.json()], ['uk'])
        self.assertEqual(response['X-EdMat-Hidden-Languages'], '2')

    def test_the_languages_somebody_can_help_in_are_a_separate_question(self):
        """An offer typed in Polish by somebody who also speaks Ukrainian is exactly the row a
        family looking for Ukrainian-speaking help needs to find, and filtering on the language
        the advert happens to be written in would hide it."""
        self._post(self.volunteer, language='pl', spoken_languages=['pl', 'uk'])
        self._post(self.volunteer, language='pl', spoken_languages=['pl'])

        found = self.client.get('/api/volunteering-offers/?speaks=uk').json()

        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['spoken_languages'], ['pl', 'uk'])

    def test_spoken_languages_are_lower_cased_trimmed_and_de_duplicated(self):
        response = self._post(self.volunteer, spoken_languages=['PL', ' pl ', 'En'])

        self.assertEqual(response.json()['spoken_languages'], ['pl', 'en'])

    def test_more_languages_than_the_cap_is_a_400_not_a_silent_truncation(self):
        """A free-string list must not become an unbounded one through the API, and refusing is
        honest where quietly dropping the thirteenth is not (house rule 10, read sideways)."""
        response = self._post(self.volunteer, spoken_languages=[f'x{i}' for i in range(13)])

        self.assertEqual(response.status_code, 400)

    def test_a_language_list_that_is_not_a_list_is_a_400(self):
        response = self._post(self.volunteer, spoken_languages={'pl': True})

        self.assertEqual(response.status_code, 400)

    # ---- the description is content, so it is sanitized on write ------------------------------

    def test_the_description_is_sanitized_but_keeps_links_and_latex(self):
        response = self._post(
            self.volunteer,
            description='<script>alert(1)</script>See <a href="https://x.org">this</a> \\(x^2\\)',
        )

        saved = response.json()['description']
        self.assertNotIn('<script', saved)
        self.assertIn('<a href="https://x.org">this</a>', saved)
        self.assertIn('\\(x^2\\)', saved)
