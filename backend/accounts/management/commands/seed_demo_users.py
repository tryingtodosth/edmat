"""Mirrors frontend/src/lib/mocks/users.ts exactly — same 5 demo identities, same shared
DEMO_PASSWORD, so a person poking at the real backend recognizes the same accounts they already saw
in the mocked Phase 1 frontend. Kasia is the one moderator (is_staff=True), matching her
`isModerator: true` there. Idempotent via update_or_create.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from accounts.models import Profile

User = get_user_model()
DEMO_PASSWORD = 'password123'

DEMO_USERS = [
    {
        'username': 'u-kasia',
        'email': 'kasia@edmat.example',
        'display_name': 'Kasia Wiśniewska',
        'is_verified_contributor': True,
        'is_staff': True,
        'preferred_locale': 'pl',
    },
    {
        'username': 'u-michal',
        'email': 'michal@edmat.example',
        'display_name': 'Michał Zieliński',
        'is_verified_contributor': True,
        'is_staff': False,
        'preferred_locale': 'pl',
    },
    {
        'username': 'u-ola',
        'email': 'ola@edmat.example',
        'display_name': 'Ola Nowak',
        'is_verified_contributor': False,
        'is_staff': False,
        'preferred_locale': 'en',
    },
    {
        'username': 'u-bartek',
        'email': 'bartek@edmat.example',
        'display_name': 'Bartek Kamiński',
        'is_verified_contributor': False,
        'is_staff': False,
        'preferred_locale': 'pl',
    },
    {
        'username': 'u-julia',
        'email': 'julia@edmat.example',
        'display_name': 'Julia Wójcik',
        'is_verified_contributor': False,
        'is_staff': False,
        'preferred_locale': 'en',
    },
]


class Command(BaseCommand):
    help = 'Seeds the same 5 demo users the mocked frontend uses (Phase 1 parity).'

    def handle(self, *args, **options):
        for spec in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=spec['username'], defaults={'email': spec['email'], 'is_staff': spec['is_staff']}
            )
            if created:
                user.set_password(DEMO_PASSWORD)
            user.email = spec['email']
            user.is_staff = spec['is_staff']
            user.save()
            Profile.objects.update_or_create(
                user=user,
                defaults={
                    'display_name': spec['display_name'],
                    'preferred_locale': spec['preferred_locale'],
                    'is_verified_contributor': spec['is_verified_contributor'],
                },
            )
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(DEMO_USERS)} demo users (password: {DEMO_PASSWORD}).'))
