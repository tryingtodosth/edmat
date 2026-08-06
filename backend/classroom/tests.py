"""What matters about a course somebody runs is who can see it and who can get into it.

So most of these pin boundaries rather than happy paths: a draft is invisible, a roster is not
public, a full course refuses, a removed person cannot walk back in, and participant-only lesson
notes stay out of an outsider's response. Those are the properties that fail silently — a broken
create flow announces itself immediately; a roster leaking to strangers does not.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from materials.models import Material, MaterialTranslation
from notifications.models import Notification
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards

from .models import (
    Chapter,
    CourseInvite,
    CourseItem,
    CourseStaff,
    Enrollment,
    Lesson,
    TaughtCourse,
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
        return TaughtCourse.objects.create(**{**defaults, **kwargs})


class VisibilityTests(ApiTestCase):
    def test_an_only_you_course_is_invisible_to_everybody_but_its_instructor(self):
        hidden = self.make_course(visibility='only_you')
        anon = self.client.get('/api/taught-courses/')
        self.assertNotIn(hidden.pk, [c['id'] for c in anon.data])

        stranger = self.as_(self.student).get('/api/taught-courses/')
        self.assertNotIn(hidden.pk, [c['id'] for c in stranger.data])

        mine = self.as_(self.instructor).get('/api/taught-courses/')
        self.assertIn(hidden.pk, [c['id'] for c in mine.data])

    def test_a_private_course_is_unlisted_and_not_reachable_by_guessing_its_id(self):
        """The whole point of `private`: a link gets you in, counting integers does not.

        The invite token is 256-bit, so the link is the credential. If retrieve-by-id answered for
        a private course, that credential would be bypassable by anybody willing to walk the id
        space, and the token would be decoration.
        """
        private = self.make_course(visibility='private')

        for client in (self.client, self.as_(self.student)):
            listing = client.get('/api/taught-courses/')
            self.assertNotIn(private.pk, [c['id'] for c in listing.data])
            self.assertEqual(client.get(f'/api/taught-courses/{private.pk}/').status_code, 404)

        # Its own staff still reach it by id, which is how they administer it at all.
        self.assertEqual(
            self.as_(self.instructor).get(f'/api/taught-courses/{private.pk}/').status_code, 200
        )

    def test_a_participant_reaches_a_private_course_they_are_already_in(self):
        private = self.make_course(visibility='private')
        Enrollment.objects.create(course=private, participant=self.student, status='active')
        res = self.as_(self.student).get(f'/api/taught-courses/{private.pk}/')
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
        res = self.client.get(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['title'], 'Analiza od zera')
        self.assertFalse(res.data['can_enrol'])  # anonymous
        self.assertEqual(res.data['enrollment_block_reason'], 'authentication_required')

    def test_courses_are_discoverable_by_subject(self):
        course = self.make_course()
        course.subjects.add(self.subject)
        self.make_course(title='Unrelated')
        res = self.client.get('/api/taught-courses/?subject=analiza-2')
        self.assertEqual([c['id'] for c in res.data], [course.pk])


class EnrolmentTests(ApiTestCase):
    def test_open_policy_admits_immediately(self):
        course = self.make_course()
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_approval_policy_parks_the_request(self):
        course = self.make_course(enrollment_policy='approval')
        res = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/enrol/', {'request_note': 'I am in year 2'}, format='json'
        )
        self.assertEqual(res.data['status'], 'pending')
        self.assertEqual(res.data['request_note'], 'I am in year 2')
        # A pending request is not a seat.
        self.assertEqual(course.active_participant_count, 0)

    def test_the_instructor_approves_and_the_seat_is_taken(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_only_the_instructor_decides(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_a_full_course_refuses_and_says_so(self):
        course = self.make_course(capacity=1)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_approving_into_a_full_course_is_refused_too(self):
        """The cap has to hold on the instructor's path as well, or it is not a cap."""
        course = self.make_course(enrollment_policy='approval', capacity=1)
        first = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        second = self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        client = self.as_(self.instructor)
        client.post(
            f'/api/taught-courses/{course.pk}/enrollments/{first.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        res = client.post(
            f'/api/taught-courses/{course.pk}/enrollments/{second.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_a_closed_course_does_not_take_new_people(self):
        course = self.make_course(status='running')
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'not_open')

    def test_an_instructor_cannot_enrol_in_their_own_course(self):
        course = self.make_course()
        res = self.as_(self.instructor).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'instructor_cannot_enrol')

    def test_asking_twice_does_not_queue_twice(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'already_enrolled')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_leaving_frees_the_seat_and_re_joining_reuses_the_row(self):
        course = self.make_course(capacity=1)
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/enrol/')
        client.post(f'/api/taught-courses/{course.pk}/leave/')
        self.assertEqual(course.active_participant_count, 0)
        again = client.post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(again.data['status'], 'active')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_somebody_removed_cannot_simply_walk_back_in(self):
        course = self.make_course()
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'remove'},
            format='json',
        )
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'removed')


