"""DSA Art. 16 legal notices: who may file (anyone, even a guest, but always with a real contact
email), who may see one (staff, or its own notifier), that a staff decision requires a real stated
reason (Art. 17), that acting on a resolved content reference actually mutates the content and
notifies its own author, and that the notifier is told the outcome (Art. 16(6))."""

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from rest_framework.test import APIClient

from community.models import Comment
from django.test import TestCase
from exercises.models import Exercise
from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise

from .models import LegalNotice


class LegalNoticeTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        # The 'legal_notice' scoped throttle (10/hour) counts through Django's process-wide cache,
        # which persists across test methods even though the database rolls back — and several test
        # classes below file more than 10 notices across the whole module. Without this, tests start
        # silently 429ing partway through the run (accounts/test_throttling.py hit the identical
        # trap first and established this exact fix).
        cache.clear()
        self.notifier = User.objects.create_user('ania', 'ania@x.example', 'pw12345!')
        self.other = User.objects.create_user('piotr', 'piotr@x.example', 'pw12345!')
        self.staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        self.anon = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def file(self, client, **extra):
        payload = {
            'content_url': 'https://edmat.example/exercises/1',
            'explanation': 'This reproduces a copyrighted exam verbatim.',
            'good_faith_confirmed': True,
            'contact_email': 'notifier@x.example',
        }
        payload.update(extra)
        return client.post('/api/legal-notices/', payload, format='json')


class FilingTests(LegalNoticeTestCase):
    def test_a_guest_can_file_and_contact_email_is_kept(self):
        res = self.file(self.anon)
        self.assertEqual(res.status_code, 201)
        notice = LegalNotice.objects.get()
        self.assertIsNone(notice.reporter)
        self.assertEqual(notice.contact_email, 'notifier@x.example')
        self.assertEqual(notice.status, 'open')

    def test_a_signed_in_notice_carries_the_reporter(self):
        res = self.file(self.as_(self.notifier))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(LegalNotice.objects.get().reporter, self.notifier)

    def test_contact_email_is_required_even_for_a_guest(self):
        res = self.file(self.anon, contact_email='')
        self.assertEqual(res.status_code, 400)
        self.assertIn('contact_email', res.data)

    def test_good_faith_confirmation_must_actually_be_true(self):
        res = self.file(self.anon, good_faith_confirmed=False)
        self.assertEqual(res.status_code, 400)
        self.assertIn('good_faith_confirmed', res.data)

    def test_content_url_is_required(self):
        res = self.file(self.anon, content_url='')
        self.assertEqual(res.status_code, 400)


