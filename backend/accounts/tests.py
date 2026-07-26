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
