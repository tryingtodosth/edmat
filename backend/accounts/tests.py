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
        course = make_course('me-view-course')
        NodeGovernor.objects.create(
            user=user, content_type=ContentType.objects.get_for_model(type(course)), object_id=course.pk
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
