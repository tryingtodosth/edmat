"""What matters about a course somebody runs is who can see it and who can get into it.

So most of these pin boundaries rather than happy paths: a draft is invisible, a roster is not
public, a full course refuses, a removed person cannot walk back in, and participant-only lesson
notes stay out of an outsider's response. Those are the properties that fail silently — a broken
create flow announces itself immediately; a roster leaking to strangers does not.
"""

import io
import shutil
import tempfile
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from PIL import Image, ImageCms
from rest_framework.test import APIClient

from events.models import Event
from materials.models import Material, MaterialTranslation
from community.models import Comment
from notifications.models import Notification
from study.models import ExerciseSet, ExerciseSetItem
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_exercise

from .attachmentfile import MAX_ATTACHMENT_IMAGE_EDGE, validate_attachment_file
from .models import (
    Attachment,
    Chapter,
    ChapterReview,
    CourseInvite,
    CourseItem,
    CourseStaff,
    Enrollment,
    Lesson,
    LessonExerciseSet,
    LessonProgress,
    LessonReview,
    Course,
)


class ApiTestCase(TestCase):
    """The request-logging middleware writes to its own shards; a view test that does not declare
    them fails on Django's cross-database guard rather than on anything under test."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.instructor = User.objects.create_user('kasia', 'kasia@x.example', 'pw12345!')
        self.student = User.objects.create_user('michal', 'michal@x.example', 'pw12345!')
        self.other = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        self.field = Discipline.objects.create(slug='matematyka')
        self.subject = Branch.objects.create(slug='analiza-2', discipline=self.field)
        self.client = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def make_material(self, slug, title):
        """A material plus the translation its title actually lives on.

        `Material` has no `title` column — titles are per-locale rows, which is why every material
        response resolves one rather than reading a field.
        """
        material = Material.objects.create(branch=self.subject, slug=slug, type='script')
        MaterialTranslation.objects.create(material=material, locale='pl', title=title)
        return material

    def make_course(self, **kwargs):
        # `visibility` is spelled out because the model defaults it to `only_you` — a course is
        # nobody else's to see until its owner says so. Most tests here are about what somebody
        # OTHER than the instructor can do, so the useful default for a fixture is a published
        # course; the ones about visibility itself override it.
        defaults = {
            'instructor': self.instructor,
            'title': 'Analiza od zera',
            'visibility': 'public',
            'status': 'open',
            'enrollment_policy': 'open',
        }
        return Course.objects.create(**{**defaults, **kwargs})


class VisibilityTests(ApiTestCase):
    def test_an_only_you_course_is_invisible_to_everybody_but_its_instructor(self):
        hidden = self.make_course(visibility='only_you')
        anon = self.client.get('/api/courses/')
        self.assertNotIn(hidden.pk, [c['id'] for c in anon.data])

        stranger = self.as_(self.student).get('/api/courses/')
        self.assertNotIn(hidden.pk, [c['id'] for c in stranger.data])

        mine = self.as_(self.instructor).get('/api/courses/')
        self.assertIn(hidden.pk, [c['id'] for c in mine.data])

    def test_a_private_course_is_unlisted_and_not_reachable_by_guessing_its_id(self):
        """The whole point of `private`: a link gets you in, counting integers does not.

        The invite token is 256-bit, so the link is the credential. If retrieve-by-id answered for
        a private course, that credential would be bypassable by anybody willing to walk the id
        space, and the token would be decoration.
        """
        private = self.make_course(visibility='private')

        for client in (self.client, self.as_(self.student)):
            listing = client.get('/api/courses/')
            self.assertNotIn(private.pk, [c['id'] for c in listing.data])
            self.assertEqual(client.get(f'/api/courses/{private.pk}/').status_code, 404)

        # Its own staff still reach it by id, which is how they administer it at all.
        self.assertEqual(
            self.as_(self.instructor).get(f'/api/courses/{private.pk}/').status_code, 200
        )

    def test_a_participant_reaches_a_private_course_they_are_already_in(self):
        private = self.make_course(visibility='private')
        Enrollment.objects.create(course=private, participant=self.student, status='active')
        res = self.as_(self.student).get(f'/api/courses/{private.pk}/')
        self.assertEqual(res.status_code, 200)

    def test_visibility_and_status_are_independent(self):
        """The reason for the split: every combination is expressible and none is contradictory."""
        running_but_private = self.make_course(visibility='private', status='running')
        self.assertEqual(running_but_private.visibility, 'private')
        self.assertEqual(running_but_private.status, 'running')
        self.assertFalse(running_but_private.is_public)
        self.assertTrue(running_but_private.is_reachable)

    def test_a_published_course_is_public_without_an_account(self):
        course = self.make_course()
        res = self.client.get(f'/api/courses/{course.pk}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['title'], 'Analiza od zera')
        self.assertFalse(res.data['can_enrol'])  # anonymous
        self.assertEqual(res.data['enrollment_block_reason'], 'authentication_required')

    def test_courses_are_discoverable_by_subject(self):
        course = self.make_course()
        course.subjects.add(self.subject)
        self.make_course(title='Unrelated')
        res = self.client.get('/api/courses/?subject=analiza-2')
        self.assertEqual([c['id'] for c in res.data], [course.pk])


class EnrolmentTests(ApiTestCase):
    def test_open_policy_admits_immediately(self):
        course = self.make_course()
        res = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_approval_policy_parks_the_request(self):
        course = self.make_course(enrollment_policy='approval')
        res = self.as_(self.student).post(
            f'/api/courses/{course.pk}/enrol/', {'request_note': 'I am in year 2'}, format='json'
        )
        self.assertEqual(res.data['status'], 'pending')
        self.assertEqual(res.data['request_note'], 'I am in year 2')
        # A pending request is not a seat.
        self.assertEqual(course.active_participant_count, 0)

    def test_the_instructor_approves_and_the_seat_is_taken(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_only_the_instructor_decides(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(
            f'/api/courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_a_full_course_refuses_and_says_so(self):
        course = self.make_course(capacity=1)
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_approving_into_a_full_course_is_refused_too(self):
        """The cap has to hold on the instructor's path as well, or it is not a cap."""
        course = self.make_course(enrollment_policy='approval', capacity=1)
        first = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        second = self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        client = self.as_(self.instructor)
        client.post(
            f'/api/courses/{course.pk}/enrollments/{first.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        res = client.post(
            f'/api/courses/{course.pk}/enrollments/{second.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_a_closed_course_does_not_take_new_people(self):
        course = self.make_course(status='running')
        res = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'not_open')

    def test_an_instructor_cannot_enrol_in_their_own_course(self):
        course = self.make_course()
        res = self.as_(self.instructor).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'instructor_cannot_enrol')

    def test_asking_twice_does_not_queue_twice(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        res = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'already_enrolled')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_leaving_frees_the_seat_and_re_joining_reuses_the_row(self):
        course = self.make_course(capacity=1)
        client = self.as_(self.student)
        client.post(f'/api/courses/{course.pk}/enrol/')
        client.post(f'/api/courses/{course.pk}/leave/')
        self.assertEqual(course.active_participant_count, 0)
        again = client.post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(again.data['status'], 'active')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_somebody_removed_cannot_simply_walk_back_in(self):
        course = self.make_course()
        enrol = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'remove'},
            format='json',
        )
        res = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'removed')


