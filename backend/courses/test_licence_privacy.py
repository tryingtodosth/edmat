"""A course's licence, one item's own audience, and inviting people by email (2026-11-02).

Owner: "in course creation we want to be able to select license for coop and materials on this
course (a subtle warning on a content/material marked otherwise — e.g. a link to a material in the
main material repo); also adding collaborators from that place (with whom you are connected, or
adding by mail)" and "different privacy settings per content".

Weighted at the properties that fail silently: a staff-only item reaching a participant through a
side door (the lesson serializer, the materials index, the search), a PATCH that relicenses a
course without a record, a mailed invite whose working link sits in the mail log, and a form that
tells an inviter whether an address has an account.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from licensing.licences import compare_to_container
from licensing.models import LicenceChange
from mail.models import ConfirmedEmail, OutboundEmail
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material

from .models import Chapter, Course, CourseInvite, CourseItem, CourseStaff, Enrollment, Lesson


class CourseLicenceTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.owner = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        self.student = User.objects.create_user('jan', 'jan@x.example', 'pw12345!')
        self.stranger = User.objects.create_user('obcy', 'obcy@x.example', 'pw12345!')
        # The creation gate (`config/creation.py`) lets verified contributors found a course; the
        # founder here is one, as in `tests.py`.
        self.owner.profile.is_verified_contributor = True
        self.owner.profile.save(update_fields=['is_verified_contributor'])
        self.branch = make_branch('analiza-lp')
        self.course = Course.objects.create(
            instructor=self.owner,
            title='Analiza razem',
            visibility='public',
            status='open',
            licence='cc-by-sa-4.0',
        )
        Enrollment.objects.create(course=self.course, participant=self.student, status='active')
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1', order=0)
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon', order=0)

    def as_(self, user):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        return client


# --- the pure comparison ---------------------------------------------------------------------


class CompareToContainerTests(TestCase):
    def test_every_relation(self):
        self.assertEqual(compare_to_container('cc-by-sa-4.0', 'cc-by-sa-4.0'), 'same')
        self.assertEqual(compare_to_container('cc0-1.0', 'cc-by-sa-4.0'), 'wider')
        self.assertEqual(compare_to_container('cc-by-4.0', 'cc-by-sa-4.0'), 'wider')
        self.assertEqual(compare_to_container('edmat-only', 'cc-by-sa-4.0'), 'narrower')
        self.assertEqual(compare_to_container('cc-by-nc-4.0', 'cc-by-sa-4.0'), 'different')
        self.assertEqual(compare_to_container('unknown', 'cc-by-4.0'), 'unclear')
        # A public item in an "EdMat only" course grants more than the course does — nothing to say.
        self.assertEqual(compare_to_container('cc-by-4.0', 'edmat-only'), 'wider')


# --- the course's own licence ------------------------------------------------------------------


class CourseLicenceTests(CourseLicenceTestCase):
    def test_chosen_on_create_and_read_back(self):
        res = self.as_(self.owner).post(
            '/api/courses/',
            {'title': 'Nowy', 'audience': 'university', 'licence': 'cc-by-4.0'},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['licence'], 'cc-by-4.0')
        self.assertEqual(Course.objects.get(pk=res.data['id']).licence, 'cc-by-4.0')

    def test_absent_is_edmat_only_and_unknown_is_refused(self):
        res = self.as_(self.owner).post(
            '/api/courses/', {'title': 'Bez', 'audience': 'university'}, format='json'
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['licence'], 'edmat-only')
        res = self.as_(self.owner).post(
            '/api/courses/',
            {'title': 'Zły', 'audience': 'university', 'licence': 'unknown'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['licence'], ['licence_not_selectable'])

    def test_a_patch_cannot_relicense_but_may_send_the_same_value(self):
        res = self.as_(self.owner).patch(
            f'/api/courses/{self.course.pk}/', {'licence': 'cc0-1.0'}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['licence'], ['licence_change_via_licences'])
        res = self.as_(self.owner).patch(
            f'/api/courses/{self.course.pk}/',
            {'licence': 'cc-by-sa-4.0', 'title': 'Analiza razem 2'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Analiza razem 2')
        self.assertEqual(self.course.licence, 'cc-by-sa-4.0')

    def test_widened_through_the_licence_endpoint_with_a_record(self):
        res = self.as_(self.owner).post(
            f'/api/licences/course/{self.course.pk}/', {'licence': 'cc-by-4.0'}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.course.refresh_from_db()
        self.assertEqual(self.course.licence, 'cc-by-4.0')
        self.assertEqual(LicenceChange.objects.filter(object_id=self.course.pk).count(), 1)
        # Narrowing back is refused, like every other licensed thing.
        res = self.as_(self.owner).post(
            f'/api/licences/course/{self.course.pk}/', {'licence': 'edmat-only'}, format='json'
        )
        self.assertEqual(res.data['detail'], 'licence_narrowing')

    def test_an_assistants_writing_blocks_a_change_and_a_participant_cannot_change_it(self):
        assistant = User.objects.create_user('asia', 'asia@x.example', 'pw12345!')
        CourseStaff.objects.create(course=self.course, user=assistant, role='assistant')
        res = self.as_(self.owner).post(
            f'/api/licences/course/{self.course.pk}/', {'licence': 'cc-by-4.0'}, format='json'
        )
        self.assertEqual(res.data['detail'], 'licence_other_contributors')
        res = self.as_(self.student).post(
            f'/api/licences/course/{self.course.pk}/', {'licence': 'cc-by-4.0'}, format='json'
        )
        self.assertEqual(res.status_code, 403)

    def test_a_private_courses_licence_is_readable_inside_and_404_outside(self):
        self.course.visibility = 'private'
        self.course.save()
        self.assertEqual(
            self.as_(self.student).get(f'/api/licences/course/{self.course.pk}/').status_code, 200
        )
        self.assertEqual(
            self.as_(self.stranger).get(f'/api/licences/course/{self.course.pk}/').status_code, 404
        )
        self.assertEqual(self.as_(None).get(f'/api/licences/course/{self.course.pk}/').status_code, 404)

    def test_the_bulk_list_does_not_grow_a_course_kind(self):
        res = self.as_(self.owner).get('/api/licences/mine/')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('course', res.data['kinds'])


class LinkedItemLicenceTests(CourseLicenceTestCase):
    def file(self, **target):
        return CourseItem.objects.create(course=self.course, chapter=self.chapter, **target)

    def items(self, user):
        return {row['id']: row for row in self.as_(user).get(f'/api/courses/{self.course.pk}/items/').data}

    def test_each_item_says_its_own_licence_and_how_it_sits_with_the_course(self):
        narrow = make_material(self.branch, slug='m-narrow')  # edmat-only by default
        nc = make_material(self.branch, slug='m-nc')
        nc.licence = 'cc-by-nc-4.0'
        nc.save()
        exercise = make_exercise(self.branch, number=1)
        exercise.licence = 'unknown'
        exercise.save()
        wide = make_material(self.branch, slug='m-wide')
        wide.licence = 'cc0-1.0'
        wide.save()
        rows = {
            'narrow': self.file(material=narrow),
            'nc': self.file(material=nc),
            'ex': self.file(exercise=exercise),
            'wide': self.file(material=wide),
            'link': self.file(link_url='https://example.com/', link_title='Outside'),
        }
        data = self.items(self.student)
        self.assertEqual(data[rows['narrow'].pk]['licence_relation'], 'narrower')
        self.assertEqual(data[rows['narrow'].pk]['target_licence'], 'edmat-only')
        self.assertEqual(data[rows['nc'].pk]['licence_relation'], 'different')
        self.assertEqual(data[rows['ex'].pk]['licence_relation'], 'unclear')
        self.assertEqual(data[rows['wide'].pk]['licence_relation'], 'wider')
        # An outside link carries no licence of this site's.
        self.assertIsNone(data[rows['link'].pk]['licence_relation'])
        self.assertIsNone(data[rows['link'].pk]['target_licence'])

    def test_linking_never_changes_the_materials_own_licence(self):
        material = make_material(self.branch, slug='m-own')
        self.as_(self.owner).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': material.pk, 'chapter': self.chapter.pk},
            format='json',
        )
        material.refresh_from_db()
        self.assertEqual(material.licence, 'edmat-only')


class AttachmentLicenceTests(CourseLicenceTestCase):
    def upload(self, user, **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from testing.factories import pdf_bytes

        payload = {
            'file': SimpleUploadedFile('notes.pdf', pdf_bytes(2048), content_type='application/pdf'),
            'title': 'Notes',
        }
        payload.update(extra)
        return self.as_(user).post(
            f'/api/courses/{self.course.pk}/attachments/', payload, format='multipart'
        )

    def test_absent_takes_the_courses_licence_and_a_choice_is_kept(self):
        res = self.upload(self.owner)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['licence'], 'cc-by-sa-4.0')
        res = self.upload(self.owner, licence='edmat-only')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['licence'], 'edmat-only')

    def test_unknown_is_not_a_choice(self):
        res = self.upload(self.owner, licence='unknown')
        self.assertEqual(res.status_code, 400)

    def test_only_its_uploader_may_widen_it(self):
        res = self.upload(self.owner, licence='edmat-only')
        pk = res.data['id']
        self.assertEqual(
            self.as_(self.student).get(f'/api/licences/course_attachment/{pk}/').status_code, 200
        )
        self.assertEqual(
            self.as_(self.stranger).get(f'/api/licences/course_attachment/{pk}/').status_code, 404
        )
        res = self.as_(self.owner).post(
            f'/api/licences/course_attachment/{pk}/', {'licence': 'cc-by-4.0'}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.data)


# --- one item's own audience -------------------------------------------------------------------


class ItemVisibilityTests(CourseLicenceTestCase):
    def setUp(self):
        super().setUp()
        self.public_m = make_material(self.branch, slug='open-one', title='Open handout')
        self.cohort_m = make_material(self.branch, slug='cohort-one', title='Cohort paper')
        self.staff_m = make_material(self.branch, slug='staff-one', title='Answer key')
        self.public_item = CourseItem.objects.create(
            course=self.course, lesson=self.lesson, material=self.public_m
        )
        self.cohort_item = CourseItem.objects.create(
            course=self.course, lesson=self.lesson, material=self.cohort_m, visibility='participants'
        )
        self.staff_item = CourseItem.objects.create(
            course=self.course, lesson=self.lesson, material=self.staff_m, visibility='staff'
        )

    def item_ids(self, user):
        return {row['id'] for row in self.as_(user).get(f'/api/courses/{self.course.pk}/items/').data}

    def test_the_item_list_narrows_per_reader(self):
        self.assertEqual(
            self.item_ids(self.owner),
            {self.public_item.pk, self.cohort_item.pk, self.staff_item.pk},
        )
        self.assertEqual(self.item_ids(self.student), {self.public_item.pk, self.cohort_item.pk})
        self.assertEqual(self.item_ids(self.stranger), {self.public_item.pk})
        self.assertEqual(self.item_ids(None), {self.public_item.pk})

    def test_the_lesson_serializer_narrows_the_same_way(self):
        res = self.as_(self.student).get(f'/api/courses/{self.course.pk}/')
        lesson_items = [
            item['id']
            for chapter in res.data['chapters']
            for lesson in chapter['lessons']
            for item in lesson['items']
        ]
        self.assertIn(self.cohort_item.pk, lesson_items)
        self.assertNotIn(self.staff_item.pk, lesson_items)

    def test_the_materials_index_narrows_the_same_way(self):
        def ids(user):
            res = self.as_(user).get(f'/api/courses/{self.course.pk}/materials/')
            self.assertEqual(res.status_code, 200)
            rows = res.data if isinstance(res.data, list) else res.data.get('materials', res.data)
            return {row['material'] for row in rows}

        self.assertNotIn(self.staff_m.pk, ids(self.student))
        self.assertIn(self.cohort_m.pk, ids(self.student))
        self.assertNotIn(self.cohort_m.pk, ids(self.stranger))
        self.assertIn(self.staff_m.pk, ids(self.owner))

    def test_the_search_narrows_the_same_way(self):
        res = self.as_(self.student).get(f'/api/courses/{self.course.pk}/search/?q=Answer')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('Answer key', str(res.data))
        res = self.as_(self.owner).get(f'/api/courses/{self.course.pk}/search/?q=Answer')
        self.assertIn('Answer key', str(res.data))

    def test_a_participant_may_not_narrow_but_a_curator_may(self):
        self.course.contribution_policy = 'open'
        self.course.save()
        extra = make_material(self.branch, slug='extra-one')
        res = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/items/',
            {'material': extra.pk, 'visibility': 'staff'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['visibility'], ['item_visibility_curators_only'])
        res = self.as_(self.owner).patch(
            f'/api/courses/{self.course.pk}/items/{self.public_item.pk}/',
            {'visibility': 'participants'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['visibility'], 'participants')
        self.assertNotIn(self.public_item.pk, self.item_ids(self.stranger))

    def test_the_submitter_still_sees_an_offer_narrowed_to_staff(self):
        self.course.contribution_policy = 'open'
        self.course.save()
        extra = make_material(self.branch, slug='mine-one')
        res = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/items/', {'material': extra.pk}, format='json'
        )
        self.assertEqual(res.status_code, 201, res.data)
        pk = res.data['id']
        self.as_(self.owner).patch(
            f'/api/courses/{self.course.pk}/items/{pk}/', {'visibility': 'staff'}, format='json'
        )
        self.assertIn(pk, self.item_ids(self.student))
        other = User.objects.create_user('ewa', 'ewa@x.example', 'pw12345!')
        Enrollment.objects.create(course=self.course, participant=other, status='active')
        self.assertNotIn(pk, self.item_ids(other))


# --- inviting by email -------------------------------------------------------------------------


class EmailInviteTests(CourseLicenceTestCase):
    def setUp(self):
        super().setUp()
        ConfirmedEmail.objects.create(user=self.owner, email=self.owner.email)
        mail.outbox = []

    def send(self, user, emails, role='assistant'):
        # The mail is queued in the request and delivered on commit (`mail/services.py`), which a
        # TestCase never reaches without being asked to.
        with self.captureOnCommitCallbacks(execute=True):
            return self.as_(user).post(
                f'/api/courses/{self.course.pk}/email-invites/',
                {'emails': emails, 'role': role},
                format='json',
            )

    def test_a_mailed_invite_is_a_single_use_invite_with_the_link_built_at_send_time(self):
        res = self.send(self.owner, 'anna@uni.example')
        self.assertEqual(res.status_code, 200, res.data)
        row = res.data['results'][0]
        self.assertTrue(row['ok'])
        invite = CourseInvite.objects.get(pk=row['invite']['id'])
        self.assertEqual(invite.sent_to, 'anna@uni.example')
        self.assertEqual(invite.max_uses, 1)
        self.assertEqual(invite.role, 'assistant')
        self.assertIsNotNone(invite.expires_at)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(f'/courses/join/{invite.token}', mail.outbox[0].body)
        self.assertIn('Analiza razem', mail.outbox[0].subject)
        logged = OutboundEmail.objects.get(kind=OutboundEmail.KIND_COURSE_INVITE)
        self.assertNotIn(invite.token, logged.body)
        self.assertIn(OutboundEmail.LINK_MARKER, logged.body)

    def test_the_answer_is_the_same_for_a_members_address_and_a_strangers(self):
        res = self.send(self.owner, [self.stranger.email, 'nobody@nowhere.example'])
        results = res.data['results']
        self.assertEqual([r['ok'] for r in results], [True, True])
        self.assertEqual([r['reason'] for r in results], ['', ''])
        # And nobody became staff by having an account with that address.
        self.assertFalse(self.course.staff.filter(user=self.stranger).exists())

    def test_the_mailed_link_joins_as_the_role_once(self):
        res = self.send(self.owner, self.stranger.email, role='admin')
        token = CourseInvite.objects.get(pk=res.data['results'][0]['invite']['id']).token
        res = self.as_(self.stranger).post(f'/api/course-invites/{token}/accept/')
        self.assertIn(res.status_code, (200, 201), res.data)
        self.assertEqual(self.course.staff.get(user=self.stranger).role, 'admin')
        other = User.objects.create_user('ktos', 'ktos@x.example', 'pw12345!')
        res = self.as_(other).post(f'/api/course-invites/{token}/accept/')
        self.assertEqual(res.data['detail'], 'used_up')

    def test_refusals_each_with_a_reason(self):
        self.send(self.owner, 'anna@uni.example')
        res = self.send(self.owner, ['anna@uni.example', 'not-an-address', self.owner.email])
        self.assertEqual(
            [r['reason'] for r in res.data['results']],
            ['already_invited', 'email_invalid', 'email_is_you'],
        )
        res = self.send(self.owner, [f'p{i}@x.example' for i in range(21)])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'email_invite_too_many')
        res = self.send(self.owner, '')
        self.assertEqual(res.data['detail'], 'email_invite_no_addresses')
        res = self.send(self.owner, 'b@x.example', role='owner')
        self.assertEqual(res.data['detail'], 'email_invite_role')

    def test_a_revoked_invite_does_not_block_a_new_one(self):
        first = self.send(self.owner, 'anna@uni.example').data['results'][0]['invite']['id']
        CourseInvite.objects.filter(pk=first).update(revoked_at=timezone.now())
        self.assertTrue(self.send(self.owner, 'anna@uni.example').data['results'][0]['ok'])

    def test_only_an_administrator_with_a_confirmed_address(self):
        self.assertEqual(self.send(self.student, 'x@x.example').status_code, 404)
        admin = User.objects.create_user('adam', 'adam@x.example', 'pw12345!')
        CourseStaff.objects.create(course=self.course, user=admin, role='admin')
        res = self.send(admin, 'x@x.example')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['detail'], 'email_not_confirmed')
        self.assertEqual(len(mail.outbox), 0)

    def test_the_daily_budget_is_recounted(self):
        from . import mailinvite

        for i in range(mailinvite.MAX_PER_DAY):
            CourseInvite.objects.create(
                course=self.course, token=CourseInvite.new_token(), created_by=self.owner,
                sent_to=f'old{i}@x.example', max_uses=1,
            )
        res = self.send(self.owner, 'late@x.example')
        self.assertEqual(res.data['results'][0]['reason'], 'daily_limit')

    def test_the_preview_says_the_courses_licence(self):
        res = self.send(self.owner, 'anna@uni.example')
        token = CourseInvite.objects.get(pk=res.data['results'][0]['invite']['id']).token
        res = self.as_(None).get(f'/api/course-invites/{token}/')
        self.assertEqual(res.data['course_licence'], 'cc-by-sa-4.0')

    def test_retention_forgets_the_address_after_thirty_days(self):
        from accounts.retention import enforce

        res = self.send(self.owner, 'anna@uni.example')
        pk = res.data['results'][0]['invite']['id']
        self.assertEqual(enforce()['invite_address'], 0)
        CourseInvite.objects.filter(pk=pk).update(created_at=timezone.now() - timedelta(days=31))
        self.assertEqual(enforce()['invite_address'], 1)
        invite = CourseInvite.objects.get(pk=pk)
        self.assertEqual(invite.sent_to, '')
        self.assertIsNone(invite.revoked_at)


# --- one file's own audience (the follow-up, 2026-11-02) ----------------------------------------


class AttachmentVisibilityTests(CourseLicenceTestCase):
    def setUp(self):
        super().setUp()
        self.other = User.objects.create_user('ewa2', 'ewa2@x.example', 'pw12345!')
        Enrollment.objects.create(course=self.course, participant=self.other, status='active')
        self.course.contribution_policy = 'open'
        self.course.save()

    def upload(self, user, **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from testing.factories import pdf_bytes

        payload = {
            'file': SimpleUploadedFile('key.pdf', pdf_bytes(2048), content_type='application/pdf'),
            'title': 'Answer key',
        }
        payload.update(extra)
        return self.as_(user).post(
            f'/api/courses/{self.course.pk}/attachments/', payload, format='multipart'
        )

    def listed(self, user):
        res = self.as_(user).get(f'/api/courses/{self.course.pk}/attachments/')
        return {row['id'] for row in res.data} if res.status_code == 200 else set()

    def test_a_staff_only_file_leaves_every_participant_door(self):
        res = self.upload(self.owner, visibility='staff')
        self.assertEqual(res.status_code, 201, res.data)
        pk = res.data['id']
        self.assertEqual(res.data['visibility'], 'staff')
        self.assertIn(pk, self.listed(self.owner))
        self.assertNotIn(pk, self.listed(self.student))
        base = f'/api/courses/{self.course.pk}/attachments/{pk}/'
        self.assertEqual(self.as_(self.student).get(base).status_code, 404)
        self.assertEqual(self.as_(self.student).get(base + 'reviews/').status_code, 404)
        self.assertEqual(self.as_(self.student).get(base + 'comments/').status_code, 404)
        res = self.as_(self.student).get(f'/api/courses/{self.course.pk}/search/?q=Answer')
        self.assertNotIn('Answer key', str(res.data))
        # A course item pointing at it is dropped for a participant too.
        item = CourseItem.objects.create(course=self.course, attachment_id=pk, chapter=self.chapter)
        ids = {r['id'] for r in self.as_(self.student).get(f'/api/courses/{self.course.pk}/items/').data}
        self.assertNotIn(item.pk, ids)

    def test_a_participant_hands_a_file_to_the_teacher_alone(self):
        res = self.upload(self.student, visibility='staff', title='My homework')
        self.assertEqual(res.status_code, 201, res.data)
        pk = res.data['id']
        self.assertIn(pk, self.listed(self.student))
        self.assertIn(pk, self.listed(self.owner))
        self.assertNotIn(pk, self.listed(self.other))
        self.assertTrue(res.data['can_change_visibility'])

    def test_who_may_change_it(self):
        pk = self.upload(self.student).data['id']
        url = f'/api/courses/{self.course.pk}/attachments/{pk}/'
        # Another participant sees it but may not touch its audience: 404, as for a delete.
        self.assertEqual(
            self.as_(self.other).patch(url, {'visibility': 'staff'}, format='json').status_code, 404
        )
        self.assertFalse(self.as_(self.other).get(url).data['can_change_visibility'])
        # A curator may.
        res = self.as_(self.owner).patch(url, {'visibility': 'staff'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['visibility'], 'staff')
        self.assertNotIn(pk, self.listed(self.other))
        # Its uploader still sees it and may widen it back.
        res = self.as_(self.student).patch(url, {'visibility': 'participants'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIn(pk, self.listed(self.other))
        res = self.as_(self.owner).patch(url, {'visibility': 'public'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['visibility'], ['attachment_visibility_unknown'])


# --- a pinned set's own audience ------------------------------------------------------------------


class SetVisibilityTests(CourseLicenceTestCase):
    def setUp(self):
        super().setUp()
        from study.models import ExerciseSet, ExerciseSetItem

        self.source = ExerciseSet.objects.create(owner=self.owner, name='Old exam', is_public=True)
        ExerciseSetItem.objects.create(
            exercise_set=self.source, exercise=make_exercise(self.branch, number=7), order=0
        )
        self.url = f'/api/courses/{self.course.pk}/chapters/{self.chapter.pk}/exercise-sets/'

    def chapter_sets(self, user):
        res = self.as_(user).get(f'/api/courses/{self.course.pk}/')
        return [
            link['id']
            for chapter in res.data['chapters']
            for link in chapter['exercise_sets']
        ]

    def test_a_staff_only_set_leaves_the_participants_page_and_list(self):
        res = self.as_(self.owner).post(
            self.url, {'set': self.source.slug, 'visibility': 'staff'}, format='json'
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['visibility'], 'staff')
        pk = res.data['id']
        self.assertIn(pk, self.chapter_sets(self.owner))
        self.assertNotIn(pk, self.chapter_sets(self.student))
        listed = self.as_(self.student).get(self.url).data
        self.assertNotIn(pk, [row['id'] for row in listed])

    def test_participants_only_and_changing_it(self):
        pk = self.as_(self.owner).post(
            self.url, {'set': self.source.slug, 'visibility': 'participants'}, format='json'
        ).data['id']
        self.assertIn(pk, self.chapter_sets(self.student))
        self.assertNotIn(pk, self.chapter_sets(self.stranger))
        res = self.as_(self.owner).patch(f'{self.url}{pk}/', {'visibility': 'course'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIn(pk, self.chapter_sets(self.stranger))
        res = self.as_(self.owner).patch(f'{self.url}{pk}/', {'visibility': 'nobody'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['visibility'], ['item_visibility_unknown'])