class RosterTests(ApiTestCase):
    def test_the_roster_is_not_public(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(self.client.get(f'/api/taught-courses/{course.pk}/participants/').status_code, 401)
        self.assertEqual(
            self.as_(self.other).get(f'/api/taught-courses/{course.pk}/participants/').status_code, 403
        )

    def test_participants_see_each_other_and_the_instructor_sees_requests(self):
        course = self.make_course(enrollment_policy='approval')
        active = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{active.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')

        as_participant = self.as_(self.student).get(f'/api/taught-courses/{course.pk}/participants/')
        self.assertEqual([r['status'] for r in as_participant.data], ['active'])

        as_instructor = self.as_(self.instructor).get(f'/api/taught-courses/{course.pk}/participants/')
        self.assertEqual(sorted(r['status'] for r in as_instructor.data), ['active', 'pending'])


class LessonTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.lesson = Lesson.objects.create(
            course=self.course,
            title='Ciągi',
            description='Public blurb',
            participant_notes='The zoom link and the homework',
        )

    def test_an_outsider_sees_the_lesson_but_not_the_notes(self):
        res = self.client.get(f'/api/taught-courses/{self.course.pk}/')
        lesson = res.data['lessons'][0]
        self.assertEqual(lesson['title'], 'Ciągi')
        self.assertEqual(lesson['description'], 'Public blurb')
        # Present but empty rather than absent — the response shape must not change with the caller.
        self.assertEqual(lesson['participant_notes'], '')

    def test_a_participant_sees_the_notes(self):
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{self.course.pk}/enrol/')
        res = client.get(f'/api/taught-courses/{self.course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], 'The zoom link and the homework')

    def test_a_pending_request_is_not_yet_a_participant(self):
        course = self.make_course(enrollment_policy='approval')
        Lesson.objects.create(course=course, title='L', participant_notes='secret')
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/enrol/')
        res = client.get(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], '')

    def test_only_the_instructor_adds_lessons(self):
        res = self.as_(self.student).post(
            f'/api/taught-courses/{self.course.pk}/lessons/', {'title': 'Mine now'}, format='json'
        )
        self.assertEqual(res.status_code, 404)

    def test_the_instructor_adds_and_edits_lessons(self):
        client = self.as_(self.instructor)
        created = client.post(
            f'/api/taught-courses/{self.course.pk}/lessons/',
            {'title': 'Szeregi', 'order': 2},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        edited = client.patch(
            f'/api/taught-courses/{self.course.pk}/lessons/{created.data["id"]}/',
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
            '/api/taught-courses/', {'title': 'Nowy kurs'}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['visibility'], 'only_you')
        self.assertEqual(res.data['status'], 'open')
        self.assertTrue(res.data['is_instructor'])

    def test_the_creator_becomes_the_instructor_regardless_of_what_was_sent(self):
        res = self.as_(self.student).post(
            '/api/taught-courses/',
            {'title': 'Not yours', 'instructor': self.instructor.pk},
            format='json',
        )
        self.assertEqual(res.data['instructor']['id'], self.student.pk)

    def test_somebody_elses_course_cannot_be_edited_or_deleted(self):
        course = self.make_course()
        client = self.as_(self.student)
        self.assertEqual(
            client.patch(f'/api/taught-courses/{course.pk}/', {'title': 'x'}, format='json').status_code,
            404,
        )
        self.assertEqual(client.delete(f'/api/taught-courses/{course.pk}/').status_code, 404)

    def test_the_cap_cannot_be_cut_below_the_people_already_admitted(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/', {'capacity': 1}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('capacity', res.data)

    def test_a_course_cannot_end_before_it_starts(self):
        res = self.as_(self.instructor).post(
            '/api/taught-courses/',
            {'title': 'Backwards', 'starts_on': '2026-03-01', 'ends_on': '2026-02-01'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('ends_on', res.data)

    def test_my_courses_split_into_teaching_and_participating(self):
        teaching = self.make_course(title='I run this')
        joining = self.make_course(title='I attend this', instructor=self.other)
        client = self.as_(self.instructor)
        self.as_(self.instructor).post(f'/api/taught-courses/{joining.pk}/enrol/')

        mine_teaching = client.get('/api/taught-courses/?mine=teaching')
        self.assertEqual([c['id'] for c in mine_teaching.data], [teaching.pk])

        mine_attending = client.get('/api/taught-courses/?mine=participating')
        self.assertEqual([c['id'] for c in mine_attending.data], [joining.pk])


class KillSwitchTests(ApiTestCase):
    def test_the_feature_flag_hides_the_whole_surface(self):
        """Matching every other kill switch here: off means gone for an ordinary visitor, reads
        included, while a real moderator keeps access to manage what already exists."""
        from moderation.models import FeatureFlag

        self.make_course()
        FeatureFlag.objects.update_or_create(key='classroom', defaults={'is_enabled': False})
        # 401 anonymous, 403 signed in — DRF's own distinction, and the same pair every other gated
        # endpoint in this project already returns.
        self.assertEqual(self.client.get('/api/taught-courses/').status_code, 401)
        self.assertEqual(self.as_(self.student).get('/api/taught-courses/').status_code, 403)

        staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        self.assertEqual(self.as_(staff).get('/api/taught-courses/').status_code, 200)


class DiscussionTests(ApiTestCase):
    """Reading and posting are two different questions, and `discussion_mode` only answers the first."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()

    def post_as(self, user, body='Cześć'):
        return self.as_(user).post(
            f'/api/taught-courses/{self.course.pk}/comments/', {'body': body}, format='json'
        )

    def test_participants_only_is_the_default(self):
        self.assertEqual(self.course.discussion_mode, 'participants')
        self.assertEqual(
            self.client.get(f'/api/taught-courses/{self.course.pk}/comments/').status_code, 403
        )
        self.assertEqual(
            self.as_(self.other).get(f'/api/taught-courses/{self.course.pk}/comments/').status_code,
            403,
        )

    def test_a_participant_reads_and_posts(self):
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        posted = self.post_as(self.student)
        self.assertEqual(posted.status_code, 201)
        read = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/comments/')
        self.assertEqual([c['body'] for c in read.data], ['Cześć'])

    def test_the_instructor_is_in_the_conversation_without_being_on_the_roster(self):
        self.assertEqual(self.post_as(self.instructor).status_code, 201)

    def test_a_public_thread_is_readable_but_not_writable_by_outsiders(self):
        """The whole point of two separate checks: open to read, closed to post."""
        self.course.discussion_mode = 'public'
        self.course.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{self.course.pk}/comments/', {'body': 'Witam'}, format='json'
        )
        anon = self.client.get(f'/api/taught-courses/{self.course.pk}/comments/')
        self.assertEqual(anon.status_code, 200)
        self.assertEqual([c['body'] for c in anon.data], ['Witam'])
        self.assertEqual(self.post_as(self.other).status_code, 403)

    def test_turning_the_discussion_off_closes_it_for_everybody(self):
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        self.course.discussion_mode = 'off'
        self.course.save()
        self.assertEqual(
            self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/comments/').status_code,
            403,
        )
        self.assertEqual(self.post_as(self.student).status_code, 403)
        # Including the instructor: off means off, not "off for other people".
        self.assertEqual(self.post_as(self.instructor).status_code, 403)

    def test_a_pending_request_does_not_get_into_the_conversation(self):
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(
            self.as_(self.student).get(f'/api/taught-courses/{course.pk}/comments/').status_code, 403
        )

    def test_a_reply_cannot_be_smuggled_in_from_another_thread(self):
        other_course = self.make_course(title='Elsewhere')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{other_course.pk}/comments/', {'body': 'root'}, format='json'
        )
        from community.models import Comment

        foreign = Comment.objects.first()
        res = self.as_(self.instructor).post(
            f'/api/taught-courses/{self.course.pk}/comments/',
            {'body': 'reply', 'parent': foreign.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('parent', res.data)

    def test_the_viewer_is_told_what_they_may_do(self):
        detail = self.client.get(f'/api/taught-courses/{self.course.pk}/').data
        self.assertFalse(detail['can_read_discussion'])
        self.assertFalse(detail['can_post_discussion'])
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        detail = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/').data
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
            f'/api/taught-courses/{course.pk}/enrol/', {'request_note': 'Rok drugi'}, format='json'
        )
        row = self.notifs(self.instructor, 'course_enrollment_requested').get()
        self.assertEqual(row.target_label, course.title)
        self.assertEqual(row.taught_course_id, course.pk)
        self.assertEqual(row.note, 'Rok drugi')

    def test_joining_an_open_course_notifies_nobody(self):
        """Otherwise a popular course buries its instructor in noise they cannot act on."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(self.notifs(self.instructor).count(), 0)

    def test_every_decision_reaches_the_person_it_is_about(self):
        for decision, expected in (
            ('approve', 'course_enrollment_approved'),
            ('decline', 'course_enrollment_declined'),
            ('remove', 'course_removed'),
        ):
            course = self.make_course(enrollment_policy='approval')
            enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
            self.as_(self.instructor).post(
                f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
                {'decision': decision},
                format='json',
            )
            self.assertTrue(
                self.notifs(self.student, expected).filter(taught_course=course).exists(), decision
            )

    def test_a_new_lesson_reaches_participants_but_not_the_instructor(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 1)
        # notify()'s own actor==recipient guard: nobody is told about their own action.
        self.assertEqual(self.notifs(self.instructor, 'course_new_lesson').count(), 0)

    def test_a_post_reaches_the_other_people_in_the_conversation(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'Pytanie'}, format='json'
        )
        self.assertEqual(self.notifs(self.other, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.instructor, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.student, 'course_new_post').count(), 0)

    def test_a_pending_request_is_never_told_what_is_happening_inside(self):
        """Leaking course activity to somebody not admitted would undo the participants-only rule."""
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 0)


class NotificationSettingTests(ApiTestCase):
    """Three independent switches, at three levels, each of which must work on its own."""

    def notif_count(self, user, type_):
        from notifications.models import Notification

        return Notification.objects.filter(recipient=user, type=type_).count()

    def test_the_instructor_can_stop_announcing_lessons(self):
        course = self.make_course(announce_new_lessons=False)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_the_instructor_can_stop_announcing_posts(self):
        course = self.make_course(announce_new_posts=False)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.other, 'course_new_post'), 0)

    def test_a_participant_can_mute_one_course_without_leaving_it(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        muted = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(muted.status_code, 200)
        self.assertFalse(muted.data['notify'])
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        # Still genuinely in the course — muting is not leaving.
        self.assertEqual(course.active_participant_count, 1)

    def test_muting_is_reversible_and_reported_back(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json')
        self.assertFalse(client.get(f'/api/taught-courses/{course.pk}/').data['notify_me'])
        client.post(f'/api/taught-courses/{course.pk}/mute/', {'notify': True}, format='json')
        self.assertTrue(client.get(f'/api/taught-courses/{course.pk}/').data['notify_me'])

    def test_notify_me_is_null_for_somebody_not_in_the_course(self):
        """Distinct from False, which means "in the course, muted"."""
        course = self.make_course()
        self.assertIsNone(self.as_(self.other).get(f'/api/taught-courses/{course.pk}/').data['notify_me'])

    def test_only_a_participant_can_mute(self):
        course = self.make_course()
        res = self.as_(self.other).post(
            f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_the_account_wide_category_switches_all_six_off(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.notify_on_course_activity = False
        profile.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_one_type_can_be_muted_without_the_rest(self):
        """The per-type list layers on top of the coarse category, never instead of it."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.muted_notification_types = ['course_new_lesson']
        profile.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        self.assertEqual(self.notif_count(self.student, 'course_new_post'), 1)

    def test_settings_are_the_instructors_alone_to_change(self):
        course = self.make_course()
        res = self.as_(self.student).patch(
            f'/api/taught-courses/{course.pk}/', {'discussion_mode': 'off'}, format='json'
        )
        self.assertEqual(res.status_code, 404)
        ok = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/', {'discussion_mode': 'public'}, format='json'
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
            f'/api/taught-courses/{course.pk}/', {'summary': 'now with more rigour'}, format='json'
        )
        self.assertEqual(edited.status_code, 200)

        refused = self.as_(self.other).delete(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(refused.status_code, 404)
        self.assertTrue(TaughtCourse.objects.filter(pk=course.pk).exists())

        allowed = self.as_(self.instructor).delete(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(allowed.status_code, 204)

    def test_an_assistant_curates_content_but_cannot_touch_settings_or_staff(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        client = self.as_(self.other)

        made = client.post(
            f'/api/taught-courses/{course.pk}/chapters/', {'title': 'Week 1'}, format='json'
        )
        self.assertEqual(made.status_code, 201)

        # Settings and the staff list are an administrator's, and an assistant is not one.
        self.assertEqual(
            client.patch(
                f'/api/taught-courses/{course.pk}/', {'title': 'renamed'}, format='json'
            ).status_code,
            404,
        )
        self.assertEqual(
            client.post(
                f'/api/taught-courses/{course.pk}/staff/',
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
            f'/api/taught-courses/{course.pk}/staff/{owner_row.pk}/',
            {'role': 'assistant'},
            format='json',
        )
        self.assertEqual(demote.status_code, 400)
        self.assertEqual(demote.data['detail'], 'owner_immutable')

        remove = client.delete(f'/api/taught-courses/{course.pk}/staff/{owner_row.pk}/')
        self.assertEqual(remove.status_code, 400)
        self.assertEqual(course.staff.get(pk=owner_row.pk).role, 'owner')

    def test_promoting_a_participant_gives_up_their_seat(self):
        """Otherwise one person counts twice against capacity — once as staff, once on the roster."""
        course = self.make_course(capacity=2)
        Enrollment.objects.create(course=course, participant=self.student, status='active')
        self.assertEqual(course.active_participant_count, 1)

        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/staff/',
            {'user_id': self.student.pk, 'role': 'assistant'},
            format='json',
        )
        self.assertEqual(course.active_participant_count, 0)
        self.assertEqual(course.role_of(self.student), 'assistant')

    def test_staff_cannot_enrol_as_participants(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        response = self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'instructor_cannot_enrol')

    def test_a_co_teacher_sees_the_course_in_their_own_teaching_list(self):
        course = self.make_course(visibility='only_you')
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        mine = self.as_(self.other).get('/api/taught-courses/?mine=teaching')
        self.assertIn(course.pk, [c['id'] for c in mine.data])

    def test_the_roster_is_readable_by_staff_and_participants_but_not_strangers(self):
        course = self.make_course()
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        Enrollment.objects.create(course=course, participant=self.student, status='active')

        self.assertEqual(
            self.as_(self.other).get(f'/api/taught-courses/{course.pk}/staff/').status_code, 200
        )
        self.assertEqual(
            self.as_(self.student).get(f'/api/taught-courses/{course.pk}/staff/').status_code, 200
        )
        outsider = User.objects.create_user('zosia', 'z@x.example', 'pw12345!')
        self.assertEqual(
            self.as_(outsider).get(f'/api/taught-courses/{course.pk}/staff/').status_code, 403
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
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'contributions_closed')

    def test_a_non_participant_cannot_contribute_even_when_the_course_is_open_to_it(self):
        course = self.make_course(contribution_policy='open')
        response = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_a_participant')

    def test_under_approval_a_submission_waits_and_is_invisible_to_other_participants(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)

        created = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['status'], 'pending')

        # The submitter still sees their own, waiting — otherwise it looks like it vanished.
        mine = self.as_(self.student).get(f'/api/taught-courses/{course.pk}/items/')
        self.assertEqual([i['id'] for i in mine.data], [created.data['id']])
        # Another participant sees nothing at all.
        theirs = self.as_(self.other).get(f'/api/taught-courses/{course.pk}/items/')
        self.assertEqual(theirs.data, [])
        # Staff see it, because acting on it is their job.
        staff = self.as_(self.instructor).get(f'/api/taught-courses/{course.pk}/items/')
        self.assertEqual(len(staff.data), 1)

    def test_every_member_of_staff_is_told_about_a_submission(self):
        course = self.make_course(contribution_policy='approval')
        CourseStaff.objects.create(course=course, user=self.other, role='assistant')
        self._enrol(self.student, course)

        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
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
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        approved = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/items/{item_id}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data['status'], 'approved')
        self.assertEqual(approved.data['decided_by']['id'], self.instructor.pk)

        visible = self.as_(self.other).get(f'/api/taught-courses/{course.pk}/items/')
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
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        rejected = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/items/{item_id}/',
            {'decision': 'reject', 'decision_note': 'Already covered by week 2.'},
            format='json',
        )
        self.assertEqual(rejected.data['status'], 'rejected')
        self.assertEqual(rejected.data['decision_note'], 'Already covered by week 2.')
        self.assertEqual(self.as_(self.other).get(f'/api/taught-courses/{course.pk}/items/').data, [])

    def test_under_the_open_policy_a_participant_publishes_directly(self):
        course = self.make_course(contribution_policy='open')
        self._enrol(self.student, course)
        created = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.data['status'], 'approved')

    def test_staff_never_queue_behind_themselves(self):
        course = self.make_course(contribution_policy='approval')
        created = self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(created.data['status'], 'approved')

    def test_a_contributor_may_withdraw_their_own_pending_submission_but_not_somebody_elses(self):
        course = self.make_course(contribution_policy='approval')
        self._enrol(self.student, course)
        self._enrol(self.other, course)
        mine = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        ).data['id']

        self.assertEqual(
            self.as_(self.other).delete(
                f'/api/taught-courses/{course.pk}/items/{mine}/'
            ).status_code,
            404,
        )
        self.assertEqual(
            self.as_(self.student).delete(
                f'/api/taught-courses/{course.pk}/items/{mine}/'
            ).status_code,
            204,
        )

    def test_the_same_thing_cannot_be_added_to_one_course_twice(self):
        course = self.make_course(contribution_policy='open')
        self._enrol(self.student, course)
        client = self.as_(self.student)
        first = client.post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(first.status_code, 201)
        second = client.post(
            f'/api/taught-courses/{course.pk}/items/', {'material': self.material.pk}, format='json'
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['detail'], 'already_in_course')

    def test_an_item_must_name_exactly_one_thing(self):
        course = self.make_course()
        neither = self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/items/', {}, format='json'
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
        return CourseItem.objects.create(
            course=self.course, chapter=chapter, material=self.material, status='approved'
        )

    def test_a_locked_chapter_still_appears_but_its_contents_do_not(self):
        chapter = self._chapter(unlocks_at=timezone.now() + timedelta(days=7))
        self._item_in(chapter)

        seen = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/chapters/')
        self.assertEqual(len(seen.data), 1, 'the chapter itself must remain visible')
        self.assertFalse(seen.data[0]['is_unlocked'])
        self.assertIsNotNone(seen.data[0]['unlocks_at'])
        self.assertEqual(seen.data[0]['items'], [], 'contents must stay shut')

    def test_staff_can_read_a_locked_chapter_because_they_have_to_prepare_it(self):
        chapter = self._chapter(unlocks_at=timezone.now() + timedelta(days=7))
        self._item_in(chapter)
        seen = self.as_(self.instructor).get(f'/api/taught-courses/{self.course.pk}/chapters/')
        self.assertEqual(len(seen.data[0]['items']), 1)
        self.assertFalse(seen.data[0]['is_unlocked'], 'still shut, just readable by staff')

    def test_a_chapter_whose_date_has_passed_is_open(self):
        chapter = self._chapter(unlocks_at=timezone.now() - timedelta(minutes=1))
        self._item_in(chapter)
        seen = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/chapters/')
        self.assertTrue(seen.data[0]['is_unlocked'])
        self.assertEqual(len(seen.data[0]['items']), 1)

    def test_a_chapter_with_no_date_is_simply_always_open(self):
        chapter = self._chapter()
        self._item_in(chapter)
        seen = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/chapters/')
        self.assertTrue(seen.data[0]['is_unlocked'])
        self.assertEqual(len(seen.data[0]['items']), 1)

    def test_deleting_a_chapter_keeps_its_content_unfiled(self):
        chapter = self._chapter()
        item = self._item_in(chapter)
        self.as_(self.instructor).delete(
            f'/api/taught-courses/{self.course.pk}/chapters/{chapter.pk}/'
        )
        item.refresh_from_db()
        self.assertIsNone(item.chapter_id)
        self.assertTrue(CourseItem.objects.filter(pk=item.pk).exists())

    def test_an_item_cannot_be_filed_into_another_courses_chapter(self):
        elsewhere = Chapter.objects.create(
            course=self.make_course(title='Different course'), title='Theirs'
        )
        item = CourseItem.objects.create(
            course=self.course, material=self.material, status='approved'
        )
        response = self.as_(self.instructor).patch(
            f'/api/taught-courses/{self.course.pk}/items/{item.pk}/',
            {'chapter': elsewhere.pk},
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
            f'/api/taught-courses/{self.course.pk}/invites/', kwargs, format='json'
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_only_administrators_may_mint_a_link(self):
        CourseStaff.objects.create(course=self.course, user=self.other, role='assistant')
        self.assertEqual(
            self.as_(self.other).post(
                f'/api/taught-courses/{self.course.pk}/invites/', {}, format='json'
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
            f'/api/taught-courses/{course.pk}/invites/', {}, format='json'
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
            f'/api/taught-courses/{self.course.pk}/invites/{invite["id"]}/'
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
        return self.as_(user).post('/api/taught-courses/', {'title': title}, format='json')

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
        self.assertEqual(TaughtCourse.objects.filter(instructor=self.instructor).count(), 2)

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

        self.assertEqual(TaughtCourse.objects.filter(instructor=self.instructor).count(), 2)
        self.assertEqual(self._create(self.instructor, 'C').status_code, 400)


class CourseUploadQuotaTests(ApiTestCase):
    """`TaughtCourse.upload_quota_bytes` — a cap on the total stored bytes one course holds."""

    def setUp(self):
        super().setUp()
        self.course = TaughtCourse.objects.create(
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
            f'/api/taught-courses/{self.course.pk}/items/',
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