class RosterTests(ApiTestCase):
    def test_the_roster_is_not_public(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(self.client.get(f'/api/courses/{course.pk}/participants/').status_code, 401)
        self.assertEqual(
            self.as_(self.other).get(f'/api/courses/{course.pk}/participants/').status_code, 403
        )

    def test_participants_see_each_other_and_the_instructor_sees_requests(self):
        course = self.make_course(enrollment_policy='approval')
        active = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/enrollments/{active.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')

        as_participant = self.as_(self.student).get(f'/api/courses/{course.pk}/participants/')
        self.assertEqual([r['status'] for r in as_participant.data], ['active'])

        as_instructor = self.as_(self.instructor).get(f'/api/courses/{course.pk}/participants/')
        self.assertEqual(sorted(r['status'] for r in as_instructor.data), ['active', 'pending'])


class LessonTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(
            chapter=self.chapter,
            title='Ciągi',
            description='Public blurb',
            participant_notes='The zoom link and the homework',
        )

    def test_an_outsider_sees_the_lesson_but_not_the_notes(self):
        res = self.client.get(f'/api/courses/{self.course.pk}/')
        lesson = res.data['lessons'][0]
        self.assertEqual(lesson['title'], 'Ciągi')
        self.assertEqual(lesson['description'], 'Public blurb')
        # Present but empty rather than absent — the response shape must not change with the caller.
        self.assertEqual(lesson['participant_notes'], '')

    def test_a_participant_sees_the_notes(self):
        client = self.as_(self.student)
        client.post(f'/api/courses/{self.course.pk}/enrol/')
        res = client.get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], 'The zoom link and the homework')

    def test_a_pending_request_is_not_yet_a_participant(self):
        course = self.make_course(enrollment_policy='approval')
        Lesson.objects.create(
            chapter=Chapter.objects.create(course=course, title='W'),
            title='L',
            participant_notes='secret',
        )
        client = self.as_(self.student)
        client.post(f'/api/courses/{course.pk}/enrol/')
        res = client.get(f'/api/courses/{course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], '')

    def test_only_the_instructor_adds_lessons(self):
        res = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/lessons/', {'title': 'Mine now'}, format='json'
        )
        self.assertEqual(res.status_code, 404)

    def test_the_instructor_adds_and_edits_lessons(self):
        client = self.as_(self.instructor)
        created = client.post(
            f'/api/courses/{self.course.pk}/lessons/',
            {'title': 'Szeregi', 'order': 2, 'chapter': self.chapter.pk},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        edited = client.patch(
            f'/api/courses/{self.course.pk}/lessons/{created.data["id"]}/',
            {'title': 'Szeregi liczbowe'},
            format='json',
        )
        self.assertEqual(edited.data['title'], 'Szeregi liczbowe')


class AuthoringTests(ApiTestCase):
    def test_a_new_course_is_visible_to_nobody_but_its_creator(self):
        """Creating is still not publishing — that guarantee moved from `status` to `visibility`
        without weakening. A new course is `only_you`, and its lifecycle starts at `open`, which now
        says only "taking enrolments once anybody can see it"."""
        res = self.as_(self.instructor).post(
            '/api/courses/', {'title': 'Nowy kurs'}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['visibility'], 'only_you')
        self.assertEqual(res.data['status'], 'open')
        self.assertTrue(res.data['is_instructor'])

    def test_the_creator_becomes_the_instructor_regardless_of_what_was_sent(self):
        res = self.as_(self.student).post(
            '/api/courses/',
            {'title': 'Not yours', 'instructor': self.instructor.pk},
            format='json',
        )
        self.assertEqual(res.data['instructor']['id'], self.student.pk)

    def test_somebody_elses_course_cannot_be_edited_or_deleted(self):
        course = self.make_course()
        client = self.as_(self.student)
        self.assertEqual(
            client.patch(f'/api/courses/{course.pk}/', {'title': 'x'}, format='json').status_code,
            404,
        )
        self.assertEqual(client.delete(f'/api/courses/{course.pk}/').status_code, 404)

    def test_the_cap_cannot_be_cut_below_the_people_already_admitted(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/', {'capacity': 1}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('capacity', res.data)

    def test_a_course_cannot_end_before_it_starts(self):
        res = self.as_(self.instructor).post(
            '/api/courses/',
            {'title': 'Backwards', 'starts_on': '2026-03-01', 'ends_on': '2026-02-01'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('ends_on', res.data)

    def test_my_courses_split_into_teaching_and_participating(self):
        teaching = self.make_course(title='I run this')
        joining = self.make_course(title='I attend this', instructor=self.other)
        client = self.as_(self.instructor)
        self.as_(self.instructor).post(f'/api/courses/{joining.pk}/enrol/')

        mine_teaching = client.get('/api/courses/?mine=teaching')
        self.assertEqual([c['id'] for c in mine_teaching.data], [teaching.pk])

        mine_attending = client.get('/api/courses/?mine=participating')
        self.assertEqual([c['id'] for c in mine_attending.data], [joining.pk])


class KillSwitchTests(ApiTestCase):
    def test_the_feature_flag_hides_the_whole_surface(self):
        """Matching every other kill switch here: off means gone for an ordinary visitor, reads
        included, while a real moderator keeps access to manage what already exists."""
        from moderation.models import FeatureFlag

        self.make_course()
        FeatureFlag.objects.update_or_create(key='courses', defaults={'is_enabled': False})
        # 401 anonymous, 403 signed in — DRF's own distinction, and the same pair every other gated
        # endpoint in this project already returns.
        self.assertEqual(self.client.get('/api/courses/').status_code, 401)
        self.assertEqual(self.as_(self.student).get('/api/courses/').status_code, 403)

        staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        self.assertEqual(self.as_(staff).get('/api/courses/').status_code, 200)


class DiscussionTests(ApiTestCase):
    """Reading and posting are two different questions, and `discussion_mode` only answers the first."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()

    def post_as(self, user, body='Cześć'):
        return self.as_(user).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': body}, format='json'
        )

    def test_participants_only_is_the_default(self):
        self.assertEqual(self.course.discussion_mode, 'participants')
        self.assertEqual(
            self.client.get(f'/api/courses/{self.course.pk}/comments/').status_code, 403
        )
        self.assertEqual(
            self.as_(self.other).get(f'/api/courses/{self.course.pk}/comments/').status_code,
            403,
        )

    def test_a_participant_reads_and_posts(self):
        self.as_(self.student).post(f'/api/courses/{self.course.pk}/enrol/')
        posted = self.post_as(self.student)
        self.assertEqual(posted.status_code, 201)
        read = self.as_(self.student).get(f'/api/courses/{self.course.pk}/comments/')
        self.assertEqual([c['body'] for c in read.data], ['Cześć'])

    def test_the_instructor_is_in_the_conversation_without_being_on_the_roster(self):
        self.assertEqual(self.post_as(self.instructor).status_code, 201)

    def test_a_public_thread_is_readable_but_not_writable_by_outsiders(self):
        """The whole point of two separate checks: open to read, closed to post."""
        self.course.discussion_mode = 'public'
        self.course.save()
        self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': 'Witam'}, format='json'
        )
        anon = self.client.get(f'/api/courses/{self.course.pk}/comments/')
        self.assertEqual(anon.status_code, 200)
        self.assertEqual([c['body'] for c in anon.data], ['Witam'])
        self.assertEqual(self.post_as(self.other).status_code, 403)

    def test_turning_the_discussion_off_closes_it_for_everybody(self):
        self.as_(self.student).post(f'/api/courses/{self.course.pk}/enrol/')
        self.course.discussion_mode = 'off'
        self.course.save()
        self.assertEqual(
            self.as_(self.student).get(f'/api/courses/{self.course.pk}/comments/').status_code,
            403,
        )
        self.assertEqual(self.post_as(self.student).status_code, 403)
        # Including the instructor: off means off, not "off for other people".
        self.assertEqual(self.post_as(self.instructor).status_code, 403)

    def test_a_pending_request_does_not_get_into_the_conversation(self):
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(
            self.as_(self.student).get(f'/api/courses/{course.pk}/comments/').status_code, 403
        )

    def test_a_reply_cannot_be_smuggled_in_from_another_thread(self):
        other_course = self.make_course(title='Elsewhere')
        self.as_(self.instructor).post(
            f'/api/courses/{other_course.pk}/comments/', {'body': 'root'}, format='json'
        )
        from community.models import Comment

        foreign = Comment.objects.first()
        res = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/comments/',
            {'body': 'reply', 'parent': foreign.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('parent', res.data)

    def test_the_viewer_is_told_what_they_may_do(self):
        detail = self.client.get(f'/api/courses/{self.course.pk}/').data
        self.assertFalse(detail['can_read_discussion'])
        self.assertFalse(detail['can_post_discussion'])
        self.as_(self.student).post(f'/api/courses/{self.course.pk}/enrol/')
        detail = self.as_(self.student).get(f'/api/courses/{self.course.pk}/').data
        self.assertTrue(detail['can_read_discussion'])
        self.assertTrue(detail['can_post_discussion'])


class NotificationTests(ApiTestCase):
    def notifs(self, user, type_=None):
        from notifications.models import Notification

        qs = Notification.objects.filter(recipient=user)
        return qs.filter(type=type_) if type_ else qs

    def test_asking_to_join_tells_the_instructor_and_carries_the_note(self):
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(
            f'/api/courses/{course.pk}/enrol/', {'request_note': 'Rok drugi'}, format='json'
        )
        row = self.notifs(self.instructor, 'course_enrollment_requested').get()
        self.assertEqual(row.target_label, course.title)
        self.assertEqual(row.course_id, course.pk)
        self.assertEqual(row.note, 'Rok drugi')

    def test_joining_an_open_course_notifies_nobody(self):
        """Otherwise a popular course buries its instructor in noise they cannot act on."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(self.notifs(self.instructor).count(), 0)

    def test_every_decision_reaches_the_person_it_is_about(self):
        for decision, expected in (
            ('approve', 'course_enrollment_approved'),
            ('decline', 'course_enrollment_declined'),
            ('remove', 'course_removed'),
        ):
            course = self.make_course(enrollment_policy='approval')
            enrol = self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
            self.as_(self.instructor).post(
                f'/api/courses/{course.pk}/enrollments/{enrol.data["id"]}/',
                {'decision': decision},
                format='json',
            )
            self.assertTrue(
                self.notifs(self.student, expected).filter(course=course).exists(), decision
            )

    def test_a_new_lesson_reaches_participants_but_not_the_instructor(self):
        course = self.make_course()
        chapter = Chapter.objects.create(course=course, title='Week 1')
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/',
            {'title': 'Ciągi', 'chapter': chapter.pk},
            format='json',
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 1)
        # notify()'s own actor==recipient guard: nobody is told about their own action.
        self.assertEqual(self.notifs(self.instructor, 'course_new_lesson').count(), 0)

    def test_a_post_reaches_the_other_people_in_the_conversation(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/courses/{course.pk}/comments/', {'body': 'Pytanie'}, format='json'
        )
        self.assertEqual(self.notifs(self.other, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.instructor, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.student, 'course_new_post').count(), 0)

    def test_a_pending_request_is_never_told_what_is_happening_inside(self):
        """Leaking course activity to somebody not admitted would undo the participants-only rule."""
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 0)


class NotificationSettingTests(ApiTestCase):
    """Three independent switches, at three levels, each of which must work on its own."""

    def notif_count(self, user, type_):
        from notifications.models import Notification

        return Notification.objects.filter(recipient=user, type=type_).count()

    def test_the_instructor_can_stop_announcing_lessons(self):
        course = self.make_course(announce_new_lessons=False)
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_the_instructor_can_stop_announcing_posts(self):
        course = self.make_course(announce_new_posts=False)
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.other, 'course_new_post'), 0)

    def test_a_participant_can_mute_one_course_without_leaving_it(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        muted = self.as_(self.student).post(
            f'/api/courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(muted.status_code, 200)
        self.assertFalse(muted.data['notify'])
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        # Still genuinely in the course — muting is not leaving.
        self.assertEqual(course.active_participant_count, 1)

    def test_muting_is_reversible_and_reported_back(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        client = self.as_(self.student)
        client.post(f'/api/courses/{course.pk}/mute/', {'notify': False}, format='json')
        self.assertFalse(client.get(f'/api/courses/{course.pk}/').data['notify_me'])
        client.post(f'/api/courses/{course.pk}/mute/', {'notify': True}, format='json')
        self.assertTrue(client.get(f'/api/courses/{course.pk}/').data['notify_me'])

    def test_notify_me_is_null_for_somebody_not_in_the_course(self):
        """Distinct from False, which means "in the course, muted"."""
        course = self.make_course()
        self.assertIsNone(self.as_(self.other).get(f'/api/courses/{course.pk}/').data['notify_me'])

    def test_only_a_participant_can_mute(self):
        course = self.make_course()
        res = self.as_(self.other).post(
            f'/api/courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_the_account_wide_category_switches_all_six_off(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.notify_on_course_activity = False
        profile.save()
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_one_type_can_be_muted_without_the_rest(self):
        """The per-type list layers on top of the coarse category, never instead of it."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.muted_notification_types = ['course_new_lesson']
        profile.save()
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        self.assertEqual(self.notif_count(self.student, 'course_new_post'), 1)

    def test_settings_are_the_instructors_alone_to_change(self):
        course = self.make_course()
        res = self.as_(self.student).patch(
            f'/api/courses/{course.pk}/', {'discussion_mode': 'off'}, format='json'
        )
        self.assertEqual(res.status_code, 404)
        ok = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/', {'discussion_mode': 'public'}, format='json'
        )
        self.assertEqual(ok.data['discussion_mode'], 'public')


class StaffTests(ApiTestCase):
    """More than one person runs a course, and what each of them may do differs."""

    def test_creating_a_course_seats_its_author_as_owner(self):
        course = self.make_course()
        self.assertEqual(course.role_of(self.instructor), 'owner')
        # Not via the viewset — the invariant belongs to the model, so a seed command or the admin
        # creating a course must produce one too.
        self.assertEqual(course.staff.filter(role='owner').count(), 1)

    def test_an_admin_can_edit_the_course_but_only_the_owner_can_delete_it(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='admin')

        edited = self.as_(self.other).patch(
            f'/api/courses/{course.pk}/', {'summary': 'now with more rigour'}, format='json'
        )
        self.assertEqual(edited.status_code, 200)

        refused = self.as_(self.other).delete(f'/api/courses/{course.pk}/')
        self.assertEqual(refused.status_code, 404)
        self.assertTrue(Course.objects.filter(pk=course.pk).exists())

        allowed = self.as_(self.instructor).delete(f'/api/courses/{course.pk}/')
        self.assertEqual(allowed.status_code, 204)

    def test_an_assistant_curates_content_but_cannot_touch_settings_or_staff(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        client = self.as_(self.other)

        made = client.post(
            f'/api/courses/{course.pk}/chapters/', {'title': 'Week 1'}, format='json'
        )
        self.assertEqual(made.status_code, 201)

        # Settings and the staff list are an administrator's, and an assistant is not one.
        self.assertEqual(
            client.patch(
                f'/api/courses/{course.pk}/', {'title': 'renamed'}, format='json'
            ).status_code,
            404,
        )
        self.assertEqual(
            client.post(
                f'/api/courses/{course.pk}/staff/',
                {'user_id': self.student.pk, 'role': 'assistant'},
                format='json',
            ).status_code,
            404,
        )

    def test_the_owner_can_never_be_demoted_or_removed(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='admin')
        owner_row = course.staff.get(role='owner')
        client = self.as_(self.other)

        demote = client.patch(
            f'/api/courses/{course.pk}/staff/{owner_row.pk}/',
            {'role': 'assistant'},
            format='json',
        )
        self.assertEqual(demote.status_code, 400)
        self.assertEqual(demote.data['detail'], 'owner_immutable')

        remove = client.delete(f'/api/courses/{course.pk}/staff/{owner_row.pk}/')
        self.assertEqual(remove.status_code, 400)
        self.assertEqual(course.staff.get(pk=owner_row.pk).role, 'owner')

    def test_promoting_a_participant_gives_up_their_seat(self):
        """Otherwise one person counts twice against capacity — once as staff, once on the roster."""
        course = self.make_course(capacity=2)
        Enrollment.objects.create(course=course, participant=self.student, status='active')
        self.assertEqual(course.active_participant_count, 1)

        self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/staff/',
            {'user_id': self.student.pk, 'role': 'assistant'},
            format='json',
        )
        self.assertEqual(course.active_participant_count, 0)
        self.assertEqual(course.role_of(self.student), 'assistant')

    def test_staff_cannot_enrol_as_participants(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        response = self.as_(self.other).post(f'/api/courses/{course.pk}/enrol/')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'instructor_cannot_enrol')

    def test_a_co_teacher_sees_the_course_in_their_own_teaching_list(self):
        course = self.make_course(visibility='only_you')
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        mine = self.as_(self.other).get('/api/courses/?mine=teaching')
        self.assertIn(course.pk, [c['id'] for c in mine.data])

    def test_the_roster_is_readable_by_staff_and_participants_but_not_strangers(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        Enrollment.objects.create(course=course, participant=self.student, status='active')

        self.assertEqual(
            self.as_(self.other).get(f'/api/courses/{course.pk}/staff/').status_code, 200
        )
        self.assertEqual(
            self.as_(self.student).get(f'/api/courses/{course.pk}/staff/').status_code, 200
        )
        outsider = User.objects.create_user('zosia', 'z@x.example', 'pw12345!')
        self.assertEqual(
            self.as_(outsider).get(f'/api/courses/{course.pk}/staff/').status_code, 403
        )


class ContributionTests(ApiTestCase):
    """Uploading materials and exercises into a course, and the review that usually gates it."""

    def setUp(self):
        super().setUp()
        self.material = self.make_material('skrypt', 'Skrypt')
        self.other_material = self.make_material('zadania', 'Zadania')

    def _enrol(self, user, course):
        return Enrollment.objects.create(course=course, participant=user, status='active')

    def test_a_closed_course_refuses_participant_contributions(self):
        course = self.make_course(contribution_policy='staff')
        self._enrol(self.student, course)
        response = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'contributions_closed')

    def test_a_non_participant_cannot_contribute_even_when_the_course_is_open_to_it(self):
        course = self.make_course(contribution_policy='open')
        response = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_a_participant')

    def test_under_approval_a_submission_waits_and_is_invisible_to_other_participants(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)

        created = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['status'], 'pending')

        # The submitter still sees their own, waiting — otherwise it looks like it vanished.
        mine = self.as_(self.student).get(f'/api/courses/{course.pk}/items/')
        self.assertEqual([i['id'] for i in mine.data], [created.data['id']])
        # Another participant sees nothing at all.
        theirs = self.as_(self.other).get(f'/api/courses/{course.pk}/items/')
        self.assertEqual(theirs.data, [])
        # Staff see it, because acting on it is their job.
        staff = self.as_(self.instructor).get(f'/api/courses/{course.pk}/items/')
        self.assertEqual(len(staff.data), 1)

    def test_every_member_of_staff_is_told_about_a_submission(self):
        course = self.make_course(contribution_policy='approval')
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        self._enrol(self.student, course)

        self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        for person in (self.instructor, self.other):
            self.assertTrue(
                Notification.objects.filter(
                    recipient=person, type='course_contribution_submitted'
                ).exists(),
                f'{person} was not told',
            )

    def test_approving_publishes_it_and_tells_the_contributor(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)
        item_id = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        approved = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/items/{item_id}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data['status'], 'approved')
        self.assertEqual(approved.data['decided_by']['id'], self.instructor.pk)

        visible = self.as_(self.other).get(f'/api/courses/{course.pk}/items/')
        self.assertEqual([i['id'] for i in visible.data], [item_id])
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.student, type='course_contribution_approved'
            ).exists()
        )

    def test_rejecting_keeps_the_reason_and_hides_it_from_the_course(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)
        item_id = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        rejected = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/items/{item_id}/',
            {'decision': 'reject', 'decision_note': 'Already covered by week 2.'},
            format='json',
        )
        self.assertEqual(rejected.data['status'], 'rejected')
        self.assertEqual(rejected.data['decision_note'], 'Already covered by week 2.')
        self.assertEqual(self.as_(self.other).get(f'/api/courses/{course.pk}/items/').data, [])

    def test_under_the_open_policy_a_participant_publishes_directly(self):
        course = self.make_course(contribution_policy='open')
        self._enrol(self.student, course)
        created = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.data['status'], 'approved')

    def test_staff_never_queue_behind_themselves(self):
        course = self.make_course(contribution_policy='approval')
        created = self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.data['status'], 'approved')

    def test_a_contributor_may_withdraw_their_own_pending_submission_but_not_somebody_elses(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)
        mine = self.as_(self.student).post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        self.assertEqual(
            self.as_(self.other).delete(
                f'/api/courses/{course.pk}/items/{mine}/'
            ).status_code,
            404,
        )
        self.assertEqual(
            self.as_(self.student).delete(
                f'/api/courses/{course.pk}/items/{mine}/'
            ).status_code,
            204,
        )

    def test_the_same_thing_cannot_be_added_to_one_course_twice(self):
        course = self.make_course(contribution_policy='open')
        self._enrol(self.student, course)
        client = self.as_(self.student)
        first = client.post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(first.status_code, 201)
        second = client.post(
            f'/api/courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['detail'], 'already_in_course')

    def test_an_item_must_name_exactly_one_thing(self):
        course = self.make_course()
        neither = self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/items/', {}, format='json'
        )
        self.assertEqual(neither.status_code, 400)


class ChapterTests(ApiTestCase):
    """Collections, and the dates that open them."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.material = self.make_material('skrypt', 'Skrypt')
        Enrollment.objects.create(
            course=self.course, participant=self.student, status='active'
        )

    def _chapter(self, **kwargs):
        return Chapter.objects.create(course=self.course, title='Week 3', **kwargs)

    def _item_in(self, chapter):
        lesson = Lesson.objects.create(chapter=chapter, title='Session')
        return CourseItem.objects.create(
            course=self.course, lesson=lesson, material=self.material, status='approved'
        )

    @staticmethod
    def _items_of(chapter_row):
        """Every item under a chapter, flattened back out of its lessons — what these tests used to
        read straight off the chapter before the middle level existed."""
        return [item for lesson in chapter_row['lessons'] for item in lesson['items']]

    def test_a_locked_chapter_still_appears_but_its_contents_do_not(self):
        chapter = self._chapter(unlocks_at=timezone.now() + timedelta(days=7))
        self._item_in(chapter)

        seen = self.as_(self.student).get(f'/api/courses/{self.course.pk}/chapters/')
        self.assertEqual(len(seen.data), 1, 'the chapter itself must remain visible')
        self.assertFalse(seen.data[0]['is_unlocked'])
        self.assertIsNotNone(seen.data[0]['unlocks_at'])
        self.assertEqual(self._items_of(seen.data[0]), [], 'contents must stay shut')

    def test_staff_can_read_a_locked_chapter_because_they_have_to_prepare_it(self):
        chapter = self._chapter(unlocks_at=timezone.now() + timedelta(days=7))
        self._item_in(chapter)
        seen = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/chapters/')
        self.assertEqual(len(self._items_of(seen.data[0])), 1)
        self.assertFalse(seen.data[0]['is_unlocked'], 'still shut, just readable by staff')

    def test_a_chapter_whose_date_has_passed_is_open(self):
        chapter = self._chapter(unlocks_at=timezone.now() - timedelta(minutes=1))
        self._item_in(chapter)
        seen = self.as_(self.student).get(f'/api/courses/{self.course.pk}/chapters/')
        self.assertTrue(seen.data[0]['is_unlocked'])
        self.assertEqual(len(self._items_of(seen.data[0])), 1)

    def test_a_chapter_with_no_date_is_simply_always_open(self):
        chapter = self._chapter()
        self._item_in(chapter)
        seen = self.as_(self.student).get(f'/api/courses/{self.course.pk}/chapters/')
        self.assertTrue(seen.data[0]['is_unlocked'])
        self.assertEqual(len(self._items_of(seen.data[0])), 1)

    def test_deleting_a_chapter_keeps_its_content_unfiled(self):
        chapter = self._chapter()
        item = self._item_in(chapter)
        self.as_(self.instructor).delete(
            f'/api/courses/{self.course.pk}/chapters/{chapter.pk}/'
        )
        item.refresh_from_db()
        self.assertIsNone(item.lesson_id)
        self.assertTrue(CourseItem.objects.filter(pk=item.pk).exists())

    def test_an_item_cannot_be_filed_into_another_courses_lesson(self):
        elsewhere = Lesson.objects.create(
            chapter=Chapter.objects.create(
                course=self.make_course(title='Different course'), title='Theirs'
            ),
            title='Their session',
        )
        item = CourseItem.objects.create(
            course=self.course, material=self.material, status='approved'
        )
        response = self.as_(self.instructor).patch(
            f'/api/courses/{self.course.pk}/items/{item.pk}/',
            {'lesson': elsewhere.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class InviteTests(ApiTestCase):
    """Links that let somebody in without asking."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course(enrollment_policy='approval')

    def _make_invite(self, **kwargs):
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/invites/', kwargs, format='json'
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_only_administrators_may_mint_a_link(self):
        CourseStaff.objects.create(course=self.course, user=self.other, role='assistant')
        self.assertEqual(
            self.as_(self.other).post(
                f'/api/courses/{self.course.pk}/invites/', {}, format='json'
            ).status_code,
            404,
        )

    def test_a_link_lets_somebody_straight_past_the_approval_queue(self):
        invite = self._make_invite(role='participant')
        joined = self.as_(self.student).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(joined.status_code, 200)
        self.assertEqual(joined.data['detail'], 'joined')
        # 'active', not 'pending' — which is the entire point of having been invited.
        self.assertEqual(
            self.course.enrollments.get(participant=self.student).status, 'active'
        )

    def test_a_staff_link_makes_somebody_a_co_teacher(self):
        invite = self._make_invite(role='assistant')
        self.as_(self.student).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(self.course.role_of(self.student), 'assistant')

    def test_a_link_never_seats_somebody_over_capacity(self):
        course = self.make_course(capacity=1)
        Enrollment.objects.create(course=course, participant=self.other, status='active')
        invite = self.as_(self.instructor).post(
            f'/api/courses/{course.pk}/invites/', {}, format='json'
        ).data
        refused = self.as_(self.student).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data['detail'], 'full')

    def test_a_link_stops_working_once_it_is_used_up(self):
        invite = self._make_invite(max_uses=1)
        self.assertEqual(
            self.as_(self.student).post(
                f'/api/course-invites/{invite["token"]}/accept/'
            ).status_code,
            200,
        )
        spent = self.as_(self.other).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(spent.status_code, 400)
        self.assertEqual(spent.data['detail'], 'used_up')

    def test_an_expired_link_is_refused(self):
        invite = self._make_invite()
        CourseInvite.objects.filter(token=invite['token']).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )
        response = self.as_(self.student).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(response.data['detail'], 'expired')

    def test_revoking_kills_a_link_without_deleting_its_record(self):
        invite = self._make_invite()
        revoked = self.as_(self.instructor).delete(
            f'/api/courses/{self.course.pk}/invites/{invite["id"]}/'
        )
        self.assertEqual(revoked.status_code, 200)
        self.assertIsNotNone(revoked.data['revoked_at'])
        self.assertFalse(revoked.data['is_usable'])
        self.assertTrue(CourseInvite.objects.filter(pk=invite['id']).exists())

        response = self.as_(self.student).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(response.data['detail'], 'revoked')

    def test_the_preview_is_readable_logged_out_and_says_little(self):
        invite = self._make_invite()
        preview = self.client.get(f'/api/course-invites/{invite["token"]}/')
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data['course_title'], self.course.title)
        self.assertTrue(preview.data['is_usable'])
        # Nothing about who else is in the room, or what is in the course.
        self.assertNotIn('description', preview.data)
        self.assertNotIn('participants', preview.data)

    def test_an_unknown_token_is_a_404_rather_than_a_description(self):
        self.assertEqual(self.client.get('/api/course-invites/nope/').status_code, 404)
        self.assertEqual(
            self.as_(self.student).post('/api/course-invites/nope/accept/').status_code, 404
        )

    def test_following_your_own_link_does_not_demote_you(self):
        invite = self._make_invite(role='participant')
        response = self.as_(self.instructor).post(f'/api/course-invites/{invite["token"]}/accept/')
        self.assertEqual(response.data['detail'], 'already_staff')
        self.assertEqual(self.course.role_of(self.instructor), 'owner')


class AccountCourseLimitTests(ApiTestCase):
    """`Profile.max_courses` — an administrator's cap on how many courses one account owns.

    Enforced in the view rather than the serializer because it is a fact about the CALLER, not the
    payload: nothing the client sends can make it pass or fail.
    """

    def _create(self, user, title):
        return self.as_(user).post('/api/courses/', {'title': title}, format='json')

    def test_zero_means_uncapped(self):
        """0 is "no limit", not "no courses" — the same convention `capacity` and the upload quota
        already use, and the default, so nobody is capped by the field merely existing."""
        self.assertEqual(self.instructor.profile.max_courses, 0)
        for i in range(3):
            self.assertEqual(self._create(self.instructor, f'Kurs {i}').status_code, 201)

    def test_creating_past_the_cap_is_refused_and_says_the_numbers(self):
        profile = self.instructor.profile
        profile.max_courses = 2
        profile.save()

        self.assertEqual(self._create(self.instructor, 'Pierwszy').status_code, 201)
        self.assertEqual(self._create(self.instructor, 'Drugi').status_code, 201)

        refused = self._create(self.instructor, 'Trzeci')
        self.assertEqual(refused.status_code, 400)
        # The refusal names both numbers: "you cannot" without "2 of 2" is not actionable.
        self.assertIn('2 of 2', str(refused.data))
        self.assertEqual(Course.objects.filter(instructor=self.instructor).count(), 2)

    def test_the_cap_is_per_account_and_not_global(self):
        profile = self.instructor.profile
        profile.max_courses = 1
        profile.save()

        self.assertEqual(self._create(self.instructor, 'Mine').status_code, 201)
        self.assertEqual(self._create(self.instructor, 'One too many').status_code, 400)
        # Somebody else's uncapped account is untouched by their neighbour's ceiling.
        self.assertEqual(self._create(self.student, 'Theirs').status_code, 201)

    def test_a_lowered_cap_does_not_delete_what_already_exists(self):
        """Lowering a ceiling below what somebody already owns stops them creating more; it must not
        retroactively destroy or hide courses that real people may be enrolled in."""
        self._create(self.instructor, 'A')
        self._create(self.instructor, 'B')
        profile = self.instructor.profile
        profile.max_courses = 1
        profile.save()

        self.assertEqual(Course.objects.filter(instructor=self.instructor).count(), 2)
        self.assertEqual(self._create(self.instructor, 'C').status_code, 400)


class CourseUploadQuotaTests(ApiTestCase):
    """`Course.upload_quota_bytes` — a cap on the total stored bytes one course holds."""

    def setUp(self):
        super().setUp()
        self.course = Course.objects.create(
            instructor=self.instructor,
            title='Analiza od zera',
            visibility='public',
            status='open',
            contribution_policy='staff',
        )

    def _material_of_size(self, slug, size):
        """A material with REAL bytes behind it.

        The shared `make_material` helper stores a bare filename with nothing on disk, which is fine
        everywhere else in this suite and useless here: the quota is measured with `file.size`, so a
        file that does not exist weighs nothing.
        """
        from django.core.files.base import ContentFile

        material = Material.objects.create(branch=self.subject, slug=slug, type='script')
        material.file.save(f'{slug}.pdf', ContentFile(b'x' * size), save=True)
        MaterialTranslation.objects.create(material=material, locale='pl', title=slug)
        return material

    def _add(self, material):
        return self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': material.pk},
            format='json',
        )

    def test_zero_quota_means_uncapped(self):
        self.assertEqual(self.course.upload_quota_bytes, 0)
        self.assertEqual(self._add(self._material_of_size('duzy', 5000)).status_code, 201)
        self.assertIsNone(self.course.upload_bytes_left)

    def test_uploaded_bytes_counts_what_is_actually_attached(self):
        self._add(self._material_of_size('a', 1000))
        self.course.refresh_from_db()
        self.assertEqual(self.course.uploaded_bytes, 1000)

    def test_a_file_that_would_cross_the_quota_is_refused(self):
        self.course.upload_quota_bytes = 2500
        self.course.save()

        self.assertEqual(self._add(self._material_of_size('pierwszy', 2000)).status_code, 201)

        # 2000 + 1000 > 2500, so this one never lands, rather than being accepted and quietly
        # taking the course over its cap.
        refused = self._add(self._material_of_size('drugi', 1000))
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data['detail'], 'upload_quota_exceeded')

        self.course.refresh_from_db()
        self.assertEqual(self.course.uploaded_bytes, 2000)
        self.assertEqual(self.course.upload_bytes_left, 500)

    def test_something_that_still_fits_is_accepted(self):
        self.course.upload_quota_bytes = 2500
        self.course.save()
        self._add(self._material_of_size('pierwszy', 2000))
        self.assertEqual(self._add(self._material_of_size('maly', 400)).status_code, 201)

    def test_a_missing_file_on_disk_does_not_break_the_total(self):
        """`make_material` stores a name with no bytes behind it, which is exactly what a row whose
        file has gone missing from storage looks like. Reading the total must not raise on it."""
        self.course.items.create(material=self.make_material('widmo', 'Widmo'), status='approved')
        self.assertEqual(self.course.uploaded_bytes, 0)


class ReorderTests(ApiTestCase):
    """Drag-and-drop, from the server's side.

    The endpoint takes whole groups rather than individual moves, because a drag between two
    chapters changes both — see `CourseViewSet.reorder`. These check that it does, that a
    participant cannot, and that ids from another course are refused rather than quietly written.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.material = self.make_material('skrypt', 'Skrypt')
        self.a = Chapter.objects.create(course=self.course, title='Week 1', order=0)
        self.b = Chapter.objects.create(course=self.course, title='Week 2', order=1)
        self.a1 = Lesson.objects.create(chapter=self.a, title='Mon', order=0)
        self.a2 = Lesson.objects.create(chapter=self.a, title='Tue', order=1)
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    def _reorder(self, payload, who=None):
        return self.as_(who or self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/', payload, format='json'
        )

    def test_chapters_take_the_order_they_are_given(self):
        res = self._reorder({'kind': 'chapter', 'order': [self.b.pk, self.a.pk]})
        self.assertEqual(res.status_code, 200)
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual((self.b.order, self.a.order), (0, 1))

    def test_a_lesson_can_be_dragged_into_another_chapter(self):
        """The move and the reorder are one write: `a2` leaves chapter A for chapter B, and both
        groups arrive in the same request, so there is no moment where it is in both or neither."""
        res = self._reorder(
            {'kind': 'lesson', 'groups': {str(self.a.pk): [self.a1.pk], str(self.b.pk): [self.a2.pk]}}
        )
        self.assertEqual(res.status_code, 200)
        self.a2.refresh_from_db()
        self.assertEqual(self.a2.chapter_id, self.b.pk)
        self.assertEqual(self.a2.order, 0)

    def test_items_reorder_within_a_lesson_and_can_be_unfiled(self):
        one = CourseItem.objects.create(
            course=self.course, lesson=self.a1, material=self.material, status='approved'
        )
        res = self._reorder({'kind': 'item', 'groups': {'': [one.pk]}})
        self.assertEqual(res.status_code, 200)
        one.refresh_from_db()
        self.assertIsNone(one.lesson_id, 'the empty group means "in the course but not filed"')

    def test_a_participant_cannot_reorder_anything(self):
        res = self._reorder({'kind': 'chapter', 'order': [self.b.pk, self.a.pk]}, who=self.student)
        self.assertEqual(res.status_code, 404, '404 rather than 403 — the same scoping convention')
        self.a.refresh_from_db()
        self.assertEqual(self.a.order, 0, 'and nothing moved')

    def test_a_row_from_another_course_is_refused(self):
        theirs = Chapter.objects.create(course=self.make_course(title='Theirs'), title='Not yours')
        res = self._reorder({'kind': 'chapter', 'order': [self.a.pk, theirs.pk]})
        self.assertEqual(res.status_code, 400)
        theirs.refresh_from_db()
        self.assertEqual(theirs.order, 0)

    def test_a_group_from_another_course_is_refused(self):
        """The dangerous half: a valid lesson of ours, addressed into their chapter, would move our
        content into their course if the group id were not checked too."""
        theirs = Chapter.objects.create(course=self.make_course(title='Theirs'), title='Not yours')
        res = self._reorder({'kind': 'lesson', 'groups': {str(theirs.pk): [self.a1.pk]}})
        self.assertEqual(res.status_code, 400)
        self.a1.refresh_from_db()
        self.assertEqual(self.a1.chapter_id, self.a.pk)

    def test_the_same_row_cannot_be_listed_in_two_groups(self):
        res = self._reorder(
            {'kind': 'lesson', 'groups': {str(self.a.pk): [self.a1.pk], str(self.b.pk): [self.a1.pk]}}
        )
        self.assertEqual(res.status_code, 400)

    def test_a_lesson_cannot_be_left_without_a_chapter(self):
        res = self._reorder({'kind': 'lesson', 'groups': {'': [self.a1.pk]}})
        self.assertEqual(res.status_code, 400)

    def test_an_unknown_kind_is_refused(self):
        self.assertEqual(self._reorder({'kind': 'course', 'order': []}).status_code, 400)


class PrivateNoteTests(ApiTestCase):
    """Notes a person writes for themselves.

    The one property worth testing hardest is that nobody else can read them — not another
    participant, and not the people running the course. Everything else here is upsert mechanics.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon')
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    def _put(self, who, payload):
        return self.as_(who).put(
            f'/api/courses/{self.course.pk}/notes/', payload, format='json'
        )

    def _get(self, who):
        return self.as_(who).get(f'/api/courses/{self.course.pk}/notes/')

    def test_a_note_is_written_and_read_back(self):
        self.assertEqual(self._put(self.student, {'body': 'Revise limits'}).status_code, 200)
        rows = self._get(self.student).data
        self.assertEqual([r['body'] for r in rows], ['Revise limits'])

    def test_the_instructor_cannot_read_a_participants_notes(self):
        """The point of the feature. Running the course grants no visibility into what somebody
        wrote for themselves."""
        self._put(self.student, {'body': 'I did not understand any of this'})
        self.assertEqual(self._get(self.instructor).data, [])

    def test_another_participant_cannot_read_them_either(self):
        self._put(self.student, {'body': 'mine'})
        self.assertEqual(self._get(self.other).data, [])

    def test_writing_again_edits_rather_than_accumulates(self):
        self._put(self.student, {'body': 'first'})
        self._put(self.student, {'body': 'second'})
        rows = self._get(self.student).data
        self.assertEqual(len(rows), 1, 'one row per anchor, upserted')
        self.assertEqual(rows[0]['body'], 'second')

    def test_a_course_note_and_a_lesson_note_are_separate_rows(self):
        self._put(self.student, {'body': 'about the course'})
        self._put(self.student, {'body': 'about Monday', 'lesson': self.lesson.pk})
        rows = self._get(self.student).data
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {r['lesson'] for r in rows},
            {None, self.lesson.pk},
            'the course-level note is the one with no lesson',
        )

    def test_clearing_a_note_deletes_it_rather_than_storing_a_blank(self):
        self._put(self.student, {'body': 'temporary'})
        self.assertEqual(self._put(self.student, {'body': '   '}).status_code, 204)
        self.assertEqual(self._get(self.student).data, [])

    def test_a_lesson_from_another_course_is_refused(self):
        elsewhere = Lesson.objects.create(
            chapter=Chapter.objects.create(
                course=self.make_course(title='Theirs'), title='Theirs'
            ),
            title='Their session',
        )
        res = self._put(self.student, {'body': 'x', 'lesson': elsewhere.pk})
        self.assertEqual(res.status_code, 400)

    def test_notes_need_an_account(self):
        res = APIClient().get(f'/api/courses/{self.course.pk}/notes/')
        self.assertIn(res.status_code, (401, 403))


class AttachmentTests(ApiTestCase):
    """Files a course keeps, with their own page, reviews and thread.

    The line worth holding: an attachment is not corpus. A stranger who can see the public course
    page still cannot read its files, because "last year's exam paper" is not something a course
    publishes to the site.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    @staticmethod
    def _pdf_bytes(size: int) -> bytes:
        """A real PDF signature, padded to the size a test wants.

        `validate_material_submission_file` sniffs the actual bytes with libmagic rather than
        trusting the name or the browser's Content-Type — which is the point of it — so a file of
        `b'xxxx'` called `.pdf` is correctly refused. Padding after a genuine `%PDF-1.4` header
        keeps the fixture honest while letting the quota tests choose a length."""
        header = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
        return header + b'0' * max(0, size - len(header))

    def _upload(self, who=None, name='exam.pdf', size=64):
        return self.as_(who or self.instructor).post(
            f'/api/courses/{self.course.pk}/attachments/',
            {
                'file': SimpleUploadedFile(
                    name, self._pdf_bytes(size), content_type='application/pdf'
                ),
                'title': 'Last year exam',
            },
            format='multipart',
        )

    def test_staff_upload_and_everyone_in_the_room_can_list(self):
        self.assertEqual(self._upload().status_code, 201)
        rows = self.as_(self.student).get(f'/api/courses/{self.course.pk}/attachments/').data
        self.assertEqual([r['title'] for r in rows], ['Last year exam'])
        self.assertTrue(rows[0]['file_url'], 'a link, not a storage path')

    def test_an_outsider_cannot_read_them(self):
        self._upload()
        res = self.as_(self.other).get(f'/api/courses/{self.course.pk}/attachments/')
        self.assertEqual(res.status_code, 404, 'not corpus — membership is required')

    def test_an_unreviewed_attachment_has_no_rating_rather_than_zero(self):
        self._upload()
        rows = self.as_(self.student).get(f'/api/courses/{self.course.pk}/attachments/').data
        self.assertIsNone(rows[0]['average_rating'])
        self.assertEqual(rows[0]['review_count'], 0)

    def test_reviews_are_one_per_person_and_average(self):
        attachment_id = self._upload().data['id']
        base = f'/api/courses/{self.course.pk}/attachments/{attachment_id}/reviews/'
        self.as_(self.student).post(base, {'rating': 4, 'body': 'useful'}, format='json')
        self.as_(self.student).post(base, {'rating': 2}, format='json')  # edits, does not add
        rows = self.as_(self.student).get(base).data
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['rating'], 2)

    def test_an_attachment_has_its_own_thread(self):
        """Its own, not the course's and not a material's — the whole reason it is a separate
        target rather than another comment on the course."""
        attachment_id = self._upload().data['id']
        base = f'/api/courses/{self.course.pk}/attachments/{attachment_id}/comments/'
        self.as_(self.student).post(base, {'body': 'Is task 3 a typo?'}, format='json')

        on_attachment = self.as_(self.student).get(base).data
        self.assertEqual([c['body'] for c in on_attachment], ['Is task 3 a typo?'])

        on_course = self.as_(self.student).get(
            f'/api/courses/{self.course.pk}/comments/'
        ).data
        self.assertEqual(on_course, [], 'the course discussion is a different conversation')

    def test_the_uploader_can_remove_their_own_file(self):
        attachment_id = self._upload(who=self.student).data['id']
        res = self.as_(self.student).delete(
            f'/api/courses/{self.course.pk}/attachments/{attachment_id}/'
        )
        self.assertEqual(res.status_code, 204)

    def test_another_participant_cannot_remove_somebody_elses(self):
        Enrollment.objects.create(course=self.course, participant=self.other, status='active')
        attachment_id = self._upload(who=self.student).data['id']
        res = self.as_(self.other).delete(
            f'/api/courses/{self.course.pk}/attachments/{attachment_id}/'
        )
        self.assertEqual(res.status_code, 404)
        self.assertTrue(Attachment.objects.filter(pk=attachment_id).exists())

    def test_uploads_are_charged_against_the_courses_quota(self):
        """The same cap a Material costs — a per-kind quota would be one somebody could route
        around by choosing the other kind."""
        self.course.upload_quota_bytes = 120
        self.course.save()
        self.assertEqual(self._upload(size=100).status_code, 201)
        refused = self._upload(name='second.pdf', size=100)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data['detail'], 'upload_quota_exceeded')


class LessonDiscussionTests(ApiTestCase):
    """A lesson holds its own conversation, alongside its materials and exercises.

    What matters is that it is not a way around the course's own rules: a course whose discussion is
    off, or participants-only, must not become readable one level down.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon')
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    def _url(self):
        return f'/api/courses/{self.course.pk}/lessons/{self.lesson.pk}/comments/'

    def test_a_participant_posts_and_reads(self):
        posted = self.as_(self.student).post(
            self._url(), {'body': 'Is task 3 a typo?'}, format='json'
        )
        self.assertEqual(posted.status_code, 201)
        rows = self.as_(self.student).get(self._url()).data
        self.assertEqual([c['body'] for c in rows], ['Is task 3 a typo?'])

    def test_the_thread_is_the_lessons_own_not_the_courses(self):
        """The whole point of putting it here: a question about Tuesday stays with Tuesday."""
        self.as_(self.student).post(self._url(), {'body': 'about this lesson'}, format='json')
        on_course = self.as_(self.student).get(f'/api/courses/{self.course.pk}/comments/').data
        self.assertEqual(on_course, [], 'the course-wide thread is a different conversation')

    def test_a_second_lesson_has_its_own_thread(self):
        other = Lesson.objects.create(chapter=self.chapter, title='Tue')
        self.as_(self.student).post(self._url(), {'body': 'monday'}, format='json')
        rows = self.as_(self.student).get(
            f'/api/courses/{self.course.pk}/lessons/{other.pk}/comments/'
        ).data
        self.assertEqual(rows, [])

    def test_a_stranger_cannot_post(self):
        res = self.as_(self.other).post(self._url(), {'body': 'hello'}, format='json')
        self.assertIn(res.status_code, (403, 404))

    def test_discussion_off_closes_the_lesson_thread_too(self):
        """403 rather than the 404 this used to answer.

        The refusal is the same one the course-wide thread has always given, and it used to differ
        here purely because the two actions were written at different times. 403 is also the
        truthful answer: the lesson exists and the course detail says so, so 404 would be a lie the
        caller can disprove, and a client cannot tell "the discussion is closed" from "no such
        lesson" if both come back the same.
        """
        self.course.discussion_mode = 'off'
        self.course.save()
        self.assertEqual(self.as_(self.student).get(self._url()).status_code, 403)

    def test_an_empty_body_is_refused(self):
        res = self.as_(self.student).post(self._url(), {'body': '   '}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_a_lesson_from_another_course_is_not_reachable_here(self):
        elsewhere = Lesson.objects.create(
            chapter=Chapter.objects.create(
                course=self.make_course(title='Theirs'), title='Theirs'
            ),
            title='Their session',
        )
        res = self.as_(self.student).get(
            f'/api/courses/{self.course.pk}/lessons/{elsewhere.pk}/comments/'
        )
        self.assertEqual(res.status_code, 404)


class ItemFilingTests(ApiTestCase):
    """Where a piece of content sits, and what may be linked in the first place.

    An item files into a lesson OR straight into a chapter, and references exactly one of four
    kinds. Both halves are easy to get wrong in ways that fail quietly — a filing target the server
    ignores looks identical to one it honoured until somebody reloads the page — so these pin the
    refusals rather than the happy path.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Tydzień 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Wtorek')
        self.material = self.make_material('skrypt', 'Skrypt')

    def _attachment(self, course=None):
        return Attachment.objects.create(
            course=course or self.course,
            title='Kolokwium 2023',
            file=SimpleUploadedFile('k.pdf', b'%PDF-1.4 test', content_type='application/pdf'),
            uploaded_by=self.instructor,
        )

    def _event(self, status='published', host=None):
        return Event.objects.create(
            host=host or self.instructor,
            title='Wykład gościnny',
            status=status,
            starts_at=timezone.now() + timedelta(days=3),
            location_kind='online',
            online_url='https://example.org/talk',
        )

    # --- filing into a chapter, which used to be silently dropped ---------------------------------

    def test_an_item_can_be_filed_straight_into_a_chapter(self):
        """The regression this feature exists for.

        `chapter` was absent from the write serializer's field list, so DRF discarded it without a
        word: the contribute form offered a chapter picker, and every item it created landed
        unfiled. A 201 proved nothing, which is why this asserts the stored row.
        """
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': self.material.pk, 'chapter': self.chapter.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['chapter'], self.chapter.pk)
        item = CourseItem.objects.get(pk=response.data['id'])
        self.assertEqual(item.chapter_id, self.chapter.pk)
        self.assertIsNone(item.lesson_id)

    def test_an_item_cannot_be_filed_into_a_lesson_and_a_chapter_at_once(self):
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {
                'material': self.material.pk,
                'chapter': self.chapter.pk,
                'lesson': self.lesson.pk,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CourseItem.objects.count(), 0)

    def test_a_chapter_from_another_course_is_refused(self):
        elsewhere = Chapter.objects.create(
            course=self.make_course(title='Inny kurs'), title='Nie ten'
        )
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': self.material.pk, 'chapter': elsewhere.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('chapter', response.data)

    def test_participant_notes_survive_the_nested_chapter_shape(self):
        """A second pre-existing bug, found while checking that a new lesson's notes were stored.

        `CourseSerializer.get_lessons` worked out `is_participant` and passed it down, but
        `ChapterSerializer.get_lessons` handed on a context that never contained it — so in the
        chapter -> lesson shape the course page actually renders, every lesson's notes were blank for
        everybody, including the staff who wrote them. The flat list was right and the nested one was
        not, which is why it survived: both exist on the same response.
        """
        self.lesson.participant_notes = 'Bring the worksheet.'
        self.lesson.save(update_fields=['participant_notes'])

        staff = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        nested = staff.data['chapters'][0]['lessons'][0]
        self.assertEqual(nested['participant_notes'], 'Bring the worksheet.')

        Enrollment.objects.create(
            course=self.course, participant=self.student, status='active'
        )
        joined = self.as_(self.student).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(
            joined.data['chapters'][0]['lessons'][0]['participant_notes'],
            'Bring the worksheet.',
        )

        # And still withheld from somebody who is not in the course — the fix must not open it up.
        outsider = self.as_(self.other).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(outsider.data['chapters'][0]['lessons'][0]['participant_notes'], '')

    def test_a_course_holding_any_item_still_renders(self):
        """A pre-existing 500, fixed here as a side effect and pinned so it cannot come back.

        `CourseSerializer.get_unfiled_items` already filtered on `item.chapter_id` while `CourseItem`
        had no such field, so reading it raised `AttributeError` — a 500 on the course detail of ANY
        course containing content. It survived because the expression sits inside a loop over the
        course's items: with none, the body never runs, and every fixture that had items reached them
        through `/items/` rather than the course itself. Reproduced against the running server before
        fixing: 200 with no items, 500 the moment one existed.
        """
        CourseItem.objects.create(course=self.course, material=self.material)
        response = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([i['label'] for i in response.data['unfiled_items']], ['Skrypt'])

    def test_a_filed_item_is_not_also_reported_as_unfiled(self):
        """Filed either way is filed. Reporting it as unfiled draws it twice on the page — once where
        it belongs and once in the loose pile underneath.

        The lesson half is a real bug this caught: `get_unfiled_items` tested `chapter_id is None`
        alone, and a lesson-filed row genuinely has no chapter, so every lesson's contents were
        duplicated into the unfiled list. Found by looking at the rendered page, not by an assertion.
        """
        CourseItem.objects.create(
            course=self.course, chapter=self.chapter, material=self.material
        )
        other = self.make_material('zadania', 'Zadania')
        CourseItem.objects.create(course=self.course, lesson=self.lesson, material=other)

        response = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(response.data['unfiled_items'], [])

        # And something genuinely filed nowhere still shows up there.
        loose = self.make_material('luzem', 'Luzem')
        CourseItem.objects.create(course=self.course, material=loose)
        again = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual([i['label'] for i in again.data['unfiled_items']], ['Luzem'])

    def test_a_chapter_filed_item_is_returned_on_its_chapter(self):
        CourseItem.objects.create(
            course=self.course, chapter=self.chapter, material=self.material
        )
        response = self.client.get(f'/api/courses/{self.course.pk}/')
        chapter = response.data['chapters'][0]
        self.assertEqual([i['label'] for i in chapter['items']], ['Skrypt'])

    # --- the lock reaches an item filed one level up ----------------------------------------------

    def test_a_locked_chapter_hides_its_own_items_from_a_participant_but_not_from_staff(self):
        """Filing one level up must not be a way around the lock.

        The gate is a statement about the week; an item that escaped it by sitting on the chapter
        rather than in a lesson would make the whole thing worthless.
        """
        self.chapter.unlocks_at = timezone.now() + timedelta(days=7)
        self.chapter.save(update_fields=['unlocks_at'])
        CourseItem.objects.create(
            course=self.course, chapter=self.chapter, material=self.material
        )
        Enrollment.objects.create(
            course=self.course, participant=self.student, status='active'
        )

        theirs = self.as_(self.student).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(theirs.data['chapters'][0]['items'], [])
        # And it is still listed as a chapter, with its date — the course must not look shorter.
        self.assertFalse(theirs.data['chapters'][0]['is_unlocked'])

        staff = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(len(staff.data['chapters'][0]['items']), 1)

    # --- the two new kinds ------------------------------------------------------------------------

    def test_a_course_file_can_be_linked_into_a_lesson(self):
        attachment = self._attachment()
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'attachment': attachment.pk, 'lesson': self.lesson.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['kind'], 'attachment')
        self.assertEqual(response.data['label'], 'Kolokwium 2023')

    def test_another_courses_file_is_refused(self):
        """An attachment is deliberately not discoverable outside its own course, so linking one in
        would publish it to a roster it was never shared with."""
        elsewhere = self._attachment(course=self.make_course(title='Inny kurs'))
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'attachment': elsewhere.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('attachment', response.data)

    def test_an_event_can_be_linked_into_a_chapter(self):
        event = self._event()
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'event': event.pk, 'chapter': self.chapter.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['kind'], 'event')
        self.assertEqual(response.data['label'], 'Wykład gościnny')

    def test_somebody_elses_published_event_can_be_linked(self):
        """Not an ownership check on purpose: pointing a course at somebody else's guest lecture is
        the normal case, not an error."""
        event = self._event(host=self.other)
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', {'event': event.pk}, format='json'
        )
        self.assertEqual(response.status_code, 201)

    def test_a_draft_event_is_refused(self):
        """It is not announced yet — linking it would publish somebody's unfinished plan."""
        event = self._event(status='draft')
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', {'event': event.pk}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('event', response.data)

    def test_exactly_one_kind_is_required(self):
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', {}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CourseItem.objects.count(), 0)

    def test_two_kinds_at_once_are_refused(self):
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': self.material.pk, 'event': self._event().pk},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_the_same_event_cannot_be_linked_twice(self):
        event = self._event()
        first = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', {'event': event.pk}, format='json'
        )
        self.assertEqual(first.status_code, 201)
        again = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', {'event': event.pk}, format='json'
        )
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['detail'], 'already_in_course')

    # --- reorder must not leave a row holding both targets ----------------------------------------

    def test_dragging_a_chapter_filed_item_into_a_lesson_clears_its_chapter(self):
        """Otherwise the row holds both, which the database refuses outright — a 500 on a drag."""
        item = CourseItem.objects.create(
            course=self.course, chapter=self.chapter, material=self.material
        )
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'item', 'groups': {str(self.lesson.pk): [item.pk]}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.lesson_id, self.lesson.pk)
        self.assertIsNone(item.chapter_id)


