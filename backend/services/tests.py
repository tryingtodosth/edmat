"""Part of this project's automated test suite (CLAUDE.md Section 17L's own established convention
- Django's/DRF's built-in TestCase/APITestCase, no new dependency, `testing/factories.py`'s shared
fixture builders). Covers the tutoring/services listings feature (services/models.py's own doc
comment): course-scoped creation and discovery, owner-only writes, and the `?mine=`/`is_active`
visibility rules `ServiceViewSet.get_queryset` implements.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from moderation.models import FeatureFlag, Report
from moderation.services import build_report_queue
from services.models import Service, ServiceWatch
from testing.factories import make_course, make_user


class ServiceCreationTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='uw-services-am2')
        self.provider = make_user('provider-one')

    def test_authenticated_user_can_create_a_course_scoped_listing(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'),
            {
                'title': 'AM2 tutoring, exam prep',
                'description': 'Weekly sessions, exam-focused.',
                'course_slugs': [self.branch.slug],
                'hourly_rate': '80.00',
                'currency': 'PLN',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        service = Service.objects.get(provider=self.provider)
        self.assertEqual(service.title, 'AM2 tutoring, exam prep')
        self.assertEqual(list(service.branches.all()), [self.branch])
        # The response is the FULL read shape (ServiceSerializer), not the narrower write
        # serializer's own echoed payload - provider info and resolved course_slugs included.
        self.assertEqual(response.data['provider_username'], 'provider-one')
        self.assertEqual(response.data['course_slugs'], [self.branch.slug])

    def test_anonymous_user_cannot_create_a_listing(self):
        response = self.client.post(
            reverse('service-list'),
            {'title': 'Anon listing', 'course_slugs': [self.branch.slug]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Service.objects.filter(title='Anon listing').exists())

    def test_unknown_course_slug_is_rejected(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'),
            {'title': 'Bad branch ref', 'course_slugs': ['does-not-exist']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('course_slugs', response.data)
        self.assertFalse(Service.objects.filter(title='Bad branch ref').exists())

    def test_hourly_rate_and_courses_are_optional(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'), {'title': 'General tutoring, any branch'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        service = Service.objects.get(pk=response.data['id'])
        self.assertIsNone(service.hourly_rate)
        self.assertEqual(service.branches.count(), 0)


class ServiceDiscoveryTests(APITestCase):
    def setUp(self):
        self.course_a = make_course(slug='uw-services-am2')
        self.course_b = make_course(slug='uw-services-rp1')
        self.provider = make_user('provider-two')
        self.other_provider = make_user('provider-three')

        self.active_am2 = Service.objects.create(provider=self.provider, title='AM2 help', is_active=True)
        self.active_am2.branches.add(self.course_a)

        self.active_rp1 = Service.objects.create(
            provider=self.other_provider, title='RP1 help', is_active=True
        )
        self.active_rp1.branches.add(self.course_b)

        self.paused = Service.objects.create(provider=self.provider, title='Paused listing', is_active=False)
        self.paused.branches.add(self.course_a)

    def test_public_browse_only_shows_active_listings(self):
        response = self.client.get(reverse('service-list'))

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help', 'RP1 help'})

    def test_course_scoped_filter_only_returns_that_courses_listings(self):
        response = self.client.get(reverse('service-list'), {'branch': self.course_a.slug})

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help'})

    def test_provider_scoped_filter_only_returns_that_providers_active_listings(self):
        # The public profile page's own new "their tutoring listings" section (CLAUDE.md's
        # tutoring-listings feature note, item 6) — a stranger visiting someone else's profile must
        # never see that provider's own PAUSED listing, only what the ordinary public browse would.
        response = self.client.get(reverse('service-list'), {'provider': self.provider.pk})

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help'})

    def test_mine_shows_the_authenticated_users_own_listings_including_paused(self):
        self.client.force_authenticate(self.provider)

        response = self.client.get(reverse('service-list'), {'mine': 'true'})

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help', 'Paused listing'})

    def test_mine_is_silently_ignored_for_an_anonymous_request(self):
        # Same polite-degradation instinct this app's other optional/authenticated-only query
        # params already follow, per the view's own doc comment - no 401, just the plain public
        # (active-only) queryset.
        response = self.client.get(reverse('service-list'), {'mine': 'true'})

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help', 'RP1 help'})

    def test_owner_can_retrieve_their_own_paused_listing_directly(self):
        # A real, found-before-shipping gap: without get_queryset's own retrieve/comments carve-out,
        # this 404'd for the owner viewing their own paused listing's detail page directly (the
        # `?mine=true` escape hatch only ever applied to `list`).
        self.client.force_authenticate(self.provider)

        response = self.client.get(reverse('service-detail', args=[self.paused.pk]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_anonymous_user_cannot_retrieve_someone_elses_paused_listing(self):
        response = self.client.get(reverse('service-detail', args=[self.paused.pk]))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_different_logged_in_user_cannot_retrieve_someone_elses_paused_listing(self):
        self.client.force_authenticate(self.other_provider)

        response = self.client.get(reverse('service-detail', args=[self.paused.pk]))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ServiceOwnershipTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='uw-services-am2')
        self.owner = make_user('service-owner')
        self.other_user = make_user('service-someone-else')
        self.service = Service.objects.create(provider=self.owner, title='Original title')

    def test_owner_can_update_their_own_listing(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(
            reverse('service-detail', args=[self.service.pk]),
            {'title': 'Updated title', 'is_active': False},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.service.refresh_from_db()
        self.assertEqual(self.service.title, 'Updated title')
        self.assertFalse(self.service.is_active)

    def test_non_owner_cannot_update_someone_elses_listing(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.patch(
            reverse('service-detail', args=[self.service.pk]), {'title': 'Hijacked'}, format='json'
        )

        # Queryset-scoping, not permission-checking - matches ExerciseSetViewSet/NodeGovernorViewSet's
        # own established pattern elsewhere in this app: a non-owner's write attempt 404s rather
        # than 403ing, since the row simply isn't in their own scoped queryset at all.
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.service.refresh_from_db()
        self.assertEqual(self.service.title, 'Original title')

    def test_non_owner_cannot_delete_someone_elses_listing(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.delete(reverse('service-detail', args=[self.service.pk]))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Service.objects.filter(pk=self.service.pk).exists())

    def test_owner_can_delete_their_own_listing(self):
        self.client.force_authenticate(self.owner)

        response = self.client.delete(reverse('service-detail', args=[self.service.pk]))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Service.objects.filter(pk=self.service.pk).exists())


class TutoringKillSwitchTests(APITestCase):
    """The 'tutoring' FeatureFlag (moderation/models.py) — a moderator-facing kill switch, wired in
    via moderation/permissions.py's feature_gate('tutoring') on EVERY ServiceViewSet action, not
    just create. Confirms the whole surface genuinely vanishes for a non-staff caller while off, and
    that a real global moderator is unaffected (they can still browse/manage listings to decide
    whether to turn it back on)."""

    def setUp(self):
        self.branch = make_course(slug='uw-killswitch-am2')
        self.provider = make_user('kill-provider')
        self.visitor = make_user('kill-visitor')
        self.staff = make_user('kill-staff', is_staff=True)
        self.service = Service.objects.create(
            provider=self.provider, title='AM2 tutoring', description='...'
        )
        self.service.branches.add(self.branch)
        FeatureFlag.objects.filter(key='tutoring').update(is_enabled=False)

    def test_anonymous_browse_is_blocked_while_off(self):
        # DRF's own convention: an unauthenticated request is always reported as 401, not 403,
        # regardless of WHICH permission class in the list actually denied it (this app's other
        # anonymous-write tests, e.g. test_anonymous_user_cannot_create_a_listing above, already
        # rely on this same behavior) — 403 is reserved for an AUTHENTICATED caller who's simply not
        # allowed, which the create-while-off test below covers instead.
        response = self.client.get(reverse('service-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_non_staff_create_is_blocked_while_off(self):
        self.client.force_authenticate(self.visitor)

        response = self.client.post(
            reverse('service-list'),
            {'title': 'New listing', 'description': '...', 'course_slugs': [self.branch.slug]},
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_can_still_browse_while_off(self):
        self.client.force_authenticate(self.staff)

        response = self.client.get(reverse('service-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_turning_it_back_on_restores_access(self):
        FeatureFlag.objects.filter(key='tutoring').update(is_enabled=True)

        response = self.client.get(reverse('service-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ServiceReportingTests(APITestCase):
    """A tutoring listing is public-facing, user-generated content exactly like an Exercise/Comment/
    Review — it gets the same generic reporting mechanism (moderation/services.py's
    REPORT_KIND_MODELS) rather than a bespoke one. A listing has no viewer-pool concept the way an
    Exercise does (`resolve_view_scope_exercise` returns None for it), so it never auto-hides no
    matter how many reports it gets — it still queues normally for a moderator's own decision."""

    def setUp(self):
        self.provider = make_user('report-provider')
        self.reporter = make_user('report-reporter')
        self.moderator = make_user('report-mod', is_staff=True)
        self.service = Service.objects.create(provider=self.provider, title='Suspicious tutoring offer')

    def test_authenticated_user_can_report_a_listing(self):
        self.client.force_authenticate(self.reporter)

        response = self.client.post(
            reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk, 'reason': 'Spam'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Report.objects.filter(object_id=self.service.pk, reported_by=self.reporter, status='pending').exists()
        )

    def test_anonymous_user_cannot_report_a_listing(self):
        response = self.client.post(
            reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_many_reports_never_auto_hide_a_listing(self):
        # Well past MIN_REPORTS_FOR_AUTO_HIDE and the +20% threshold both — still never hides,
        # since a listing has no viewer-pool denominator to measure against at all.
        for i in range(10):
            self.client.force_authenticate(make_user(f'many-reporters{i}'))
            self.client.post(
                reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk}, format='json'
            )
        self.service.refresh_from_db()
        self.assertTrue(self.service.is_active)

    def test_reported_listing_appears_in_the_unscoped_report_queue(self):
        self.client.force_authenticate(self.reporter)
        self.client.post(reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk}, format='json')

        queue = build_report_queue(branch_ids=None)

        matching = [row for row in queue if row['kind'] == 'service' and row['object_id'] == self.service.pk]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['preview'], 'Suspicious tutoring offer')
        self.assertIsNone(matching[0]['exercise_id'])

    def test_reported_listing_excluded_from_a_scoped_governor_queue(self):
        # A listing isn't tied to one course the way an Exercise is (it can span several, or none at
        # all) — a course-scoped node governor's own queue can't resolve which course it belongs to,
        # so it's safely excluded for them (the same "hide rather than show something we can't
        # verify is theirs" default build_report_queue already documents), while still showing up
        # for real global staff (branch_ids=None, the case above).
        self.client.force_authenticate(self.reporter)
        self.client.post(reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk}, format='json')

        queue = build_report_queue(branch_ids=set())

        matching = [row for row in queue if row['kind'] == 'service']
        self.assertEqual(matching, [])

    def test_moderator_removing_a_reported_listing_deactivates_it(self):
        self.client.force_authenticate(self.reporter)
        self.client.post(reverse('report-list'), {'kind': 'service', 'object_id': self.service.pk}, format='json')
        self.client.force_authenticate(self.moderator)

        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'service', 'pk': self.service.pk, 'decision': 'remove'}),
            {'resolved_note': 'Confirmed spam.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.service.refresh_from_db()
        self.assertFalse(self.service.is_active)
        self.assertFalse(Report.objects.filter(object_id=self.service.pk, status='pending').exists())

    def test_non_moderator_cannot_resolve_a_reported_listing(self):
        self.client.force_authenticate(self.reporter)

        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'service', 'pk': self.service.pk, 'decision': 'remove'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ServiceCommentsTests(APITestCase):
    """Threaded discussion on a tutoring listing — the same generic Comment mechanism (content_type/
    object_id) Exercise/MaterialCoverage already use, reached via ServiceViewSet's own `comments`
    action rather than a bespoke one."""

    def setUp(self):
        self.provider = make_user('comment-provider')
        self.commenter = make_user('comment-commenter')
        self.service = Service.objects.create(provider=self.provider, title='Physics tutoring')

    def test_anonymous_user_can_read_comments(self):
        response = self.client.get(reverse('service-comments', args=[self.service.pk]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_authenticated_user_can_post_a_root_comment(self):
        self.client.force_authenticate(self.commenter)

        response = self.client.post(
            reverse('service-comments', args=[self.service.pk]),
            {'body': 'Do you also cover linear algebra?'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        comment = Comment.objects.get(pk=response.data['id'])
        self.assertEqual(comment.object_id, self.service.pk)
        self.assertIsNone(comment.parent_id)

    def test_anonymous_user_cannot_post_a_comment(self):
        response = self.client.post(
            reverse('service-comments', args=[self.service.pk]), {'body': 'Anon comment'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_reply_threads_correctly(self):
        self.client.force_authenticate(self.provider)
        root = self.client.post(
            reverse('service-comments', args=[self.service.pk]), {'body': 'Sure, ask away.'}, format='json'
        ).data

        self.client.force_authenticate(self.commenter)
        reply = self.client.post(
            reverse('service-comments', args=[self.service.pk]),
            {'body': 'Great, what times work?', 'parent': root['id']},
            format='json',
        )

        self.assertEqual(reply.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reply.data['parent'], root['id'])

    def test_a_parent_from_a_different_listing_is_rejected(self):
        other_service = Service.objects.create(provider=self.provider, title='Other listing')
        self.client.force_authenticate(self.provider)
        other_root = self.client.post(
            reverse('service-comments', args=[other_service.pk]), {'body': 'Root elsewhere'}, format='json'
        ).data

        self.client.force_authenticate(self.commenter)
        response = self.client.post(
            reverse('service-comments', args=[self.service.pk]),
            {'body': 'Misattached reply', 'parent': other_root['id']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ServiceReviewsTests(APITestCase):
    """Star rating + optional written review on a tutoring listing — the same upsert-on-resubmit
    shape ExerciseViewSet.reviews already establishes (community/tests.py)."""

    def setUp(self):
        self.provider = make_user('review-provider')
        self.reviewer = make_user('review-reviewer')
        self.service = Service.objects.create(provider=self.provider, title='Algebra tutoring')

    def test_authenticated_user_can_leave_a_review(self):
        self.client.force_authenticate(self.reviewer)

        response = self.client.post(
            reverse('service-reviews', args=[self.service.pk]),
            {'rating': 5, 'body': 'Excellent!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.service.reviews.count(), 1)

    def test_anonymous_user_cannot_leave_a_review(self):
        response = self.client.post(
            reverse('service-reviews', args=[self.service.pk]), {'rating': 5}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_resubmitting_updates_the_existing_review_not_a_duplicate(self):
        self.client.force_authenticate(self.reviewer)
        self.client.post(
            reverse('service-reviews', args=[self.service.pk]), {'rating': 3, 'body': 'Okay'}, format='json'
        )

        response = self.client.post(
            reverse('service-reviews', args=[self.service.pk]),
            {'rating': 5, 'body': 'Actually great'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.service.reviews.count(), 1)
        self.assertEqual(self.service.reviews.first().rating, 5)

    def test_average_rating_and_review_count_reflect_real_reviews(self):
        self.client.force_authenticate(self.reviewer)
        self.client.post(reverse('service-reviews', args=[self.service.pk]), {'rating': 4}, format='json')
        self.client.force_authenticate(make_user('review-reviewer2'))
        self.client.post(reverse('service-reviews', args=[self.service.pk]), {'rating': 2}, format='json')

        response = self.client.get(reverse('service-detail', args=[self.service.pk]))

        self.assertEqual(response.data['review_count'], 2)
        self.assertEqual(response.data['average_rating'], 3.0)


class ServiceWatchlistTests(APITestCase):
    """"Add certain tutor offers to a watchlist to compare listings" — a plain, per-user bookmark."""

    def setUp(self):
        self.provider = make_user('watch-provider')
        self.watcher = make_user('watch-watcher')
        self.service_a = Service.objects.create(provider=self.provider, title='Listing A')
        self.service_b = Service.objects.create(provider=self.provider, title='Listing B')

    def test_authenticated_user_can_watch_a_listing(self):
        self.client.force_authenticate(self.watcher)

        response = self.client.post(
            reverse('service-watch-list'), {'service': self.service_a.pk}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['service']['title'], 'Listing A')

    def test_anonymous_user_cannot_watch_a_listing(self):
        response = self.client.post(
            reverse('service-watch-list'), {'service': self.service_a.pk}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_watching_the_same_listing_twice_is_rejected(self):
        self.client.force_authenticate(self.watcher)
        self.client.post(reverse('service-watch-list'), {'service': self.service_a.pk}, format='json')

        response = self.client.post(
            reverse('service-watch-list'), {'service': self.service_a.pk}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_only_shows_the_current_users_own_watched_listings(self):
        self.client.force_authenticate(self.watcher)
        self.client.post(reverse('service-watch-list'), {'service': self.service_a.pk}, format='json')
        self.client.post(reverse('service-watch-list'), {'service': self.service_b.pk}, format='json')

        other_user = make_user('watch-other')
        self.client.force_authenticate(other_user)
        self.client.post(reverse('service-watch-list'), {'service': self.service_a.pk}, format='json')

        self.client.force_authenticate(self.watcher)
        response = self.client.get(reverse('service-watch-list'))

        titles = {row['service']['title'] for row in response.data}
        self.assertEqual(titles, {'Listing A', 'Listing B'})

    def test_user_can_unwatch_a_listing(self):
        self.client.force_authenticate(self.watcher)
        watch = self.client.post(
            reverse('service-watch-list'), {'service': self.service_a.pk}, format='json'
        ).data

        response = self.client.delete(reverse('service-watch-detail', args=[watch['id']]))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ServiceWatch.objects.filter(pk=watch['id']).exists())

    def test_user_cannot_unwatch_someone_elses_watch_row(self):
        self.client.force_authenticate(self.watcher)
        watch = self.client.post(
            reverse('service-watch-list'), {'service': self.service_a.pk}, format='json'
        ).data

        self.client.force_authenticate(make_user('watch-intruder'))
        response = self.client.delete(reverse('service-watch-detail', args=[watch['id']]))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ServiceWatch.objects.filter(pk=watch['id']).exists())
