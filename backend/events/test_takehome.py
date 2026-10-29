"""Take-home decks and the event ↔ course cross-link (`prompts/06-event-takeaways.md`).

Refusals first, the way every suite in this app is weighted: a stranger asking about an
unannounced event's session, a course nobody may see, a kill switch that must leave the event page
standing. The happy paths are underneath, and they are what make the refusals mean something.

Two rules here have no other proof anywhere, and both are in `takehome.py`'s docstring as
decisions rather than accidents: a **private** set linked to a session is read *through* the
session, and an **unpublished** exercise is dropped.
"""

from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from courses.models import Course
from moderation.models import FeatureFlag
from organizations.models import OrganizationLink, OrganizationMember
from organizations.services import found
from study.models import ExerciseSet, ExerciseSetItem
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

from .models import Event, EventStaff, Session, SessionLink
from .takehome import session_exercise_count, session_exercises


def as_(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


class TakeHomeCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('th-host')
        self.stranger = make_user('th-stranger')
        self.branch = make_branch('th-branch')
        self.start = timezone.now() + timedelta(days=3)
        self.event = Event.objects.create(
            host=self.host, title='Autumn school', status='published', visibility='public',
            starts_at=self.start, runs_until=self.start + timedelta(days=1),
            location_kind='onsite', location_text='Main hall',
        )
        self.session = Session.objects.create(
            event=self.event, title='Integrals, slowly', starts_at=self.start + timedelta(hours=1),
            duration_minutes=90,
        )
        self.first = make_exercise(self.branch, 1, title='Pierwsze')
        self.second = make_exercise(self.branch, 2, title='Drugie')
        self.third = make_exercise(self.branch, 3, title='Trzecie')

    def url(self, session=None, event=None):
        return reverse(
            'event-session-exercises',
            args=[(event or self.event).pk, (session or self.session).pk],
        )

    def link_exercise(self, exercise, **kw):
        kw.setdefault('role', 'live')
        return SessionLink.objects.create(session=self.session, exercise=exercise, **kw)

    def link_set(self, *exercises, is_public=False, **kw):
        exercise_set = ExerciseSet.objects.create(owner=self.host, name='Zestaw', is_public=is_public)
        for order, exercise in enumerate(exercises):
            ExerciseSetItem.objects.create(exercise_set=exercise_set, exercise=exercise, order=order)
        kw.setdefault('role', 'homework')
        SessionLink.objects.create(session=self.session, exercise_set=exercise_set, **kw)
        return exercise_set


class TakeHomeRefusalTests(TakeHomeCase):
    def test_a_stranger_gets_404_on_a_draft_events_session(self):
        self.event.status = 'draft'
        self.event.save(update_fields=['status'])
        self.link_exercise(self.first)
        self.assertEqual(as_(self.stranger).get(self.url()).status_code, 404)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        # The host still reads their own.
        self.assertEqual(as_(self.host).get(self.url()).status_code, 200)

    def test_a_private_event_is_404_for_everybody_but_its_staff(self):
        self.event.visibility = 'private'
        self.event.save(update_fields=['visibility'])
        self.assertEqual(as_(self.stranger).get(self.url()).status_code, 404)
        self.assertEqual(as_(self.host).get(self.url()).status_code, 200)

    def test_a_session_belonging_to_another_event_is_404_not_somebody_elses_list(self):
        other = Event.objects.create(
            host=self.host, title='Other', status='published', visibility='public',
            starts_at=self.start, location_kind='onsite', location_text='Elsewhere',
        )
        self.link_exercise(self.first)
        res = self.client.get(reverse('event-session-exercises', args=[other.pk, self.session.pk]))
        self.assertEqual(res.status_code, 404)

    def test_a_nonexistent_session_is_404(self):
        res = self.client.get(reverse('event-session-exercises', args=[self.event.pk, 999999]))
        self.assertEqual(res.status_code, 404)

    def test_the_events_kill_switch_closes_it_for_a_non_staff_caller(self):
        FeatureFlag.objects.update_or_create(key='events', defaults={'is_enabled': False})
        self.link_exercise(self.first)
        self.assertEqual(as_(self.stranger).get(self.url()).status_code, 403)
        self.assertEqual(as_(make_user('th-mod', is_staff=True)).get(self.url()).status_code, 200)


class TakeHomeListTests(TakeHomeCase):
    def test_an_empty_session_answers_an_empty_list_rather_than_404(self):
        res = self.client.get(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])
        self.assertEqual(session_exercise_count(self.session), 0)

    def test_direct_links_come_back_in_programme_order_with_resolved_titles(self):
        self.link_exercise(self.second, order=0)
        self.link_exercise(self.first, order=1)
        res = self.client.get(self.url())
        self.assertEqual(
            res.data,
            [{'id': self.second.pk, 'title': 'Drugie'}, {'id': self.first.pk, 'title': 'Pierwsze'}],
        )

    def test_a_linked_set_contributes_its_members_even_when_the_set_is_private(self):
        """An organiser who puts a set on the programme has published its membership to the room —
        `ExerciseSetViewSet.retrieve` would refuse a stranger the set itself, and that is still
        true; this reads the membership through the session."""
        exercise_set = self.link_set(self.third, self.second, order=0)
        self.assertFalse(exercise_set.is_public)
        res = as_(self.stranger).get(self.url())
        self.assertEqual([row['id'] for row in res.data], [self.third.pk, self.second.pk])
        # And the set itself is still private to that same stranger.
        self.assertEqual(
            as_(self.stranger).get(f'/api/exercise-sets/{exercise_set.slug}/').status_code, 404
        )

    def test_a_direct_link_and_a_set_member_for_the_same_exercise_appear_once(self):
        self.link_exercise(self.first, order=0)
        self.link_set(self.first, self.second, order=1)
        res = self.client.get(self.url())
        self.assertEqual([row['id'] for row in res.data], [self.first.pk, self.second.pk])

    def test_an_unpublished_exercise_is_dropped_from_both_the_list_and_the_count(self):
        self.link_exercise(self.first, order=0)
        self.link_exercise(self.second, order=1)
        self.second.published = False
        self.second.save(update_fields=['published'])
        res = self.client.get(self.url())
        self.assertEqual([row['id'] for row in res.data], [self.first.pk])
        self.assertEqual(session_exercise_count(Session.objects.get(pk=self.session.pk)), 1)

    def test_material_and_url_links_contribute_nothing(self):
        SessionLink.objects.create(session=self.session, url='https://example.org/slides', role='slides')
        self.assertEqual(self.client.get(self.url()).data, [])

    def test_the_session_serializers_count_agrees_with_the_endpoint(self):
        self.link_exercise(self.first, order=0)
        self.link_set(self.second, self.third, order=1)
        listed = self.client.get(self.url()).data
        sessions = self.client.get(reverse('event-sessions', args=[self.event.pk])).data
        self.assertEqual(sessions[0]['takehome_count'], len(listed))
        self.assertEqual(sessions[0]['takehome_count'], 3)

    def test_the_rule_module_lists_a_linked_exercise(self):
        # A unit test of `session_exercises`; that both surfaces ask it is
        # `test_the_session_serializers_count_agrees_with_the_endpoint`.
        self.link_exercise(self.first)
        rows = session_exercises(Session.objects.get(pk=self.session.pk))
        self.assertEqual([e.pk for e in rows], [self.first.pk])


class RelatedCoursesCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('rc-host')
        self.teacher = make_user('rc-teacher')
        self.stranger = make_user('rc-stranger')
        self.start = timezone.now() + timedelta(days=4)
        self.event = Event.objects.create(
            host=self.host, title='Physics weekend', status='published', visibility='public',
            starts_at=self.start, location_kind='onsite', location_text='Hall A',
        )
        self.org = found(creator=self.host, name='Koło Naukowe Fizyków')
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        self.event_type = ContentType.objects.get_for_model(Event)
        self.course_type = ContentType.objects.get_for_model(Course)
        OrganizationLink.objects.create(
            organization=self.org, content_type=self.event_type, object_id=self.event.pk, kind='runs'
        )

    def url(self, event=None):
        return reverse('event-related-courses', args=[(event or self.event).pk])

    def course(self, title='Analiza I', visibility='public', instructor=None):
        return Course.objects.create(
            instructor=instructor or self.teacher, title=title, visibility=visibility
        )

    def link_course(self, course, kind='runs', organization=None):
        return OrganizationLink.objects.create(
            organization=organization or self.org, content_type=self.course_type,
            object_id=course.pk, kind=kind,
        )


class RelatedCoursesRefusalTests(RelatedCoursesCase):
    def test_a_stranger_gets_404_on_a_draft_event(self):
        self.event.status = 'draft'
        self.event.save(update_fields=['status'])
        self.assertEqual(as_(self.stranger).get(self.url()).status_code, 404)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        self.assertEqual(as_(self.host).get(self.url()).status_code, 200)

    def test_an_unlisted_course_is_absent_for_a_stranger_and_present_for_its_own_staff(self):
        unlisted = self.course(title='Prywatny', visibility='only_you')
        self.link_course(unlisted)
        self.assertEqual(as_(self.stranger).get(self.url()).data, [])
        titles = [row['title'] for row in as_(self.teacher).get(self.url()).data]
        self.assertEqual(titles, ['Prywatny'])

    def test_a_dissolved_organisation_takes_its_courses_off_the_panel_for_an_outsider(self):
        self.link_course(self.course())
        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        self.assertEqual(as_(self.stranger).get(self.url()).data, [])
        # Its own roster still sees it — `access.can_view` is the one place that decides.
        self.assertEqual(len(as_(self.teacher).get(self.url()).data), 1)

    def test_organizations_off_answers_an_empty_list_and_the_event_page_keeps_working(self):
        self.link_course(self.course())
        FeatureFlag.objects.update_or_create(key='organizations', defaults={'is_enabled': False})
        res = as_(self.stranger).get(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])
        # The event itself is untouched by somebody else's kill switch.
        self.assertEqual(
            as_(self.stranger).get(reverse('event-detail', args=[self.event.pk])).status_code, 200
        )
        # Staff keep the data, exactly as `feature_gate` spells the bypass.
        staff = make_user('rc-mod', is_staff=True)
        self.assertEqual(len(as_(staff).get(self.url()).data), 1)

    def test_the_events_kill_switch_still_closes_it(self):
        FeatureFlag.objects.update_or_create(key='events', defaults={'is_enabled': False})
        self.assertEqual(as_(self.stranger).get(self.url()).status_code, 403)