class LessonExerciseSetTests(ApiTestCase):
    """A whole ExerciseSet pinned into a lesson.

    The property nearly every test here exists to hold is that the pin is a PIN: an `ExerciseSet`
    belongs to one person, who may have no role on this course, and the lesson's homework must not
    change because they edited their own list. So the ones that matter are the negatives — the
    source edited, unshared, emptied or deleted, and the lesson unmoved through all four.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Tydzień 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Wtorek')
        self.participant = self.student
        Enrollment.objects.create(
            course=self.course, participant=self.participant, status='active'
        )
        self.first = make_exercise(self.subject, 1)
        self.second = make_exercise(self.subject, 2)

    def make_set(self, owner=None, *, name='Kolokwium 2', exercises=None, is_public=True):
        exercise_set = ExerciseSet.objects.create(
            owner=owner or self.instructor, name=name, is_public=is_public
        )
        for order, exercise in enumerate(exercises if exercises is not None else [self.first, self.second]):
            ExerciseSetItem.objects.create(
                exercise_set=exercise_set, exercise=exercise, order=order
            )
        return exercise_set

    def link_url(self, lesson=None):
        return (
            f'/api/courses/{self.course.pk}/lessons/{(lesson or self.lesson).pk}/exercise-sets/'
        )

    def link(self, exercise_set, as_user=None):
        return self.as_(as_user or self.instructor).post(
            self.link_url(), {'set': exercise_set.slug}, format='json'
        )

    # --- linking ---------------------------------------------------------------------------------

    def test_a_curator_links_their_own_private_set(self):
        """Private is fine when it is YOUR set: publishing it to your own course is the decision
        you are making, and there is no third party to surprise."""
        exercise_set = self.make_set(is_public=False)
        response = self.link(exercise_set)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['title'], 'Kolokwium 2')
        self.assertEqual(
            [row['exercise'] for row in response.data['exercises']],
            [self.first.pk, self.second.pk],
        )

    def test_somebody_elses_shared_set_can_be_linked(self):
        exercise_set = self.make_set(owner=self.other)
        self.assertEqual(self.link(exercise_set).status_code, 201)

    def test_somebody_elses_private_set_cannot_be_linked(self):
        """Reported as missing rather than forbidden — for this caller it genuinely is."""
        exercise_set = self.make_set(owner=self.other, is_public=False)
        response = self.link(exercise_set)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LessonExerciseSet.objects.count(), 0)

    def test_an_unknown_slug_is_refused(self):
        response = self.as_(self.instructor).post(
            self.link_url(), {'set': 'no-such-set'}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_an_empty_set_is_refused(self):
        """Pinning nothing records a decision with no content in it, and the curator would have to
        notice the empty block to learn that nothing happened."""
        response = self.link(self.make_set(exercises=[]))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LessonExerciseSet.objects.count(), 0)

    def test_the_same_set_cannot_be_linked_to_one_lesson_twice(self):
        exercise_set = self.make_set()
        self.assertEqual(self.link(exercise_set).status_code, 201)
        again = self.link(exercise_set)
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['detail'], 'already_linked')

    def test_a_participant_cannot_link_a_set(self):
        response = self.link(self.make_set(owner=self.participant), as_user=self.participant)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(LessonExerciseSet.objects.count(), 0)

    def test_an_anonymous_visitor_cannot_link_a_set(self):
        exercise_set = self.make_set()
        response = self.client.post(
            self.link_url(), {'set': exercise_set.slug}, format='json'
        )
        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(LessonExerciseSet.objects.count(), 0)

    def test_a_lesson_from_another_course_is_not_reachable_here(self):
        other_course = self.make_course(title='Inny kurs')
        other_lesson = Lesson.objects.create(
            chapter=Chapter.objects.create(course=other_course, title='T1'), title='Środa'
        )
        response = self.as_(self.instructor).post(
            self.link_url(other_lesson), {'set': self.make_set().slug}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    # --- the pin holds ----------------------------------------------------------------------------

    def test_editing_the_source_set_afterwards_does_not_change_the_lesson(self):
        """The whole decision, in one test. The set's owner is not course staff, and a lesson whose
        homework changed because they edited their own list would be a permission hole."""
        exercise_set = self.make_set(owner=self.other)
        self.link(exercise_set)
        exercise_set.exercisesetitem_set.filter(exercise=self.second).delete()
        ExerciseSetItem.objects.create(
            exercise_set=exercise_set, exercise=make_exercise(self.subject, 3), order=9
        )

        response = self.client.get(self.link_url())
        self.assertEqual(
            [row['exercise'] for row in response.data[0]['exercises']],
            [self.first.pk, self.second.pk],
        )

    def test_deleting_the_source_set_leaves_the_homework_standing(self):
        exercise_set = self.make_set(owner=self.other)
        self.link(exercise_set)
        exercise_set.delete()

        response = self.client.get(self.link_url())
        self.assertEqual(len(response.data), 1)
        self.assertEqual(len(response.data[0]['exercises']), 2)
        self.assertFalse(response.data[0]['source_exists'])
        self.assertEqual(response.data[0]['title'], 'Kolokwium 2')

    def test_unsharing_the_source_does_not_hide_the_linked_set(self):
        exercise_set = self.make_set(owner=self.other)
        self.link(exercise_set)
        exercise_set.is_public = False
        exercise_set.save(update_fields=['is_public'])

        response = self.client.get(self.link_url())
        self.assertEqual(len(response.data[0]['exercises']), 2)

    # --- re-copying, which is how liveness stays under the course's control ------------------------

    def test_refresh_takes_the_sources_current_list(self):
        exercise_set = self.make_set(owner=self.other)
        created = self.link(exercise_set)
        third = make_exercise(self.subject, 3)
        ExerciseSetItem.objects.create(exercise_set=exercise_set, exercise=third, order=2)

        response = self.as_(self.instructor).patch(
            f'{self.link_url()}{created.data["id"]}/', {'refresh': True}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row['exercise'] for row in response.data['exercises']],
            [self.first.pk, self.second.pk, third.pk],
        )
        self.assertIsNotNone(response.data['refreshed_at'])

    def test_a_participant_cannot_refresh(self):
        created = self.link(self.make_set())
        response = self.as_(self.participant).patch(
            f'{self.link_url()}{created.data["id"]}/', {'refresh': True}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    def test_refresh_is_refused_once_the_source_is_unshared(self):
        """Re-checked rather than trusted from link time: re-copying from a list its owner has since
        withdrawn would pull content back out of something they closed."""
        exercise_set = self.make_set(owner=self.other)
        created = self.link(exercise_set)
        exercise_set.is_public = False
        exercise_set.save(update_fields=['is_public'])

        response = self.as_(self.instructor).patch(
            f'{self.link_url()}{created.data["id"]}/', {'refresh': True}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'source_not_shared')

    def test_refresh_is_refused_once_the_source_is_gone(self):
        exercise_set = self.make_set(owner=self.other)
        created = self.link(exercise_set)
        exercise_set.delete()

        response = self.as_(self.instructor).patch(
            f'{self.link_url()}{created.data["id"]}/', {'refresh': True}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'source_gone')

    def test_drift_is_reported_to_a_curator_and_to_nobody_else(self):
        """A participant cannot re-copy and the source is somebody else's private list, so the
        answer is not theirs to have."""
        exercise_set = self.make_set(owner=self.other)
        self.link(exercise_set)
        ExerciseSetItem.objects.create(
            exercise_set=exercise_set, exercise=make_exercise(self.subject, 3), order=2
        )

        curator = self.as_(self.instructor).get(self.link_url())
        self.assertTrue(curator.data[0]['has_drifted'])
        participant = self.as_(self.participant).get(self.link_url())
        self.assertFalse(participant.data[0]['has_drifted'])

    # --- unlinking and editing --------------------------------------------------------------------

    def test_unlinking_removes_the_link_and_leaves_the_source_alone(self):
        exercise_set = self.make_set()
        created = self.link(exercise_set)
        response = self.as_(self.instructor).delete(f'{self.link_url()}{created.data["id"]}/')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(LessonExerciseSet.objects.count(), 0)
        self.assertEqual(ExerciseSet.objects.filter(pk=exercise_set.pk).count(), 1)

    def test_a_participant_cannot_unlink(self):
        created = self.link(self.make_set())
        response = self.as_(self.participant).delete(f'{self.link_url()}{created.data["id"]}/')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(LessonExerciseSet.objects.count(), 1)

    def test_the_title_can_be_rewritten_and_may_not_be_emptied(self):
        created = self.link(self.make_set())
        url = f'{self.link_url()}{created.data["id"]}/'
        renamed = self.as_(self.instructor).patch(
            url, {'title': 'Praca domowa 3'}, format='json'
        )
        self.assertEqual(renamed.data['title'], 'Praca domowa 3')
        blanked = self.as_(self.instructor).patch(url, {'title': '   '}, format='json')
        self.assertEqual(blanked.status_code, 400)

    # --- visibility -------------------------------------------------------------------------------

    def test_a_locked_chapter_hides_its_linked_sets_from_a_participant_but_not_from_staff(self):
        self.link(self.make_set())
        self.chapter.unlocks_at = timezone.now() + timedelta(days=7)
        self.chapter.save(update_fields=['unlocks_at'])

        self.assertEqual(len(self.as_(self.participant).get(self.link_url()).data), 0)
        self.assertEqual(len(self.as_(self.instructor).get(self.link_url()).data), 1)

    def test_a_locked_chapter_does_not_leak_through_the_flat_lessons_list(self):
        """The flat `lessons` field used to return every lesson regardless of its chapter's lock.

        This test was written when that was still true, and asserted the narrower thing that was
        then available: that `exercise_sets` filtered itself even though its caller did not. The
        caller is fixed now, so the honest assertion is the stronger one — a locked week's lesson is
        not in the flat list at all. `get_exercise_sets` still filters independently, which
        `test_a_locked_chapter_hides_its_linked_sets_from_a_participant_but_not_from_staff` covers
        directly; belt and braces both stay.
        """
        self.link(self.make_set())
        self.chapter.unlocks_at = timezone.now() + timedelta(days=7)
        self.chapter.save(update_fields=['unlocks_at'])

        response = self.as_(self.participant).get(f'/api/courses/{self.course.pk}/')
        flat = [lesson for lesson in response.data['lessons'] if lesson['id'] == self.lesson.pk]
        self.assertEqual(flat, [], 'a locked week is not in the flat lesson list')
        staff = self.as_(self.instructor).get(f'/api/courses/{self.course.pk}/')
        self.assertTrue(
            [lesson for lesson in staff.data['lessons'] if lesson['id'] == self.lesson.pk],
            'staff still see it — they are the people preparing it',
        )

    def test_an_unpublished_exercise_is_dropped_for_a_participant_and_kept_for_a_curator(self):
        """A moderator unpublishes an exercise when something is wrong with it, usually its
        solution — the last thing that should stay sitting in somebody's homework. The curator keeps
        seeing it because they are the person who can replace it."""
        self.link(self.make_set())
        self.second.published = False
        self.second.save(update_fields=['published'])

        participant = self.as_(self.participant).get(self.link_url()).data[0]
        self.assertEqual([row['exercise'] for row in participant['exercises']], [self.first.pk])
        self.assertEqual(participant['hidden_exercise_count'], 1)

        curator = self.as_(self.instructor).get(self.link_url()).data[0]
        self.assertEqual(len(curator['exercises']), 2)
        self.assertEqual(curator['hidden_exercise_count'], 0)

    # --- reordering -------------------------------------------------------------------------------

    def test_linked_sets_take_the_order_they_are_given(self):
        first = self.link(self.make_set(name='A')).data['id']
        second = self.link(self.make_set(name='B', exercises=[self.first])).data['id']
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {str(self.lesson.pk): [second, first]}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row['id'] for row in self.client.get(self.link_url()).data], [second, first]
        )

    def test_a_linked_set_from_another_course_cannot_be_reordered_into_this_one(self):
        other_course = self.make_course(title='Inny kurs')
        other_lesson = Lesson.objects.create(
            chapter=Chapter.objects.create(course=other_course, title='T1'), title='Środa'
        )
        stray = LessonExerciseSet.objects.create(lesson=other_lesson, title='Nie ten kurs')
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {str(self.lesson.pk): [stray.pk]}},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        stray.refresh_from_db()
        self.assertEqual(stray.lesson_id, other_lesson.pk)

    def test_a_linked_set_cannot_be_left_without_a_lesson(self):
        """`LessonExerciseSet.lesson` is NOT NULL, so the unfiled group has no meaning here — and
        refusing it up front beats an IntegrityError from the save."""
        created = self.link(self.make_set()).data['id']
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {'': [created]}},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_a_participant_cannot_reorder_linked_sets(self):
        created = self.link(self.make_set()).data['id']
        response = self.as_(self.participant).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {str(self.lesson.pk): [created]}},
            format='json',
        )
        self.assertEqual(response.status_code, 404)


class CourseThreadFixture(ApiTestCase):
    """One course with a chapter, a lesson and an enrolled student — shared by the three classes
    below, which all need exactly this and nothing more."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon')
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    def lesson_thread(self, lesson=None):
        return f'/api/courses/{self.course.pk}/lessons/{(lesson or self.lesson).pk}/comments/'

    def chapter_thread(self, chapter=None):
        return f'/api/courses/{self.course.pk}/chapters/{(chapter or self.chapter).pk}/comments/'

    def lock(self, chapter=None):
        target = chapter or self.chapter
        target.unlocks_at = timezone.now() + timedelta(days=7)
        target.save(update_fields=['unlocks_at'])


