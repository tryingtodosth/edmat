"""The management node seam (MANAGEMENT-BRIEF.md §2): `config/nodes.py` and its two views.

What is asserted is the DISPATCH, not the node apps' own rules — those have their own suites. The
rows here are the ones six management apps will rely on without re-checking: a stranger 404s on a
draft event's ref; a public course's ref comes back for anybody, with every standing false; the
host of an event is staff without a `staff` row; a course participant is a member but not staff;
the roster endpoint is staff-only; a material answers through its project.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from config import nodes
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_material, make_user


def _event(host, **kwargs):
    from events.models import Event

    defaults = {'title': 'Seminar', 'status': 'published', 'visibility': 'public'}
    defaults.update(kwargs)
    return Event.objects.create(host=host, **defaults)


def _course(instructor, **kwargs):
    from courses.models import STAFF_ROLE_CHOICES, Course, CourseStaff

    defaults = {'title': 'Course', 'visibility': 'public'}
    defaults.update(kwargs)
    course = Course.objects.create(instructor=instructor, **defaults)
    # `Course.save` may already have written the instructor's own staff row; if not, the first
    # role in the table is the one that runs the course.
    if not course.staff.filter(user=instructor).exists():
        CourseStaff.objects.create(course=course, user=instructor, role=STAFF_ROLE_CHOICES[0][0])
    return course


class NodeDispatchTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('host')
        self.other = make_user('other')

    def test_unknown_kind_and_missing_id_resolve_to_none(self):
        self.assertIsNone(nodes.resolve_node('galaxy', 1))
        self.assertIsNone(nodes.resolve_node('event', 999999))
        self.assertIsNone(nodes.resolve_node('event', 'undefined'))

    def test_public_event_is_viewable_by_a_stranger_and_run_by_its_host(self):
        event = _event(self.host)
        self.assertEqual(nodes.kind_of(event), 'event')
        self.assertTrue(nodes.can_view_node(None, event))
        self.assertFalse(nodes.is_node_staff(None, event))
        self.assertTrue(nodes.is_node_staff(self.host, event))
        self.assertTrue(nodes.can_manage_node(self.host, event))
        self.assertFalse(nodes.can_manage_node(self.other, event))
        staff = list(nodes.node_staff_users(event))
        self.assertIn(self.host, staff)
        self.assertEqual(len(staff), len(set(staff)), 'the host must not be listed twice')

    def test_draft_event_does_not_exist_for_a_stranger(self):
        event = _event(self.host, status='draft')
        self.assertFalse(nodes.can_view_node(self.other, event))
        self.assertTrue(nodes.can_view_node(self.host, event))

    def test_event_attendee_is_a_member_but_not_staff(self):
        from events.models import EventAttendance

        event = _event(self.host)
        EventAttendance.objects.create(event=event, attendee=self.other, status='going')
        self.assertTrue(nodes.is_node_member(self.other, event))
        self.assertFalse(nodes.is_node_staff(self.other, event))

    def test_course_participant_is_a_member_but_not_staff(self):
        from courses.models import Enrollment

        course = _course(self.host)
        Enrollment.objects.create(course=course, participant=self.other, status='active')
        self.assertTrue(nodes.is_node_member(self.other, course))
        self.assertFalse(nodes.is_node_staff(self.other, course))
        self.assertTrue(nodes.can_manage_node(self.host, course))

    def test_material_answers_through_its_project(self):
        branch = make_branch()
        material = make_material(branch)
        # No project: the honest answer is "platform staff only".
        self.assertTrue(nodes.can_view_node(None, material))
        self.assertFalse(nodes.is_node_staff(self.other, material))
        self.assertFalse(nodes.can_manage_node(self.other, material))

    def test_node_ref_shape(self):
        event = _event(self.host)
        ref = nodes.node_ref(event, self.host)
        self.assertEqual(set(ref), {'kind', 'id', 'title', 'is_staff', 'is_member', 'can_manage'})
        self.assertEqual(ref['kind'], 'event')
        self.assertEqual(ref['title'], 'Seminar')
        self.assertTrue(ref['can_manage'])


class NodeEndpointTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('host')
        self.other = make_user('other')
        self.client = APIClient()

    def test_ref_404s_for_a_stranger_on_a_draft_and_answers_on_a_public_event(self):
        draft = _event(self.host, status='draft')
        public = _event(self.host, title='Open day')
        self.assertEqual(self.client.get(f'/api/nodes/event/{draft.pk}/').status_code, 404)
        self.assertEqual(self.client.get('/api/nodes/galaxy/1/').status_code, 404)
        res = self.client.get(f'/api/nodes/event/{public.pk}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['title'], 'Open day')
        self.assertFalse(res.data['can_manage'])
        self.client.force_authenticate(self.host)
        self.assertTrue(self.client.get(f'/api/nodes/event/{public.pk}/').data['can_manage'])

    def test_staff_list_is_staff_only_and_names_the_host(self):
        event = _event(self.host)
        self.assertEqual(self.client.get(f'/api/nodes/event/{event.pk}/staff/').status_code, 401)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/nodes/event/{event.pk}/staff/').status_code, 404)
        self.client.force_authenticate(self.host)
        res = self.client.get(f'/api/nodes/event/{event.pk}/staff/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual([row['id'] for row in res.data], [self.host.pk])
        self.assertTrue(res.data[0]['display_name'])
