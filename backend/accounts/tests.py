"""Part of this project's first real automated test suite (CLAUDE.md Section 17I/17K's own "no
formal automated test suite exists" note) — register/login, the auth flow every other authenticated
action in this app depends on.
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from testing.factories import make_course, make_user, pdf_bytes

User = get_user_model()


class RegisterViewTests(APITestCase):
    def test_registering_creates_a_real_user_and_returns_a_token(self):
        response = self.client.post(
            reverse('auth-register'),
            {'username': 'newperson', 'email': 'newperson@example.com', 'password': 'a-real-password'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('token', response.data)
        user = User.objects.get(username='newperson')
        self.assertTrue(Token.objects.filter(user=user, key=response.data['token']).exists())

    def test_duplicate_email_is_rejected(self):
        make_user('existing')
        User.objects.filter(username='existing').update(email='taken@example.com')

        response = self.client.post(
            reverse('auth-register'),
            {'username': 'someoneelse', 'email': 'taken@example.com', 'password': 'a-real-password'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(username='someoneelse').exists())


class LoginViewTests(APITestCase):
    def setUp(self):
        self.user = make_user('loginuser', password='correct-password')
        self.user.email = 'loginuser@example.com'
        self.user.save(update_fields=['email'])

    def test_login_by_email_succeeds_with_correct_password(self):
        response = self.client.post(
            reverse('auth-login'),
            {'username': 'loginuser@example.com', 'password': 'correct-password'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('token', response.data)

    def test_login_fails_with_wrong_password(self):
        response = self.client.post(
            reverse('auth-login'),
            {'username': 'loginuser@example.com', 'password': 'wrong-password'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn('token', response.data)


class MeViewNodeGovernorTests(APITestCase):
    """`is_node_governor` on ProfileSerializer (GET /auth/me/) — the flag a frontend uses to decide
    whether to show the scoped moderation nav link/route at all for a non-staff user."""

    def test_a_user_with_a_node_governor_grant_shows_true(self):
        from django.contrib.contenttypes.models import ContentType

        from moderation.models import NodeGovernor
        from testing.factories import make_course

        user = make_user('has-a-grant')
        branch = make_course('me-view-branch')
        NodeGovernor.objects.create(
            user=user, content_type=ContentType.objects.get_for_model(type(branch)), object_id=branch.pk
        )
        self.client.force_authenticate(user)

        response = self.client.get(reverse('auth-me'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['is_node_governor'])

    def test_a_plain_user_with_no_grants_shows_false(self):
        self.client.force_authenticate(make_user('no-grants-at-all'))

        response = self.client.get(reverse('auth-me'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['is_node_governor'])


class UserReviewsViewTests(APITestCase):
    """GET /api/users/{id}/reviews/ — the public profile page's own new "their reviews" section
    (CLAUDE.md's tutoring-listings feature note, item 6), for EXERCISE reviews specifically."""

    def test_lists_only_that_users_own_visible_reviews(self):
        from community.models import Review
        from testing.factories import make_course, make_exercise

        branch = make_course('user-reviews-branch')
        exercise = make_exercise(branch, 1)
        author = make_user('review-author')
        someone_else = make_user('review-someone-else')
        Review.objects.create(exercise=exercise, author=author, rating=5, body='Great!')
        Review.objects.create(exercise=exercise, author=someone_else, rating=2, body='Meh.')

        response = self.client.get(reverse('user-reviews', kwargs={'pk': author.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['author'], author.pk)

    def test_a_removed_review_is_excluded(self):
        from community.models import Review
        from testing.factories import make_course, make_exercise

        branch = make_course('user-reviews-removed-branch')
        exercise = make_exercise(branch, 1)
        author = make_user('review-author-removed')
        Review.objects.create(
            exercise=exercise, author=author, rating=1, body='Removed', is_removed=True
        )

        response = self.client.get(reverse('user-reviews', kwargs={'pk': author.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])


class ProfileMaterialUploadQuotaTests(APITestCase):
    """`Profile.material_upload_quota_bytes` and the two properties that make it mean anything —
    the accounting itself, at the model layer. What the upload endpoint DOES with these numbers is
    pinned separately (moderation/tests.py's `MaterialSubmissionStorageQuotaTests`); these are the
    arithmetic, kept here because a wrong sum would fail both places and only one of them would say
    why.

    `MEDIA_ROOT` is redirected at a temporary directory for the whole class, and that is not
    incidental tidiness: these tests store real bytes, and without it they would leave scratch PDFs
    in `backend/media/material_submissions/` alongside genuine uploads — the same mistake
    `accounts/test_throttling.py` records having actually made once with avatars, found by listing
    the directory rather than assumed absent.
    """

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-quota-test-')
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.user = make_user('quota-accounting-user')
        self.branch = make_course(slug='uw-quota-accounting-branch')

    def _store(self, size, *, user=None, title='Stored upload'):
        from moderation.models import MaterialSubmission

        return MaterialSubmission.objects.create(
            branch=self.branch,
            submitted_by=user or self.user,
            type='exam_collection',
            title=title,
            file=SimpleUploadedFile('exam.pdf', pdf_bytes(size)),
        )

    def test_a_brand_new_profile_is_uncapped(self):
        """The default is what keeps this change invisible until an administrator acts — 0, read as
        "no limit" by the same convention `max_courses`/`TaughtCourse.capacity` already use."""
        self.assertEqual(self.user.profile.material_upload_quota_bytes, 0)
        self.assertIsNone(self.user.profile.material_upload_bytes_left)

    def test_an_uncapped_profile_reports_no_room_left_however_much_it_stores(self):
        """`None` means uncapped and is deliberately not `0`, which would read as "full" — the same
        distinction `TaughtCourse.upload_bytes_left`/`seats_left` already draw."""
        self._store(4096)

        self.assertIsNone(self.user.profile.material_upload_bytes_left)

    def test_stored_submissions_are_summed_from_real_bytes(self):
        self._store(1000)
        self._store(2500)

        self.assertEqual(self.user.profile.material_upload_bytes, 3500)

    def test_somebody_elses_uploads_do_not_count_against_this_account(self):
        """The quota is per account, so a shared course must not make one person's uploads spend
        another's allowance."""
        other = make_user('quota-accounting-other')
        self._store(5000, user=other)
        self._store(1200)

        self.assertEqual(self.user.profile.material_upload_bytes, 1200)
        self.assertEqual(other.profile.material_upload_bytes, 5000)

    def test_a_submission_whose_blob_was_reclaimed_counts_for_nothing(self):
        """The reject path clears `file` and stamps `file_reclaimed_at` (moderation/views.py's
        `_reclaim_rejected_material_file`), which is why this sum needs no status filter of its own:
        a row with no bytes occupies no disk, whatever its status says."""
        from django.utils import timezone

        submission = self._store(3000)
        kept = self._store(700, title='Still here')

        submission.file.delete(save=False)
        submission.file = ''
        submission.file_reclaimed_at = timezone.now()
        submission.reclaimed_file_bytes = 3000
        submission.save(update_fields=['file', 'file_reclaimed_at', 'reclaimed_file_bytes'])

        self.assertEqual(self.user.profile.material_upload_bytes, 700)
        self.assertTrue(kept.file)

    def test_a_row_whose_file_vanished_from_storage_does_not_break_the_sum(self):
        """A missing file must not take an upload — or the admin changelist reading the same
        property — down with it; it occupies nothing, which is the honest reading of "not there"."""
        import os

        submission = self._store(2000)
        os.remove(submission.file.path)

        self.assertEqual(self.user.profile.material_upload_bytes, 0)

    def test_room_left_is_the_allowance_minus_what_is_stored(self):
        profile = self.user.profile
        profile.material_upload_quota_bytes = 10000
        profile.save(update_fields=['material_upload_quota_bytes'])
        self._store(4000)

        self.assertEqual(self.user.profile.material_upload_bytes_left, 6000)

    def test_room_left_floors_at_zero_rather_than_going_negative(self):
        """An administrator lowering somebody's allowance below what they already store is a real,
        expected thing to do — it should read as "full", not as a negative number no caller expects.
        """
        self._store(9000)
        profile = self.user.profile
        profile.material_upload_quota_bytes = 1000
        profile.save(update_fields=['material_upload_quota_bytes'])

        self.assertEqual(self.user.profile.material_upload_bytes_left, 0)


class UserServiceReviewsViewTests(APITestCase):
    """GET /api/users/{id}/service-reviews/ — the same "their reviews" profile section, for
    tutoring-listing reviews."""

    def test_lists_only_that_users_own_service_reviews(self):
        from services.models import Service, ServiceReview

        provider = make_user('service-reviews-provider')
        service = Service.objects.create(provider=provider, title='Tutoring')
        author = make_user('service-review-author')
        someone_else = make_user('service-review-someone-else')
        ServiceReview.objects.create(service=service, author=author, rating=4, body='Helpful.')
        ServiceReview.objects.create(service=service, author=someone_else, rating=3, body='Fine.')

        response = self.client.get(reverse('user-service-reviews', kwargs={'pk': author.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['author'], author.pk)