class LessonThreadParentTests(CourseThreadFixture):
    """The lesson thread used to build its `Comment` by hand, passing `parent_id` straight from the
    request body — so a reply could name a comment in a different thread entirely and silently
    attach there, and a made-up id was an unhandled IntegrityError rather than a 400. It goes
    through the shared helper now; these pin what that bought."""

    def test_a_reply_threads(self):
        root = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'why is step 3 like that'}, format='json'
        ).data
        reply = self.as_(self.instructor).post(
            self.lesson_thread(), {'body': 'typo, fixed', 'parent': root['id']}, format='json'
        )
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.data['parent'], root['id'])

    def test_a_parent_from_another_lessons_thread_is_refused(self):
        other = Lesson.objects.create(chapter=self.chapter, title='Tue')
        elsewhere = self.as_(self.student).post(
            self.lesson_thread(other), {'body': 'about tuesday'}, format='json'
        ).data
        res = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'sneaking in', 'parent': elsewhere['id']}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('parent', res.data)

    def test_a_parent_from_the_courses_own_thread_is_refused(self):
        """Same id space, different content type — the check has to compare both."""
        on_course = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': 'course-wide'}, format='json'
        ).data
        res = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'nope', 'parent': on_course['id']}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_a_parent_that_does_not_exist_is_a_400_not_a_500(self):
        res = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'hi', 'parent': 999999}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class ChapterDiscussionTests(CourseThreadFixture):
    """A week's own conversation, separate from any one session inside it."""

    def test_a_participant_posts_and_reads(self):
        posted = self.as_(self.student).post(
            self.chapter_thread(), {'body': 'how should we approach this week?'}, format='json'
        )
        self.assertEqual(posted.status_code, 201)
        rows = self.as_(self.student).get(self.chapter_thread()).data
        self.assertEqual([c['body'] for c in rows], ['how should we approach this week?'])

    def test_it_is_not_the_lessons_thread_and_not_the_courses(self):
        self.as_(self.student).post(self.chapter_thread(), {'body': 'week'}, format='json')
        self.assertEqual(self.as_(self.student).get(self.lesson_thread()).data, [])
        self.assertEqual(
            self.as_(self.student).get(f'/api/courses/{self.course.pk}/comments/').data, []
        )

    def test_a_second_chapter_has_its_own_thread(self):
        other = Chapter.objects.create(course=self.course, title='Week 2')
        self.as_(self.student).post(self.chapter_thread(), {'body': 'week one'}, format='json')
        self.assertEqual(self.as_(self.student).get(self.chapter_thread(other)).data, [])

    def test_discussion_off_closes_it(self):
        self.course.discussion_mode = 'off'
        self.course.save()
        self.assertEqual(self.as_(self.student).get(self.chapter_thread()).status_code, 403)

    def test_a_stranger_cannot_post(self):
        res = self.as_(self.other).post(self.chapter_thread(), {'body': 'hello'}, format='json')
        self.assertIn(res.status_code, (403, 404))

    def test_a_locked_week_hides_its_conversation_from_a_participant_not_from_staff(self):
        """A locked chapter still shows its title and unlock date; its discussion is contents."""
        self.lock()
        self.assertEqual(self.as_(self.student).get(self.chapter_thread()).status_code, 404)
        self.assertEqual(self.as_(self.instructor).get(self.chapter_thread()).status_code, 200)

    def test_a_chapter_from_another_course_is_not_reachable_here(self):
        elsewhere = Chapter.objects.create(course=self.make_course(title='Theirs'), title='Theirs')
        res = self.as_(self.student).get(self.chapter_thread(elsewhere))
        self.assertEqual(res.status_code, 404)

    def test_a_parent_from_a_different_chapter_is_refused(self):
        other = Chapter.objects.create(course=self.course, title='Week 2')
        elsewhere = self.as_(self.student).post(
            self.chapter_thread(other), {'body': 'week two'}, format='json'
        ).data
        res = self.as_(self.student).post(
            self.chapter_thread(), {'body': 'no', 'parent': elsewhere['id']}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class LessonAndChapterReviewTests(CourseThreadFixture):
    """Ratings on a session and on a week. Deliberately two models: "Tuesday was unclear" and
    "week 3 was worth it" are different judgements."""

    def lesson_reviews(self):
        return f'/api/courses/{self.course.pk}/lessons/{self.lesson.pk}/reviews/'

    def chapter_reviews(self):
        return f'/api/courses/{self.course.pk}/chapters/{self.chapter.pk}/reviews/'

    def test_a_participant_rates_a_lesson(self):
        res = self.as_(self.student).post(
            self.lesson_reviews(), {'rating': 4, 'body': 'clear enough'}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(LessonReview.objects.count(), 1)

    def test_rating_again_edits_rather_than_duplicating(self):
        self.as_(self.student).post(self.lesson_reviews(), {'rating': 2}, format='json')
        self.as_(self.student).post(self.lesson_reviews(), {'rating': 5}, format='json')
        self.assertEqual(LessonReview.objects.count(), 1)
        self.assertEqual(LessonReview.objects.get().rating, 5)

    def test_a_rating_outside_one_to_five_is_refused(self):
        for bad in (0, 6):
            res = self.as_(self.student).post(
                self.lesson_reviews(), {'rating': bad}, format='json'
            )
            self.assertEqual(res.status_code, 400, f'{bad} should be refused')

    def test_somebody_not_in_the_course_cannot_rate_it(self):
        """Reading a public course is open to the internet; rating a session in it is not."""
        res = self.as_(self.other).post(self.lesson_reviews(), {'rating': 5}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_anonymous_cannot_rate(self):
        res = self.client.post(self.lesson_reviews(), {'rating': 5}, format='json')
        self.assertIn(res.status_code, (401, 403))

    def test_a_chapter_review_is_a_different_thing_from_a_lesson_review(self):
        self.as_(self.student).post(self.lesson_reviews(), {'rating': 1}, format='json')
        self.as_(self.student).post(self.chapter_reviews(), {'rating': 5}, format='json')
        self.assertEqual(LessonReview.objects.get().rating, 1)
        self.assertEqual(ChapterReview.objects.get().rating, 5)

    def test_the_course_detail_carries_the_summary(self):
        self.as_(self.student).post(self.lesson_reviews(), {'rating': 4}, format='json')
        self.as_(self.instructor).post(self.lesson_reviews(), {'rating': 2}, format='json')
        detail = self.as_(self.student).get(f'/api/courses/{self.course.pk}/').data
        lesson = detail['chapters'][0]['lessons'][0]
        self.assertEqual(lesson['reviews'], {'count': 2, 'average': 3.0})

    def test_an_unrated_lesson_reports_no_average_rather_than_zero(self):
        """Zero would read as "everybody hated it" instead of "nobody has said"."""
        detail = self.as_(self.student).get(f'/api/courses/{self.course.pk}/').data
        self.assertEqual(detail['chapters'][0]['lessons'][0]['reviews'],
                         {'count': 0, 'average': None})

    def test_a_locked_week_hides_its_ratings_from_a_participant_not_from_staff(self):
        self.lock()
        self.assertEqual(self.as_(self.student).get(self.chapter_reviews()).status_code, 404)
        self.assertEqual(self.as_(self.instructor).get(self.chapter_reviews()).status_code, 200)

    def test_a_review_body_is_sanitized_on_the_way_in(self):
        self.as_(self.student).post(
            self.lesson_reviews(),
            {'rating': 3, 'body': 'fine <script>alert(1)</script>'},
            format='json',
        )
        self.assertNotIn('<script>', LessonReview.objects.get().body)


class LessonAndChapterMarkdownTests(CourseThreadFixture):
    """These three fields render as Markdown now. They were safe while Svelte printed them through
    escaping braces — nothing could leave a text node — so the server-side pass had to land in the
    same change as the rendering rather than after it."""

    def test_a_script_tag_in_a_lesson_description_does_not_survive(self):
        lesson = Lesson.objects.create(
            chapter=self.chapter, title='X', description='hi <script>alert(1)</script>'
        )
        self.assertNotIn('<script>', lesson.description)
        self.assertIn('hi', lesson.description)

    def test_participant_notes_are_sanitized_too(self):
        lesson = Lesson.objects.create(
            chapter=self.chapter,
            title='X',
            participant_notes='<img src=x onerror=alert(1)>notes',
        )
        self.assertNotIn('onerror', lesson.participant_notes)

    def test_a_chapter_description_is_sanitized(self):
        chapter = Chapter.objects.create(
            course=self.course, title='W', description='<iframe src="evil"></iframe>week'
        )
        self.assertNotIn('<iframe', chapter.description)

    def test_ordinary_markdown_is_left_alone(self):
        """The sanitizer must not eat the feature it is protecting: a link and emphasis are the
        two things somebody writing a lesson description will actually type."""
        body = 'see [the notes](https://example.edu/notes.pdf) and **bring a calculator**'
        lesson = Lesson.objects.create(chapter=self.chapter, title='X', description=body)
        self.assertEqual(lesson.description, body)

    def test_latex_survives(self):
        """Course text goes through the same renderer as an exercise, so a formula in a lesson
        description has to come out the other side intact."""
        body = r'integrate \( \int_0^1 x^2 dx \) before Tuesday'
        lesson = Lesson.objects.create(chapter=self.chapter, title='X', description=body)
        self.assertEqual(lesson.description, body)


class LessonProgressTests(CourseThreadFixture):
    """How far people have got, and — mostly — who is allowed to know.

    Weighted towards the refusals and the promises rather than the happy path: the interesting
    claims this feature makes are "off blinds staff too", "a count that identifies somebody is not
    anonymity", and "staff never mark you complete", and every one of those is silent when it
    breaks.
    """

    def setUp(self):
        super().setUp()
        # A third and fourth person, so `shared_anonymous` has a cohort big enough to hide anybody
        # in. `self.student` is already enrolled by the fixture.
        self.second = User.objects.create_user('ania', 'ania@x.example', 'pw12345!')
        self.third = User.objects.create_user('piotr', 'piotr@x.example', 'pw12345!')
        for user in (self.second, self.third):
            Enrollment.objects.create(course=self.course, participant=user, status='active')

    def url(self, lesson=None):
        return f'/api/courses/{self.course.pk}/lessons/{(lesson or self.lesson).pk}/progress/'

    def set_mode(self, mode):
        self.course.progress_visibility = mode
        self.course.save(update_fields=['progress_visibility'])

    def record(self, user, state='done', lesson=None):
        return self.as_(user).put(self.url(lesson), {'status': state}, format='json')

    # --- recording your own ---------------------------------------------------------------------

    def test_a_participant_records_their_own_progress(self):
        res = self.record(self.student)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['mine'], 'done')
        self.assertEqual(LessonProgress.objects.count(), 1)

    def test_recording_twice_updates_rather_than_duplicating(self):
        self.record(self.student, 'in_progress')
        res = self.record(self.student, 'stuck')
        self.assertEqual(res.data['mine'], 'stuck')
        self.assertEqual(LessonProgress.objects.count(), 1)

    def test_resetting_deletes_the_row_rather_than_storing_a_fourth_value(self):
        """"Not started" is the absence of a row — one representation, so nothing has to reconcile
        two. If this ever starts storing `not_started`, the counts gain a second source of truth."""
        self.record(self.student)
        res = self.record(self.student, 'not_started')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['mine'])
        self.assertEqual(LessonProgress.objects.count(), 0)

    def test_an_invented_status_is_refused(self):
        res = self.record(self.student, 'nearly')
        self.assertEqual(res.status_code, 400)
        self.assertIn('status', res.data)
        self.assertEqual(LessonProgress.objects.count(), 0)

    def test_staff_cannot_record_progress(self):
        """Deliberate, not an oversight: a progress row is the participant speaking about
        themselves. An instructor writing into it would make "3 of 6 have finished" a claim that
        somebody in the 3 never made."""
        res = self.record(self.instructor)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(LessonProgress.objects.count(), 0)

    def test_somebody_not_in_the_course_cannot_record(self):
        res = self.record(self.other)
        self.assertEqual(res.status_code, 403)

    def test_anonymous_cannot_record(self):
        res = self.client.put(self.url(), {'status': 'done'}, format='json')
        self.assertIn(res.status_code, (401, 403))

    def test_a_locked_chapters_lesson_is_not_trackable(self):
        """The chapter's lock reaches progress like everything else inside it — 404, matching what
        its thread and its ratings already answer."""
        self.lock()
        self.assertEqual(self.record(self.student).status_code, 404)
        self.assertEqual(self.as_(self.student).get(self.url()).status_code, 404)

    # --- off ------------------------------------------------------------------------------------

    def test_off_blinds_the_instructor_too(self):
        """The whole point of the setting. A version of "off" that still showed staff everything
        would make the promise to participants untrue."""
        self.record(self.student)
        self.set_mode('off')
        self.assertEqual(self.as_(self.instructor).get(self.url()).status_code, 403)
        self.assertEqual(self.as_(self.student).get(self.url()).status_code, 403)

    def test_off_refuses_writes(self):
        self.set_mode('off')
        self.assertEqual(self.record(self.student).status_code, 403)

    def test_off_retains_the_rows_it_hides(self):
        """Turning it back on restores the history rather than having destroyed it."""
        self.record(self.student)
        self.set_mode('off')
        self.assertEqual(LessonProgress.objects.count(), 1)
        self.set_mode('shared_anonymous')
        self.assertEqual(self.as_(self.student).get(self.url()).data['mine'], 'done')

    # --- private --------------------------------------------------------------------------------

    def test_private_shows_you_your_own_and_nothing_else(self):
        self.record(self.student)
        self.record(self.second, 'stuck')
        self.set_mode('private')
        body = self.as_(self.student).get(self.url()).data
        self.assertEqual(body['mine'], 'done')
        self.assertIsNone(body['summary'])
        self.assertIsNone(body['people'])

    def test_private_is_private_from_staff_as_well(self):
        """"Private" that the people running the course can read is not what the word says."""
        self.record(self.student)
        self.set_mode('private')
        body = self.as_(self.instructor).get(self.url()).data
        self.assertIsNone(body['summary'])
        self.assertIsNone(body['people'])
        self.assertIsNone(body['mine'])

    # --- shared_anonymous -----------------------------------------------------------------------

    def test_a_participant_sees_counts_but_no_names(self):
        self.record(self.student)
        self.record(self.second, 'stuck')
        body = self.as_(self.third).get(self.url()).data
        self.assertEqual(body['summary']['done'], 1)
        self.assertEqual(body['summary']['stuck'], 1)
        self.assertEqual(body['summary']['not_started'], 1)
        self.assertEqual(body['summary']['participants'], 3)
        self.assertIsNone(body['people'])

    def test_staff_see_names_even_when_participants_do_not(self):
        """Somebody has to be able to act on "one person is stuck". The anonymity is a promise made
        to the room, not to the person teaching it."""
        self.record(self.second, 'stuck')
        body = self.as_(self.instructor).get(self.url()).data
        stuck = [row for row in body['people'] if row['status'] == 'stuck']
        self.assertEqual([row['participant']['display_name'] for row in stuck], ['ania'])

    def test_a_cohort_too_small_to_hide_anybody_is_told_so(self):
        """With one other participant, "1 done" plus the knowledge that it was not you names them.
        Withheld and explained, rather than a number that quietly identifies somebody."""
        Enrollment.objects.filter(course=self.course, participant=self.third).update(status='left')
        self.record(self.second)
        body = self.as_(self.student).get(self.url()).data
        self.assertEqual(body['withheld_reason'], 'small_cohort')
        self.assertIsNone(body['summary'])

    def test_the_small_cohort_guard_does_not_apply_to_staff(self):
        """They see names in this mode anyway, so withholding a count would hide nothing from them
        and would only make the course page wrong."""
        Enrollment.objects.filter(course=self.course, participant=self.third).update(status='left')
        self.record(self.second)
        body = self.as_(self.instructor).get(self.url()).data
        self.assertIsNone(body['withheld_reason'])
        self.assertEqual(body['summary']['done'], 1)

    def test_the_guard_does_not_apply_where_nothing_was_promised(self):
        """`shared_named` names everybody by design, so there is no anonymity for a small cohort to
        give away."""
        Enrollment.objects.filter(course=self.course, participant=self.third).update(status='left')
        self.set_mode('shared_named')
        self.record(self.second)
        body = self.as_(self.student).get(self.url()).data
        self.assertIsNone(body['withheld_reason'])
        self.assertEqual(body['summary']['done'], 1)

    # --- shared_named ---------------------------------------------------------------------------

    def test_named_mode_names_everybody_including_who_has_not_started(self):
        """A list of only the people who answered would quietly be a different question — "who has
        not started" is most of what makes this worth reading."""
        self.set_mode('shared_named')
        self.record(self.second, 'in_progress')
        people = self.as_(self.student).get(self.url()).data['people']
        self.assertEqual(
            {row['participant']['display_name']: row['status'] for row in people},
            {'ania': 'in_progress', 'michal': 'not_started', 'piotr': 'not_started'},
        )

    def test_an_outsider_learns_nothing_from_a_public_course(self):
        """Public means the course page is readable, never that the roster's progress is."""
        self.set_mode('shared_named')
        self.record(self.student)
        self.assertEqual(self.as_(self.other).get(self.url()).status_code, 403)

    # --- counting honesty -----------------------------------------------------------------------

    def test_somebody_who_left_is_not_counted_either_way(self):
        """Their row survives — they may come back — but they are not one of the "6", and their
        answer is not one of the "3". Counting it is the shape of bug that lets a numerator exceed
        its denominator and simply looks broken."""
        self.record(self.second)
        Enrollment.objects.filter(course=self.course, participant=self.second).update(status='left')
        body = self.as_(self.instructor).get(self.url()).data
        self.assertEqual(body['summary']['participants'], 2)
        self.assertEqual(body['summary']['done'], 0)
        self.assertEqual(body['summary']['not_started'], 2)
        self.assertEqual(LessonProgress.objects.count(), 1)

    # --- the course page ------------------------------------------------------------------------

    def test_the_course_detail_carries_each_lessons_progress(self):
        self.record(self.student)
        body = self.as_(self.student).get(f'/api/courses/{self.course.pk}/').data
        lesson = body['chapters'][0]['lessons'][0]
        self.assertEqual(lesson['progress']['mine'], 'done')
        self.assertEqual(lesson['progress']['mode'], 'shared_anonymous')
        self.assertTrue(lesson['progress']['can_record'])

    def test_an_outsider_reading_the_course_gets_the_shape_but_none_of_the_content(self):
        """The key is always there — a client branches on a value it can read, never on whether a
        field exists."""
        body = self.client.get(f'/api/courses/{self.course.pk}/').data
        progress = body['chapters'][0]['lessons'][0]['progress']
        self.assertIsNone(progress['mine'])
        self.assertIsNone(progress['summary'])
        self.assertFalse(progress['can_record'])

    def test_drawing_more_lessons_does_not_cost_more_queries(self):
        """The N+1 guard. `shared_named` is the heaviest path — it names every participant on every
        lesson — so if anything is going to ask per lesson, it is this."""
        self.set_mode('shared_named')
        self.record(self.student)
        client = self.as_(self.instructor)
        with CaptureQueriesContext(connection) as one:
            client.get(f'/api/courses/{self.course.pk}/')
        for n in range(5):
            Lesson.objects.create(chapter=self.chapter, title=f'Extra {n}')
        with CaptureQueriesContext(connection) as six:
            client.get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(len(six.captured_queries), len(one.captured_queries))

    # --- who may change the setting --------------------------------------------------------------

    def test_an_administrator_changes_the_setting(self):
        res = self.as_(self.instructor).patch(
            f'/api/courses/{self.course.pk}/', {'progress_visibility': 'off'}, format='json'
        )
        self.assertEqual(res.status_code, 200)
        self.course.refresh_from_db()
        self.assertEqual(self.course.progress_visibility, 'off')

    def test_an_assistant_cannot(self):
        """It is a promise made to every participant about their own data rather than a piece of
        course content, so it sits with the people who can change the course itself.

        404 rather than 403 throughout, which is `CourseViewSet.update`'s own answer to every
        non-administrator: this app scopes writes by queryset rather than by after-the-fact
        permission checks, so "you may not change this" and "there is no such thing to change" are
        deliberately the same reply. Asserted as 404 because that is the behaviour, not because it
        is the reply I would have picked.
        """
        CourseStaff.objects.create(course=self.course, user=self.other, role='assistant')
        res = self.as_(self.other).patch(
            f'/api/courses/{self.course.pk}/', {'progress_visibility': 'off'}, format='json'
        )
        self.assertEqual(res.status_code, 404)
        self.course.refresh_from_db()
        self.assertEqual(self.course.progress_visibility, 'shared_anonymous')

    def test_a_participant_cannot(self):
        res = self.as_(self.student).patch(
            f'/api/courses/{self.course.pk}/',
            {'progress_visibility': 'shared_named'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)
        self.course.refresh_from_db()
        self.assertEqual(self.course.progress_visibility, 'shared_anonymous')


class CourseReplyNotificationTests(CourseThreadFixture):
    """Being answered inside a course used to tell nobody.

    Every other thread in this app — an exercise's, a material's, a tutoring listing's — has always
    said "somebody replied to you". A course had only the broadcast ("something was posted"), and its
    lesson, chapter and attachment threads had nothing at all.
    """

    def replies(self, recipient):
        return Notification.objects.filter(recipient=recipient, type='comment_reply')

    def test_a_reply_in_the_course_thread_tells_the_person_replied_to(self):
        root = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': 'is week 3 examinable'}, format='json'
        ).data
        self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/comments/',
            {'body': 'no', 'parent': root['id']},
            format='json',
        )
        row = self.replies(self.student).first()
        self.assertIsNotNone(row)
        self.assertEqual(row.actor, self.instructor)
        self.assertEqual(row.course, self.course)

    def test_the_broadcast_leaves_out_whoever_got_the_reply(self):
        """Two bells for one event, one of them vaguer, is worse than one."""
        root = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': 'question'}, format='json'
        ).data
        self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/comments/',
            {'body': 'answer', 'parent': root['id']},
            format='json',
        )
        self.assertEqual(self.replies(self.student).count(), 1)
        self.assertFalse(
            Notification.objects.filter(recipient=self.student, type='course_new_post').exists()
        )

    def test_a_top_level_post_still_broadcasts_and_replies_to_nobody(self):
        """A first comment has nobody to answer — it is the opening line, not a reply."""
        self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/comments/', {'body': 'welcome'}, format='json'
        )
        self.assertEqual(self.replies(self.student).count(), 0)
        self.assertTrue(
            Notification.objects.filter(recipient=self.student, type='course_new_post').exists()
        )

    def test_a_reply_in_a_lesson_thread_names_the_lesson(self):
        """Four threads in one course would otherwise produce four identical-looking notifications."""
        root = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'step 3?'}, format='json'
        ).data
        self.as_(self.instructor).post(
            self.lesson_thread(), {'body': 'typo', 'parent': root['id']}, format='json'
        )
        row = self.replies(self.student).first()
        self.assertIsNotNone(row)
        self.assertIn(self.lesson.title, row.target_label)

    def test_a_reply_in_a_chapter_thread_names_the_chapter(self):
        root = self.as_(self.student).post(
            self.chapter_thread(), {'body': 'how should we approach this'}, format='json'
        ).data
        self.as_(self.instructor).post(
            self.chapter_thread(), {'body': 'start with the notes', 'parent': root['id']},
            format='json',
        )
        row = self.replies(self.student).first()
        self.assertIsNotNone(row)
        self.assertIn(self.chapter.title, row.target_label)

    def test_replying_to_yourself_tells_you_nothing(self):
        """`notify()`'s own actor==recipient guard, relied on rather than re-implemented here."""
        root = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'first'}, format='json'
        ).data
        self.as_(self.student).post(
            self.lesson_thread(), {'body': 'second', 'parent': root['id']}, format='json'
        )
        self.assertEqual(self.replies(self.student).count(), 0)

    def test_muting_the_category_suppresses_it(self):
        """The recipient's own account-wide preference, which `notify()` applies — not something this
        feature needed its own switch for."""
        self.student.profile.notify_on_comment_reply = False
        self.student.profile.save(update_fields=['notify_on_comment_reply'])
        root = self.as_(self.student).post(
            self.lesson_thread(), {'body': 'q'}, format='json'
        ).data
        self.as_(self.instructor).post(
            self.lesson_thread(), {'body': 'a', 'parent': root['id']}, format='json'
        )
        self.assertEqual(self.replies(self.student).count(), 0)


