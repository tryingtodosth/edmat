"""Regression tests for the avatar upload/validation feature and the auth throttling that landed with
it — the two remaining gaps from the whole-project security scan (the other two, server-side bleach
sanitization and the SSR sanitization bypass, were closed in the preceding pass).

Its own module rather than more classes in `accounts/tests.py`: every test here needs a real, decoded
image fixture and a real `MEDIA_ROOT` to write into, neither of which any other accounts test wants
to pay for. The fixtures are genuine encoded bytes built by Pillow, never a placeholder string
pretending to be a PNG — the same discipline `materials/tests.py` already applies to its own
PDF/PE-header fixtures, and the only way a test of "does this reject a disguised executable?" can
mean anything at all.

Every test runs against a temporary `MEDIA_ROOT` (see `AvatarTestCase`), so a test run never writes
into the real `backend/media/avatars/` directory alongside genuine user uploads.
"""

from __future__ import annotations

import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.avatar import AVATAR_SIZE, process_avatar, validate_avatar_file

User = get_user_model()


def make_image_bytes(
    width: int = 900,
    height: int = 600,
    fmt: str = 'JPEG',
    exif: Image.Exif | None = None,
) -> bytes:
    """A real, encoded image — not a stub. Deliberately non-square and non-grey by default: a solid
    square would make it impossible to tell a working crop/resize from a no-op."""
    image = Image.new('RGB', (width, height), (30, 120, 200))
    for x in range(0, width, 60):
        for y in range(0, height, 60):
            image.paste((240, 200, 40), (x, y, x + 30, y + 30))
    buffer = io.BytesIO()
    if exif is not None:
        image.save(buffer, fmt, exif=exif)
    else:
        image.save(buffer, fmt)
    return buffer.getvalue()


def make_upload(content: bytes, name: str = 'avatar.jpg', content_type: str = 'image/jpeg'):
    return SimpleUploadedFile(name, content, content_type=content_type)


class AvatarTestCase(APITestCase):
    """Shared temporary MEDIA_ROOT. `override_settings` is applied per-class here rather than per-test
    so the directory survives for the whole class and is cleaned up exactly once."""

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-avatar-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)


class AvatarProcessingTests(AvatarTestCase):
    """`process_avatar` itself — the re-encode that is the actual security boundary."""

    def test_a_real_photo_is_re_encoded_to_a_square_webp(self):
        result = process_avatar(make_upload(make_image_bytes(900, 600)))

        image = Image.open(result)
        self.assertEqual(image.format, 'WEBP')
        self.assertEqual(image.size, (AVATAR_SIZE, AVATAR_SIZE))
        self.assertTrue(result.name.endswith('.webp'))

    def test_the_uploaders_own_filename_is_discarded(self):
        # A real path-traversal / double-extension attempt. The stored name must be neither of these,
        # and must not merely be a sanitized version of them — it should be unrelated.
        result = process_avatar(
            make_upload(make_image_bytes(), name='../../../etc/passwd.jpg.png')
        )

        self.assertNotIn('passwd', result.name)
        self.assertNotIn('/', result.name)
        self.assertNotIn('..', result.name)

    def test_exif_including_gps_is_stripped(self):
        """The privacy case: a phone photo carries GPS coordinates, and publishing them alongside a
        public profile picture would leak where the account holder physically was."""
        exif = Image.Exif()
        exif[0x010F] = 'ACME Phone'
        gps = exif.get_ifd(0x8825)
        gps[1] = 'N'
        gps[2] = (52.0, 13.0, 0.0)
        source = make_image_bytes(exif=exif)

        # The fixture genuinely carries what this test claims, checked rather than assumed — a
        # fixture that silently lost its EXIF at save time would make this test pass for no reason.
        self.assertTrue(Image.open(io.BytesIO(source)).getexif().get_ifd(0x8825))

        result = process_avatar(make_upload(source))

        stored_exif = Image.open(result).getexif()
        self.assertEqual(dict(stored_exif), {})
        self.assertEqual(dict(stored_exif.get_ifd(0x8825)), {})

    def test_exif_orientation_is_applied_before_it_is_stripped(self):
        """Stripping the orientation tag without first honoring it would silently rotate every phone
        photo 90 degrees. Proven by difference: the same pixels, tagged vs. untagged, must not
        produce the same output."""
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90 CW on display
        tagged = process_avatar(make_upload(make_image_bytes(400, 200, exif=exif)))
        untagged = process_avatar(make_upload(make_image_bytes(400, 200)))

        self.assertNotEqual(Image.open(tagged).tobytes(), Image.open(untagged).tobytes())

    def test_a_png_with_transparency_keeps_its_alpha_channel(self):
        """Alpha is preserved rather than flattened onto white — this app ships a real light/dark
        theme, so a flattened logo-style avatar would be a bright rectangle in one of them."""
        image = Image.new('RGBA', (400, 400), (255, 0, 0, 0))
        image.paste((0, 255, 0, 255), (100, 100, 300, 300))
        buffer = io.BytesIO()
        image.save(buffer, 'PNG')

        result = process_avatar(make_upload(buffer.getvalue(), 'a.png', 'image/png'))

        stored = Image.open(result)
        self.assertIn(stored.mode, ('RGBA', 'LA'))
        self.assertEqual(stored.getpixel((5, 5))[3], 0)  # corner is still transparent

    def test_appended_trailing_bytes_do_not_survive_the_re_encode(self):
        """The polyglot case, and the reason re-encoding beats sniffing: a file that is a genuine,
        decodable image AND carries a payload after the image data. Content sniffing says "yes, a
        real PNG" — correctly — and passes it through with the payload intact."""
        payload = b'<?php system($_GET["c"]); ?>'
        result = process_avatar(make_upload(make_image_bytes() + payload))

        self.assertNotIn(payload, result.read())