class VisibilityTests(LegalNoticeTestCase):
    def setUp(self):
        super().setUp()
        self.file(self.as_(self.notifier))
        self.notice = LegalNotice.objects.get()

    def test_staff_sees_it(self):
        res = self.as_(self.staff).get('/api/legal-notices/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_the_notifier_sees_their_own(self):
        res = self.as_(self.notifier).get('/api/legal-notices/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_a_different_user_sees_nothing(self):
        res = self.as_(self.other).get('/api/legal-notices/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 0)

    def test_a_guest_cannot_list_at_all(self):
        res = self.anon.get('/api/legal-notices/')
        self.assertIn(res.status_code, (401, 403))


class ResolveTests(LegalNoticeTestCase):
    def setUp(self):
        super().setUp()
        branch = make_branch()
        self.exercise = make_exercise(branch, 1)
        self.comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(Exercise),
            object_id=self.exercise.pk,
            author=self.other,
            body='A reported comment.',
        )
        self.file(self.as_(self.notifier))
        self.notice = LegalNotice.objects.get()

    def test_a_non_staff_user_may_not_resolve(self):
        res = self.as_(self.notifier).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {'status': 'rejected', 'resolve_note': 'Not illegal.'},
            format='json',
        )
        self.assertIn(res.status_code, (401, 403))

    def test_a_reason_is_required_to_decide(self):
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {'status': 'rejected', 'resolve_note': '  '},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('resolve_note', res.data)
        self.notice.refresh_from_db()
        self.assertEqual(self.notice.status, 'open')

    def test_rejecting_notifies_the_notifier_with_the_reason(self):
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {'status': 'rejected', 'resolve_note': 'This is a bare mathematical fact, not a copyrighted work.'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.notice.refresh_from_db()
        self.assertEqual(self.notice.status, 'rejected')
        n = Notification.objects.get(recipient=self.notifier, type='legal_notice_decided')
        self.assertIn('bare mathematical fact', n.note)

    def test_acting_on_a_resolved_comment_removes_it_and_notifies_its_author(self):
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {
                'status': 'acted',
                'resolve_note': 'Confirmed to reproduce copyrighted material; comment removed.',
                'content_kind': 'comment',
                'content_object_id': self.comment.pk,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.comment.refresh_from_db()
        self.assertTrue(self.comment.is_removed)
        # The Art. 17 statement of reasons — the COMMENT'S OWN author (`self.other`), not the
        # notifier, since these are two different DSA obligations.
        owner_note = Notification.objects.get(recipient=self.other, type='content_removed')
        self.assertIn('copyrighted material', owner_note.note)
        # And the notifier is told too (Art. 16(6)), separately.
        self.assertTrue(
            Notification.objects.filter(recipient=self.notifier, type='legal_notice_decided').exists()
        )

    def test_giving_only_one_of_kind_or_id_is_refused(self):
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {'status': 'acted', 'resolve_note': 'x', 'content_kind': 'comment'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_a_resolved_notice_cannot_be_pointed_back_to_open(self):
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/resolve/',
            {'status': 'open', 'resolve_note': 'x'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)


class ContentPreviewTests(LegalNoticeTestCase):
    """Staff being able to see who posted the reported content BEFORE deciding — a real gap found
    live (Piotr: "the report doesn't mention any of the users who posted the reported content?"),
    since `resolve_report_decision`/`_content_owner` only ever routed the Art. 17 notification
    silently, never surfaced the author to the person making the decision."""

    def setUp(self):
        super().setUp()
        branch = make_branch()
        self.exercise = make_exercise(branch, 1)
        self.comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(Exercise),
            object_id=self.exercise.pk,
            author=self.other,
            body='A reported comment, with a real author.',
        )
        self.file(self.as_(self.notifier))
        self.notice = LegalNotice.objects.get()

    def test_a_real_author_is_named(self):
        res = self.as_(self.staff).get(
            f'/api/legal-notices/{self.notice.pk}/content-preview/'
            f'?content_kind=comment&content_object_id={self.comment.pk}'
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['author_id'], self.other.id)
        self.assertEqual(res.data['author_display_name'], 'piotr')
        self.assertIn('A reported comment', res.data['preview'])

    def test_content_with_no_owner_is_honest_about_it(self):
        # make_exercise never sets submitted_by — the same "no real submitter" shape all 742
        # migrated corpus exercises actually have.
        self.assertIsNone(self.exercise.submitted_by_id)
        res = self.as_(self.staff).get(
            f'/api/legal-notices/{self.notice.pk}/content-preview/'
            f'?content_kind=exercise&content_object_id={self.exercise.pk}'
        )
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['author_id'])
        self.assertEqual(res.data['author_display_name'], '')

    def test_an_unknown_content_kind_is_refused(self):
        res = self.as_(self.staff).get(
            f'/api/legal-notices/{self.notice.pk}/content-preview/'
            f'?content_kind=not_a_real_kind&content_object_id={self.comment.pk}'
        )
        self.assertEqual(res.status_code, 400)

    def test_a_nonexistent_id_404s(self):
        res = self.as_(self.staff).get(
            f'/api/legal-notices/{self.notice.pk}/content-preview/'
            '?content_kind=comment&content_object_id=999999'
        )
        self.assertEqual(res.status_code, 404)

    def test_non_staff_is_refused(self):
        res = self.as_(self.notifier).get(
            f'/api/legal-notices/{self.notice.pk}/content-preview/'
            f'?content_kind=comment&content_object_id={self.comment.pk}'
        )
        self.assertIn(res.status_code, (401, 403))


class CommentThreadTests(LegalNoticeTestCase):
    def setUp(self):
        super().setUp()
        self.file(self.as_(self.notifier))
        self.notice = LegalNotice.objects.get()

    def test_the_notifier_can_read_and_post(self):
        res = self.as_(self.notifier).get(f'/api/legal-notices/{self.notice.pk}/comments/')
        self.assertEqual(res.status_code, 200)
        res = self.as_(self.notifier).post(
            f'/api/legal-notices/{self.notice.pk}/comments/', {'body': 'Any update?'}, format='json'
        )
        self.assertEqual(res.status_code, 201)

    def test_staff_can_read_and_reply(self):
        res = self.as_(self.staff).get(f'/api/legal-notices/{self.notice.pk}/comments/')
        self.assertEqual(res.status_code, 200)
        res = self.as_(self.staff).post(
            f'/api/legal-notices/{self.notice.pk}/comments/', {'body': 'Looking into it.'}, format='json'
        )
        self.assertEqual(res.status_code, 201)

    def test_a_different_user_gets_404_not_a_leak(self):
        res = self.as_(self.other).get(f'/api/legal-notices/{self.notice.pk}/comments/')
        self.assertEqual(res.status_code, 404)

    def test_a_guest_gets_404_too(self):
        res = self.anon.get(f'/api/legal-notices/{self.notice.pk}/comments/')
        self.assertEqual(res.status_code, 404)

    def test_a_reply_cannot_be_smuggled_in_from_another_thread(self):
        other_notice_res = self.file(self.as_(self.other))
        other_notice_id = other_notice_res.data['id']
        foreign_comment = self.as_(self.other).post(
            f'/api/legal-notices/{other_notice_id}/comments/', {'body': 'root'}, format='json'
        )
        res = self.as_(self.notifier).post(
            f'/api/legal-notices/{self.notice.pk}/comments/',
            {'body': 'reply', 'parent': foreign_comment.data['id']},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
