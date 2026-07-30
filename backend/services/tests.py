"""Part of this project's automated test suite (CLAUDE.md Section 17L's own established convention
- Django's/DRF's built-in TestCase/APITestCase, no new dependency, `testing/factories.py`'s shared
fixture builders). Covers the tutoring/services listings feature (services/models.py's own doc
comment): course-scoped creation and discovery, owner-only writes, and the `?mine=`/`is_active`
visibility rules `ServiceViewSet.get_queryset` implements.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from moderation.models import FeatureFlag
from services.models import Service
from testing.factories import make_course, make_user


class ServiceCreationTests(APITestCase):
    def setUp(self):
        self.course = make_course(slug='uw-services-am2')
        self.provider = make_user('provider-one')

    def test_authenticated_user_can_create_a_course_scoped_listing(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'),
            {
                'title': 'AM2 tutoring, exam prep',
                'description': 'Weekly sessions, exam-focused.',
                'course_slugs': [self.course.slug],
                'hourly_rate': '80.00',
                'currency': 'PLN',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        service = Service.objects.get(provider=self.provider)
        self.assertEqual(service.title, 'AM2 tutoring, exam prep')
        self.assertEqual(list(service.courses.all()), [self.course])
        # The response is the FULL read shape (ServiceSerializer), not the narrower write
        # serializer's own echoed payload - provider info and resolved course_slugs included.
        self.assertEqual(response.data['provider_username'], 'provider-one')
        self.assertEqual(response.data['course_slugs'], [self.course.slug])

    def test_anonymous_user_cannot_create_a_listing(self):
        response = self.client.post(
            reverse('service-list'),
            {'title': 'Anon listing', 'course_slugs': [self.course.slug]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Service.objects.filter(title='Anon listing').exists())

    def test_unknown_course_slug_is_rejected(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'),
            {'title': 'Bad course ref', 'course_slugs': ['does-not-exist']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('course_slugs', response.data)
        self.assertFalse(Service.objects.filter(title='Bad course ref').exists())

    def test_hourly_rate_and_courses_are_optional(self):
        self.client.force_authenticate(self.provider)

        response = self.client.post(
            reverse('service-list'), {'title': 'General tutoring, any course'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        service = Service.objects.get(pk=response.data['id'])
        self.assertIsNone(service.hourly_rate)
        self.assertEqual(service.courses.count(), 0)


class ServiceDiscoveryTests(APITestCase):
    def setUp(self):
        self.course_a = make_course(slug='uw-services-am2')
        self.course_b = make_course(slug='uw-services-rp1')
        self.provider = make_user('provider-two')
        self.other_provider = make_user('provider-three')

        self.active_am2 = Service.objects.create(provider=self.provider, title='AM2 help', is_active=True)
        self.active_am2.courses.add(self.course_a)

        self.active_rp1 = Service.objects.create(
            provider=self.other_provider, title='RP1 help', is_active=True
        )
        self.active_rp1.courses.add(self.course_b)

        self.paused = Service.objects.create(provider=self.provider, title='Paused listing', is_active=False)
        self.paused.courses.add(self.course_a)

    def test_public_browse_only_shows_active_listings(self):
        response = self.client.get(reverse('service-list'))

        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'AM2 help', 'RP1 help'})

    def test_course_scoped_filter_only_returns_that_courses_listings(self):
        response = self.client.get(reverse('service-list'), {'course': self.course_a.slug})

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


class ServiceOwnershipTests(APITestCase):
    def setUp(self):
        self.course = make_course(slug='uw-services-am2')
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
        self.course = make_course(slug='uw-killswitch-am2')
        self.provider = make_user('kill-provider')
        self.visitor = make_user('kill-visitor')
        self.staff = make_user('kill-staff', is_staff=True)
        self.service = Service.objects.create(
            provider=self.provider, title='AM2 tutoring', description='...'
        )
        self.service.courses.add(self.course)
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
            {'title': 'New listing', 'description': '...', 'course_slugs': [self.course.slug]},
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