class AttachmentThreadGateTests(CourseThreadFixture):
    """The attachment thread was the one course thread that ignored `discussion_mode` entirely.

    A course with discussion switched off still had a fully working, postable thread on every
    attachment — not a corner of the setting, the setting not applying. It also passed `parent`
    straight through, the same hole that was closed for the lesson thread but left open here.
    """

    def setUp(self):
        super().setUp()
        self.attachment = self.upload('Last year exam')

    def upload(self, title):
        """Through the real endpoint rather than `Attachment.objects.create`: `size_bytes` is a
        derived property with no setter, and a real upload is what produces a row with a file on it.
        The PDF header is genuine because the validator sniffs the bytes with libmagic rather than
        trusting the name — the same fixture shape `AttachmentTests` already uses."""
        body = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
        response = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/attachments/',
            {
                'file': SimpleUploadedFile('exam.pdf', body, content_type='application/pdf'),
                'title': title,
            },
            format='multipart',
        )
        assert response.status_code == 201, response.data
        return Attachment.objects.get(pk=response.data['id'])

    def thread(self, attachment=None):
        target = attachment or self.attachment
        return f'/api/courses/{self.course.pk}/attachments/{target.pk}/comments/'

    def off(self):
        self.course.discussion_mode = 'off'
        self.course.save(update_fields=['discussion_mode'])

    def test_a_member_can_read_and_post(self):
        self.assertEqual(self.as_(self.student).get(self.thread()).status_code, 200)
        res = self.as_(self.student).post(self.thread(), {'body': 'which year is this'}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_discussion_off_closes_it(self):
        self.off()
        self.assertEqual(self.as_(self.student).get(self.thread()).status_code, 403)
        self.assertEqual(
            self.as_(self.student).post(self.thread(), {'body': 'hi'}, format='json').status_code, 403
        )

    def test_discussion_off_closes_it_for_staff_too(self):
        """The same answer the course's own thread gives them — the setting is about the course, not
        about who is asking."""
        self.off()
        self.assertEqual(self.as_(self.instructor).get(self.thread()).status_code, 403)

    def test_an_outsider_cannot_read_it(self):
        self.assertEqual(self.as_(self.other).get(self.thread()).status_code, 404)

    def test_a_reply_threads(self):
        root = self.as_(self.student).post(self.thread(), {'body': 'q'}, format='json').data
        reply = self.as_(self.instructor).post(
            self.thread(), {'body': 'a', 'parent': root['id']}, format='json'
        )
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.data['parent'], root['id'])

    def test_a_parent_from_another_attachments_thread_is_refused(self):
        other = self.upload('Other paper')
        elsewhere = self.as_(self.student).post(
            self.thread(other), {'body': 'about the other one'}, format='json'
        ).data
        res = self.as_(self.student).post(
            self.thread(), {'body': 'sneaking in', 'parent': elsewhere['id']}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('parent', res.data)

    def test_a_parent_that_does_not_exist_is_a_400_not_a_500(self):
        res = self.as_(self.student).post(
            self.thread(), {'body': 'hi', 'parent': 999999}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class CourseItemTargetVisibilityTests(ApiTestCase):
    """A course references corpus content rather than copying it, so a reference has to answer to
    what it references. It did not: an approved item in an open chapter rendered whether or not the
    exercise underneath it had since been unpublished — so a moderator pulling a wrong exercise took
    it out of the corpus and left it listed, by name, in every course that had referenced it."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon')
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')
        self.exercise = make_exercise(self.subject, 4242)
        self.item = CourseItem.objects.create(
            course=self.course, lesson=self.lesson, exercise=self.exercise, status='approved'
        )

    def items_seen_by(self, who):
        detail = self.as_(who).get(f'/api/courses/{self.course.pk}/').data
        lesson = detail['chapters'][0]['lessons'][0]
        return [i['id'] for i in lesson['items']]

    def test_a_published_exercise_is_listed(self):
        self.assertIn(self.item.pk, self.items_seen_by(self.student))

    def test_an_unpublished_one_disappears_for_a_participant(self):
        self.exercise.published = False
        self.exercise.save(update_fields=['published'])
        self.assertNotIn(self.item.pk, self.items_seen_by(self.student))

    def test_but_staff_still_see_it(self):
        """They are the people who have to notice something in their week has been pulled; hiding it
        from them would make the course look complete when it is not."""
        self.exercise.published = False
        self.exercise.save(update_fields=['published'])
        self.assertIn(self.item.pk, self.items_seen_by(self.instructor))

    def test_an_unpublished_material_disappears_too(self):
        material = self.make_material('pulled-script', 'Pulled script')
        material.published = False
        material.save(update_fields=['published'])
        item = CourseItem.objects.create(
            course=self.course, lesson=self.lesson, material=material, status='approved'
        )
        self.assertNotIn(item.pk, self.items_seen_by(self.student))


class CourseReportTests(ApiTestCase):
    """Reported content inside a course, and who may act on it.

    The gap: a comment reported inside somebody's course could only be dealt with by a global staff
    moderator. The people who run the room — who already approve its contributions and remove its
    participants — had no way to touch it.
    """

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1')
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon')
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')
        Enrollment.objects.create(course=self.course, participant=self.other, status='active')
        self.comment = self.as_(self.other).post(
            f'/api/courses/{self.course.pk}/lessons/{self.lesson.pk}/comments/',
            {'body': 'something objectionable'},
            format='json',
        ).data
        self.as_(self.student).post(
            '/api/reports/',
            {'kind': 'comment', 'object_id': self.comment['id'], 'reason': 'off topic'},
            format='json',
        )

    def url(self):
        return f'/api/courses/{self.course.pk}/reports/'

    def test_the_person_running_the_course_sees_what_was_reported(self):
        rows = self.as_(self.instructor).get(self.url()).data
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], self.comment['id'])
        self.assertEqual(rows[0]['report_count'], 1)
        self.assertEqual(rows[0]['reasons'], ['off topic'])
        self.assertIn(self.lesson.title, rows[0]['where'])

    def test_a_participant_does_not(self):
        """Reading who reported what is the moderating half of running a course, not part of taking
        it."""
        self.assertEqual(self.as_(self.student).get(self.url()).status_code, 403)

    def test_an_outsider_gets_nothing(self):
        outsider = User.objects.create_user('nobody', 'nobody@x.example', 'pw12345!')
        self.assertIn(self.as_(outsider).get(self.url()).status_code, (403, 404))

    def test_the_course_owner_can_remove_the_reported_comment(self):
        res = self.as_(self.instructor).post(
            f'/api/moderation/reports/comment/{self.comment["id"]}/remove/', {}, format='json'
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(Comment.objects.get(pk=self.comment['id']).is_removed)

    def test_and_the_report_is_then_gone_from_their_list(self):
        self.as_(self.instructor).post(
            f'/api/moderation/reports/comment/{self.comment["id"]}/remove/', {}, format='json'
        )
        self.assertEqual(self.as_(self.instructor).get(self.url()).data, [])

    def test_an_assistant_can_act_too(self):
        """`can_curate`, not `can_administer`: acting on the discussion is curating content, which is
        exactly the job an assistant is brought in for."""
        assistant = User.objects.create_user('ta', 'ta@x.example', 'pw12345!')
        CourseStaff.objects.create(course=self.course, user=assistant, role='assistant')
        res = self.as_(assistant).post(
            f'/api/moderation/reports/comment/{self.comment["id"]}/remove/', {}, format='json'
        )
        self.assertEqual(res.status_code, 200)

    def test_somebody_running_a_DIFFERENT_course_cannot(self):
        """The authority is over one room, not over reports generally."""
        stranger = User.objects.create_user('elsewhere', 'elsewhere@x.example', 'pw12345!')
        Course.objects.create(
            instructor=stranger, title='Another course', visibility='public', status='open'
        )
        res = self.as_(stranger).post(
            f'/api/moderation/reports/comment/{self.comment["id"]}/remove/', {}, format='json'
        )
        self.assertEqual(res.status_code, 403)
        self.assertFalse(Comment.objects.get(pk=self.comment['id']).is_removed)

    def test_a_participant_cannot_act_on_it_either(self):
        res = self.as_(self.student).post(
            f'/api/moderation/reports/comment/{self.comment["id"]}/remove/', {}, format='json'
        )
        self.assertIn(res.status_code, (403, 404))
        self.assertFalse(Comment.objects.get(pk=self.comment['id']).is_removed)
# --- attachment images: what gets stored, and what does not ---------------------------------------
#
# Appended at the end of the file deliberately: other work is in flight on this module, and a block
# added at the bottom merges cleanly where one inserted next to `AttachmentTests` would not.


def make_attachment_image_bytes(
    width: int = 3600,
    height: int = 1800,
    fmt: str = 'JPEG',
    exif: Image.Exif | None = None,
    icc_profile: bytes | None = None,
) -> bytes:
    """A real, encoded image — never a placeholder pretending to be one.

    Patterned rather than a flat colour, and non-square by default, so a working resize can be told
    apart from a no-op and a rotation from a crop. The same discipline `accounts/test_avatar.py` and
    `events/tests.py` already apply to their own fixtures, and the only way a test of "is the EXIF
    really gone?" means anything: a fixture that silently never carried any would pass for free.
    """
    image = Image.new('RGB', (width, height), (30, 120, 200))
    for x in range(0, width, 60):
        for y in range(0, height, 60):
            image.paste((240, 200, 40), (x, y, x + 30, y + 30))
    buffer = io.BytesIO()
    extra = {}
    if exif is not None:
        extra['exif'] = exif
    if icc_profile is not None:
        extra['icc_profile'] = icc_profile
    image.save(buffer, fmt, **extra)
    return buffer.getvalue()


def make_phone_exif() -> Image.Exif:
    """What a phone actually writes: a camera model, a timestamp, and — the reason this change
    exists — the GPS coordinates of wherever the photo was taken."""
    exif = Image.Exif()
    exif[0x010F] = 'ACME Phone'  # Make
    exif[0x0132] = '2026:03:14 09:41:00'  # DateTime
    gps = exif.get_ifd(0x8825)
    gps[1] = 'N'
    gps[2] = (52.0, 13.0, 0.0)  # somewhere in Warsaw
    gps[3] = 'E'
    gps[4] = (21.0, 1.0, 0.0)
    return exif


def srgb_icc_bytes() -> bytes:
    """A genuine sRGB profile from littlecms, not an invented blob — a fake one might be dropped at
    save time for being malformed, which would make the strip assertion pass for the wrong reason."""
    return ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()


PE_HEADER = b'MZ\x90\x00\x03' + b'\x00' * 200 + b'This program cannot be run in DOS mode.'

LEGACY_PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'


def decompression_bomb_bytes() -> bytes:
    """A VALID png: ~140 KB on disk, 144 megapixels decoded. The attack a byte cap cannot see."""
    buffer = io.BytesIO()
    Image.new('L', (12000, 12000), 0).save(buffer, 'PNG', optimize=True)
    return buffer.getvalue()


class AttachmentFileTestCase(ApiTestCase):
    """A temporary MEDIA_ROOT for the whole class, so a test run never writes real image files in
    among genuine uploads. Applied per-class rather than per-test so the directory survives the class
    and is cleaned up exactly once — `accounts/test_avatar.py`'s own arrangement, for its reasons."""

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-attachment-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')

    def upload(self, content: bytes, name='board.jpg', content_type='image/jpeg', who=None):
        return self.as_(who or self.instructor).post(
            f'/api/courses/{self.course.pk}/attachments/',
            {
                'file': SimpleUploadedFile(name, content, content_type=content_type),
                'title': 'Whiteboard',
            },
            format='multipart',
        )

    def stored(self):
        return Attachment.objects.get()


class AttachmentImageMetadataTests(AttachmentFileTestCase):
    """An image attachment is never stored as the bytes the uploader sent.

    The property being defended is a privacy one, and it fails silently: a course whose files quietly
    publish the GPS coordinates of the room they were photographed in looks exactly like one that
    does not. So these assert on the file that actually landed on disk, not on the response.
    """

    def test_gps_and_the_rest_of_the_exif_do_not_survive_the_upload(self):
        source = make_attachment_image_bytes(exif=make_phone_exif())

        # The fixture genuinely carries what this test claims, checked rather than assumed.
        self.assertTrue(Image.open(io.BytesIO(source)).getexif().get_ifd(0x8825))

        self.assertEqual(self.upload(source).status_code, 201)

        stored = Image.open(self.stored().file.path)
        self.assertEqual(dict(stored.getexif()), {})
        self.assertEqual(dict(stored.getexif().get_ifd(0x8825)), {}, 'no GPS block at all')

    def test_the_orientation_tag_is_applied_before_it_is_stripped(self):
        """The step that is easy to miss: stripping the tag without first honouring it throws away
        the instruction and keeps the sideways pixels, so every phone photo comes out rotated 90.

        Proven by difference — the same pixels, tagged and untagged, must not produce the same
        output. An assertion that the tag is absent afterwards would pass whether or not it was ever
        obeyed, which is exactly the bug this is here to catch.
        """
        rotated = Image.Exif()
        rotated[0x0112] = 6  # rotate 90 CW on display

        self.upload(make_attachment_image_bytes(400, 200, exif=rotated))
        tagged = Image.open(self.stored().file.path).tobytes()

        Attachment.objects.all().delete()
        self.upload(make_attachment_image_bytes(400, 200))
        untagged = Image.open(self.stored().file.path).tobytes()

        self.assertNotEqual(tagged, untagged)

    def test_an_icc_profile_does_not_survive_either(self):
        """Not privacy, but the same principle: the stored file carries pixel data and nothing else,
        because that is a property of never opting back in rather than a list of tags to remember."""
        source = make_attachment_image_bytes(400, 200, icc_profile=srgb_icc_bytes())
        self.assertTrue(Image.open(io.BytesIO(source)).info.get('icc_profile'))

        self.upload(source)

        self.assertIsNone(Image.open(self.stored().file.path).info.get('icc_profile'))

    def test_appended_trailing_bytes_do_not_survive(self):
        """The polyglot case, and the reason re-encoding beats sniffing: a genuine, decodable image
        that also carries a payload after the image data. A content sniff says "a real JPEG" —
        correctly — and stores it with the payload intact."""
        payload = b'<?php system($_GET["c"]); ?>'
        self.upload(make_attachment_image_bytes(400, 200) + payload)

        with open(self.stored().file.path, 'rb') as handle:
            self.assertNotIn(payload, handle.read())

    def test_the_uploaders_own_filename_is_discarded(self):
        """A filename is untrusted input too. The stored name must not be a sanitized version of
        this one — it should be unrelated to it."""
        self.upload(make_attachment_image_bytes(400, 200), name='../../../etc/passwd.jpg.png')

        name = self.stored().file.name
        self.assertNotIn('passwd', name)
        self.assertNotIn('..', name)


class AttachmentImageShapeTests(AttachmentFileTestCase):
    def test_the_stored_image_is_bounded_but_keeps_its_shape(self):
        """Two things, and the second is what makes this not an avatar: the bound stops a 24
        megapixel phone photo being served to every member, and the aspect ratio surviving is why a
        photographed page still has its edges. A centre-crop would take the ends off the very
        content the file exists for."""
        self.upload(make_attachment_image_bytes(3600, 1800))

        stored = Image.open(self.stored().file.path)
        self.assertEqual(stored.format, 'WEBP')
        self.assertEqual(stored.size, (MAX_ATTACHMENT_IMAGE_EDGE, MAX_ATTACHMENT_IMAGE_EDGE // 2))
        self.assertTrue(self.stored().file.name.endswith('.webp'))

    def test_an_image_smaller_than_the_bound_is_not_stretched_up_to_it(self):
        """`thumbnail` is shrink-only on purpose: upscaling adds bytes and invents detail the source
        never had."""
        self.upload(make_attachment_image_bytes(320, 240))

        self.assertEqual(Image.open(self.stored().file.path).size, (320, 240))

    def test_the_quota_gate_weighs_what_will_be_stored_rather_than_what_arrived(self):
        """Why the re-encode happens in `validate_file` and not in `create()`.

        The view checks the course's quota against `validated_data['file']`, and the quota is spent
        on stored bytes — `Course.uploaded_bytes` sums them. A photo that re-encodes to a fraction of
        its upload size must therefore be admitted by a quota that could not have held the original,
        or the gate would refuse a file that in fact fits.
        """
        source = make_attachment_image_bytes(3600, 1800)
        self.course.upload_quota_bytes = len(source) // 2
        self.course.save(update_fields=['upload_quota_bytes'])

        response = self.upload(source)

        self.assertEqual(response.status_code, 201, response.content)
        self.assertLess(self.stored().size_bytes, self.course.upload_quota_bytes)


class AttachmentImageRefusalTests(AttachmentFileTestCase):
    def test_a_windows_executable_renamed_to_an_image_is_refused(self):
        response = self.upload(PE_HEADER, name='board.png', content_type='image/png')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Attachment.objects.count(), 0, 'and nothing is stored')

    def test_a_decompression_bomb_is_refused_before_it_is_decoded(self):
        """The gap the material validator could not close, because it never decodes anything: this
        file passes a 25 MB byte cap and a content sniff, and decoding it would cost gigabytes."""
        bomb = decompression_bomb_bytes()
        self.assertLess(len(bomb), 1024 * 1024, 'genuinely small on disk, as the attack requires')

        response = self.upload(bomb, name='board.png', content_type='image/png')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Attachment.objects.count(), 0)


class AttachmentFieldValidatorTests(TestCase):
    """`validate_attachment_file` called directly, which is the admin path.

    The serializer is not the only way a file reaches this field — the Django admin assigns one and
    never goes near `process_attachment_file`. It cannot be given the re-encode there (a validator
    returns nothing), but it must still be given the checks, and the decoded-pixel budget is the one
    that was missing entirely before this change. Tested directly rather than through a view, because
    a view test would prove the serializer works and say nothing about the field.
    """

    def test_it_refuses_a_decompression_bomb(self):
        upload = SimpleUploadedFile('board.png', decompression_bomb_bytes(), 'image/png')

        with self.assertRaises(ValidationError) as ctx:
            validate_attachment_file(upload)

        self.assertIn('too many pixels', str(ctx.exception))

    def test_it_still_refuses_a_disguised_executable(self):
        upload = SimpleUploadedFile('board.png', PE_HEADER, 'image/png')

        with self.assertRaises(ValidationError):
            validate_attachment_file(upload)

    def test_it_still_accepts_a_real_pdf(self):
        """The wrap must not have narrowed what a document may be."""
        validate_attachment_file(SimpleUploadedFile('exam.pdf', LEGACY_PDF, 'application/pdf'))

    def test_it_accepts_a_real_image(self):
        validate_attachment_file(
            SimpleUploadedFile('board.jpg', make_attachment_image_bytes(400, 200), 'image/jpeg')
        )


class AttachmentWebpTests(AttachmentFileTestCase):
    """A `.webp` upload, which this change incidentally started allowing.

    `ALLOWED_MATERIAL_TYPES` has no `.webp` entry, so before this the format was refused outright
    even though `imaging.ALLOWED_IMAGE_TYPES` has accepted it for avatars and post pictures all
    along. The image branch keys on the sniffed bytes rather than the extension table, so it is now
    accepted — worth a test because it is a real behaviour change rather than a side effect nobody
    should rely on, and because the stored result must be stripped like any other image.
    """

    def test_a_webp_is_accepted_and_stripped_like_any_other_image(self):
        source = make_attachment_image_bytes(400, 200, fmt='WEBP', exif=make_phone_exif())
        self.assertTrue(Image.open(io.BytesIO(source)).getexif().get_ifd(0x8825))

        self.assertEqual(
            self.upload(source, name='board.webp', content_type='image/webp').status_code, 201
        )

        stored = Image.open(self.stored().file.path)
        self.assertEqual(stored.format, 'WEBP')
        self.assertEqual(dict(stored.getexif()), {})


class AttachmentNonImageTests(AttachmentFileTestCase):
    """The other half of the branch, and the half most likely to be broken by a careless change: an
    attachment is just as often a PDF, and a PDF's bytes ARE the document."""

    def test_a_pdf_is_stored_exactly_as_it_arrived(self):
        self.assertEqual(
            self.upload(LEGACY_PDF, name='exam.pdf', content_type='application/pdf').status_code,
            201,
        )

        with open(self.stored().file.path, 'rb') as handle:
            self.assertEqual(handle.read(), LEGACY_PDF, 'byte for byte — never re-encoded')
        self.assertTrue(self.stored().file.name.endswith('.pdf'))

    def test_a_renamed_executable_is_still_refused_on_the_document_path(self):
        """The material validator's extension/content check is untouched for a non-image, and this is
        what says so — the new image branch must not have become a way around it."""
        response = self.upload(PE_HEADER, name='exam.pdf', content_type='application/pdf')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Attachment.objects.count(), 0)


class StripAttachmentImageMetadataCommandTests(AttachmentFileTestCase):
    """The command that deals with files stored before any of the above existed.

    Every row here is created with `Attachment.objects.create`, which is how a legacy row genuinely
    got there: it bypasses both the serializer and the field validators, so the bytes land verbatim.
    """

    def legacy(self, content: bytes, name='board.jpg'):
        return Attachment.objects.create(
            course=self.course,
            file=SimpleUploadedFile(name, content, content_type='image/jpeg'),
            title='Old whiteboard',
            uploaded_by=self.instructor,
        )

    def run_command(self, **options) -> str:
        out = io.StringIO()
        call_command('strip_attachment_image_metadata', stdout=out, stderr=out, **options)
        return out.getvalue()

    def test_a_dry_run_reports_without_rewriting_anything(self):
        """The whole reason this is a command rather than a data migration: an operator gets to look
        at what it would touch before any bytes are rewritten."""
        attachment = self.legacy(make_attachment_image_bytes(400, 200, exif=make_phone_exif()))
        before = attachment.file.name

        output = self.run_command(dry_run=True)

        self.assertIn('[dry run]', output)
        self.assertIn('1 image(s) re-encoded', output)
        attachment.refresh_from_db()
        self.assertEqual(attachment.file.name, before)
        self.assertTrue(
            Image.open(attachment.file.path).getexif().get_ifd(0x8825),
            'the GPS is still there — a dry run that changed anything would be a lie',
        )

    def test_it_strips_a_file_stored_before_the_pipeline_existed(self):
        attachment = self.legacy(make_attachment_image_bytes(3600, 1800, exif=make_phone_exif()))
        original_name = attachment.file.name

        self.run_command()

        attachment.refresh_from_db()
        stored = Image.open(attachment.file.path)
        self.assertEqual(stored.format, 'WEBP')
        self.assertEqual(dict(stored.getexif()), {})
        self.assertEqual(dict(stored.getexif().get_ifd(0x8825)), {})
        self.assertFalse(
            default_storage.exists(original_name),
            'the original is gone — leaving it would keep the coordinates readable at the old URL, '
            'and the command would have achieved nothing',
        )

    def test_running_it_twice_changes_nothing_the_second_time(self):
        """Idempotency by property rather than by a marker column: the second pass sees a WebP with
        no EXIF inside the bound and leaves it alone, so nothing is ever re-encoded lossily on top of
        a previous re-encode."""
        self.legacy(make_attachment_image_bytes(3600, 1800, exif=make_phone_exif()))
        self.run_command()

        attachment = self.stored()
        name_after_first = attachment.file.name
        with open(attachment.file.path, 'rb') as handle:
            bytes_after_first = handle.read()

        output = self.run_command()

        self.assertIn('0 image(s) re-encoded, 1 already clean', output)
        attachment.refresh_from_db()
        self.assertEqual(attachment.file.name, name_after_first)
        with open(attachment.file.path, 'rb') as handle:
            self.assertEqual(handle.read(), bytes_after_first)

    def test_it_leaves_a_pdf_alone(self):
        attachment = Attachment.objects.create(
            course=self.course,
            file=SimpleUploadedFile('exam.pdf', LEGACY_PDF, 'application/pdf'),
            title='Last year exam',
        )
        before = attachment.file.name

        output = self.run_command()

        self.assertIn('1 not images', output)
        attachment.refresh_from_db()
        self.assertEqual(attachment.file.name, before)
        with open(attachment.file.path, 'rb') as handle:
            self.assertEqual(handle.read(), LEGACY_PDF)

    def test_a_row_whose_file_has_gone_missing_is_reported_rather_than_crashing(self):
        """One lost file must not stop the rest being fixed — the same tolerance `size_bytes` already
        shows for a file deleted from underneath a row."""
        missing = self.legacy(make_attachment_image_bytes(400, 200, exif=make_phone_exif()))
        good = self.legacy(make_attachment_image_bytes(400, 200, exif=make_phone_exif()))
        default_storage.delete(missing.file.name)

        output = self.run_command()

        self.assertIn(f'#{missing.pk}', output)
        self.assertIn('1 image(s) re-encoded', output)
        good.refresh_from_db()
        self.assertEqual(dict(Image.open(good.file.path).getexif()), {})