class AvatarValidationTests(AvatarTestCase):
    def test_a_windows_executable_renamed_to_png_is_rejected(self):
        pe_header = b'MZ\x90\x00\x03' + b'\x00' * 200 + b'This program cannot be run in DOS mode.'

        with self.assertRaises(ValidationError) as ctx:
            validate_avatar_file(make_upload(pe_header, 'avatar.png', 'image/png'))

        self.assertIn('not a PNG, JPEG, or WebP', str(ctx.exception))

    def test_a_decompression_bomb_is_rejected_before_it_is_decoded(self):
        """A VALID png, small on disk, enormous in memory — the attack a byte-size limit cannot see.
        12000x12000 is 144 megapixels, well past MAX_AVATAR_PIXELS, but only ~140 KB encoded."""
        buffer = io.BytesIO()
        Image.new('L', (12000, 12000), 0).save(buffer, 'PNG', optimize=True)
        bomb = buffer.getvalue()

        self.assertLess(len(bomb), 1024 * 1024)  # genuinely small on disk, as the attack requires

        with self.assertRaises(ValidationError) as ctx:
            validate_avatar_file(make_upload(bomb, 'avatar.png', 'image/png'))

        self.assertIn('too many pixels', str(ctx.exception))

    def test_an_oversized_file_is_rejected(self):
        oversized = SimpleUploadedFile('big.jpg', b'x' * (5 * 1024 * 1024 + 1), 'image/jpeg')

        with self.assertRaises(ValidationError) as ctx:
            validate_avatar_file(oversized)

        self.assertIn('maximum', str(ctx.exception).lower())


class AvatarApiTests(AvatarTestCase):
    def setUp(self):
        self.user = User.objects.create_user('avataruser', 'avatar@example.com', 'pw-for-test')
        self.url = reverse('auth-me-avatar')

    def test_anonymous_upload_is_rejected(self):
        response = self.client.post(
            self.url, {'avatar': make_upload(make_image_bytes())}, format='multipart'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_upload_stores_a_normalized_avatar_and_returns_the_profile(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            self.url, {'avatar': make_upload(make_image_bytes())}, format='multipart'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['avatar'].endswith('.webp'))
        self.user.profile.refresh_from_db()
        stored = Image.open(self.user.profile.avatar.path)
        self.assertEqual(stored.size, (AVATAR_SIZE, AVATAR_SIZE))

    def test_a_rejected_upload_returns_400_and_stores_nothing(self):
        self.client.force_authenticate(self.user)
        pe_header = b'MZ\x90\x00\x03' + b'\x00' * 200 + b'This program cannot be run in DOS mode.'

        response = self.client.post(
            self.url,
            {'avatar': make_upload(pe_header, 'avatar.png', 'image/png')},
            format='multipart',
        )

        # A 400, not the 500 an uncaught Django ValidationError would produce — the view translates
        # it explicitly, and this test is what keeps that translation in place.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('avatar', response.data)
        self.user.profile.refresh_from_db()
        self.assertFalse(self.user.profile.avatar)

    def test_posting_no_file_at_all_is_a_clean_400(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(self.url, {}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_re_uploading_replaces_the_previous_file_rather_than_orphaning_it(self):
        """Django's FileField does not clean up a replaced file, and the UUID names mean nothing
        would ever overwrite one — without an explicit delete, every re-upload leaks a file forever."""
        self.client.force_authenticate(self.user)
        self.client.post(self.url, {'avatar': make_upload(make_image_bytes())}, format='multipart')
        self.user.profile.refresh_from_db()
        first_path = self.user.profile.avatar.path

        self.client.post(self.url, {'avatar': make_upload(make_image_bytes())}, format='multipart')

        self.user.profile.refresh_from_db()
        self.assertNotEqual(self.user.profile.avatar.path, first_path)
        import os

        self.assertFalse(os.path.exists(first_path))

    def test_delete_removes_both_the_field_and_the_stored_file(self):
        import os

        self.client.force_authenticate(self.user)
        self.client.post(self.url, {'avatar': make_upload(make_image_bytes())}, format='multipart')
        self.user.profile.refresh_from_db()
        path = self.user.profile.avatar.path

        response = self.client.delete(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['avatar'])
        self.user.profile.refresh_from_db()
        self.assertFalse(self.user.profile.avatar)
        self.assertFalse(os.path.exists(path))

    def test_delete_with_no_avatar_set_is_a_clean_no_op(self):
        self.client.force_authenticate(self.user)

        response = self.client.delete(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_avatar_is_still_not_writable_through_the_ordinary_profile_patch(self):
        """`ProfileUpdateSerializer` deliberately excludes `avatar`, and must keep doing so — the
        upload has its own endpoint precisely so this one stays JSON-only."""
        self.client.force_authenticate(self.user)

        response = self.client.patch(
            reverse('auth-me'), {'avatar': 'http://evil.example/x.png'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.profile.refresh_from_db()
        self.assertFalse(self.user.profile.avatar)
