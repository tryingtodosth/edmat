"""Part of this project's first real automated test suite (CLAUDE.md Section 17I/17K's own "no
formal automated test suite exists" note) — register/login, the auth flow every other authenticated
action in this app depends on.
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from testing.factories import make_user

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