class RelatedCoursesListTests(RelatedCoursesCase):
    def test_a_course_run_by_the_same_body_is_listed_to_anybody(self):
        course = self.course()
        self.link_course(course)
        res = self.client.get(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual([row['id'] for row in res.data], [course.pk])
        # The shape is the courses API's own, so `CourseCard` needs nothing new.
        self.assertEqual(res.data[0]['title'], 'Analiza I')
        self.assertIn('instructor', res.data[0])

    def test_an_organisation_that_only_supports_the_event_still_counts(self):
        OrganizationLink.objects.filter(
            organization=self.org, content_type=self.event_type, object_id=self.event.pk
        ).update(kind='supports')
        course = self.course()
        self.link_course(course)
        self.assertEqual([row['id'] for row in self.client.get(self.url()).data], [course.pk])

    def test_a_course_the_body_only_supports_is_not_one_it_ran(self):
        self.link_course(self.course(), kind='supports')
        self.assertEqual(self.client.get(self.url()).data, [])

    def test_two_bodies_behind_one_event_contribute_one_copy_of_a_shared_course(self):
        second = found(creator=self.host, name='Wydział Fizyki')
        OrganizationLink.objects.create(
            organization=second, content_type=self.event_type, object_id=self.event.pk, kind='runs'
        )
        course = self.course()
        self.link_course(course)
        self.link_course(course, organization=second)
        self.assertEqual([row['id'] for row in self.client.get(self.url()).data], [course.pk])

    def test_an_event_with_no_organisation_behind_it_answers_an_empty_list(self):
        OrganizationLink.objects.filter(content_type=self.event_type).delete()
        self.link_course(self.course())
        self.assertEqual(self.client.get(self.url()).data, [])

    def test_a_material_linked_to_the_same_body_is_not_a_course(self):
        from testing.factories import make_branch as branch_factory
        from testing.factories import make_material

        material = make_material(branch_factory('rc-branch'), slug='rc-material')
        OrganizationLink.objects.create(
            organization=self.org,
            content_type=ContentType.objects.get_for_model(material.__class__),
            object_id=material.pk,
            kind='runs',
        )
        # A public course that happens to share the material's pk. Without it, a lost
        # `content_type=course` filter would look the material's pk up among courses, find nothing,
        # and still answer `[]`.
        Course.objects.create(
            pk=material.pk, instructor=self.teacher, title='Same pk', visibility='public'
        )
        self.assertEqual(self.client.get(self.url()).data, [])
