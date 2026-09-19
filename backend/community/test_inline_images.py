"""`/api/inline-images/` — a picture that goes into the body being written rather than into a row
beneath it (community/inline_images.py).

What is pinned here: the stored file is a re-encode and never the uploaded bytes, the tag handed
back survives the content sanitizer intact (which is the only thing that makes the whole feature
work — a tag the sanitizer strips is a picture that vanishes on save), a disguised file is
refused, the endpoint needs an account, reading one back is public, there is no way to delete one,
the allowance covers inline pictures and attachments together, and a picture on a minor-band
thread is still held for a moderator now that it arrives inside the body instead of beside it.
"""

import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from accounts.minors import HOLD_REASON
from community.models import Comment, InlineImage
from config.sanitize import sanitize_content
from moderation.models import Report
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


def png_bytes(w=700, h=400, *, with_exif=False):
    image = Image.new('RGB', (w, h), (30, 90, 200))
    buf = io.BytesIO()
    if with_exif:
        exif = Image.Exif()
        exif[0x010F] = 'EdMat Test Camera'
        image.save(buf, format='JPEG', exif=exif)
    else:
        image.save(buf, format='PNG')
    return buf.getvalue()


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class InlineImageCase(APITestCase):
    """Every test here writes a real file, so every one writes into a temporary `MEDIA_ROOT` —
    the same reason `galleries/tests.py` does it, and the same per-class shape."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-inline-image-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.branch = make_branch(slug='inline-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('inline-author')

    def url(self):
        return reverse('inline-image-list')

    def upload(self, client=None, name='photo.png', data=None, content_type='image/png', alt=None):
        payload = {'file': SimpleUploadedFile(name, png_bytes() if data is None else data, content_type=content_type)}
        if alt is not None:
            payload['alt'] = alt
        return (client or as_(self.author)).post(self.url(), payload, format='multipart')


class UploadTests(InlineImageCase):
    def test_a_picture_is_re_encoded_and_bounded(self):
        r = self.upload(name='huge.png', data=png_bytes(2400, 1200))

        self.assertEqual(r.status_code, 201, r.content)
        row = InlineImage.objects.get(pk=r.json()['id'])
        # Never the bytes that were uploaded (house rule 7): PNG in, WebP out, longest edge bounded.
        self.assertTrue(row.image.name.endswith('.webp'), row.image.name)
        self.assertEqual(Image.open(row.image.path).size, (1600, 800))
        self.assertEqual((row.width, row.height), (1600, 800))
        # The stored name is random; the uploader's own is kept only to show back to them.
        self.assertNotIn('huge', row.image.name)
        self.assertEqual(row.original_name, 'huge.png')

    def test_exif_does_not_survive_the_re_encode(self):
        r = self.upload(name='holiday.jpg', data=png_bytes(with_exif=True), content_type='image/jpeg')

        row = InlineImage.objects.get(pk=r.json()['id'])
        self.assertEqual(dict(Image.open(row.image.path).getexif()), {})

    def test_the_tag_handed_back_survives_the_sanitizer(self):
        """The one that matters: the editor inserts `embed_html` into the body, and the body is
        sanitized on write. Anything this tag carries that `config/sanitize.py` does not allow is
        silently dropped — and an `<img>` that loses its `src` is dropped altogether."""
        r = self.upload(alt='The apparatus, with the tap on the left')
        tag = r.json()['embed_html']

        cleaned = sanitize_content(tag)

        self.assertIn('<img', cleaned)
        self.assertIn('/media/inline-images/', cleaned)
        self.assertIn('The apparatus, with the tap on the left', cleaned)
        # Width, height and lazy loading are what stop the page jumping as pictures settle.
        self.assertIn('width="700"', cleaned)
        self.assertIn('height="400"', cleaned)
        self.assertIn('loading="lazy"', cleaned)

    def test_a_loading_value_that_is_not_a_real_one_is_dropped(self):
        cleaned = sanitize_content('<img src="/media/inline-images/x.webp" alt="a" loading="whenever">')

        self.assertIn('<img', cleaned)
        self.assertNotIn('loading=', cleaned)

    def test_the_alt_falls_back_to_the_filename_rather_than_being_empty(self):
        r = self.upload(name='diagram.png')

        self.assertIn('alt="diagram.png"', r.json()['embed_html'])

    def test_a_disguised_file_is_refused(self):
        r = self.upload(name='payload.png', data=b'MZ\x90\x00 this is not a picture', content_type='image/png')

        self.assertEqual(r.status_code, 400, r.content)
        self.assertFalse(InlineImage.objects.exists())

    def test_a_pdf_is_refused_here(self):
        """A PDF cannot be re-encoded and is not something you put mid-sentence; it stays an
        attachment."""
        r = self.upload(name='notes.pdf', data=b'%PDF-1.4\n%%EOF\n', content_type='application/pdf')

        self.assertEqual(r.status_code, 400, r.content)

    def test_signing_in_is_required(self):
        r = self.upload(APIClient())

        self.assertIn(r.status_code, (401, 403))
        self.assertFalse(InlineImage.objects.exists())

    def test_a_missing_file_is_a_400_not_a_500(self):
        r = as_(self.author).post(self.url(), {'alt': 'nothing attached'}, format='multipart')

        self.assertEqual(r.status_code, 400, r.content)


class ReadAndDeleteTests(InlineImageCase):
    def test_reading_one_back_is_public(self):
        created = self.upload().json()

        r = APIClient().get(reverse('inline-image-detail', args=[created['id']]))

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['embed_html'], created['embed_html'])

    def test_there_is_no_way_to_delete_one(self):
        """A picture inside a published comment must keep resolving (house rule 12)."""
        created = self.upload().json()

        r = as_(self.author).delete(reverse('inline-image-detail', args=[created['id']]))

        self.assertEqual(r.status_code, 405)
        self.assertTrue(InlineImage.objects.filter(pk=created['id']).exists())

    def test_nobody_can_list_what_somebody_has_uploaded(self):
        self.upload()

        r = as_(self.author).get(self.url())

        self.assertEqual(r.status_code, 405)


class QuotaTests(InlineImageCase):
    def test_an_inline_picture_counts_against_the_same_allowance_as_an_attachment(self):
        profile = self.author.profile
        profile.material_upload_quota_bytes = 1
        profile.save(update_fields=['material_upload_quota_bytes'])

        r = self.upload()

        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()['detail'], 'quota')
        self.assertFalse(InlineImage.objects.exists())

    def test_what_is_already_uploaded_is_counted(self):
        first = self.upload()
        self.assertEqual(first.status_code, 201, first.content)
        used = InlineImage.objects.get(pk=first.json()['id']).size_bytes
        profile = self.author.profile
        profile.material_upload_quota_bytes = used + 10
        profile.save(update_fields=['material_upload_quota_bytes'])

        second = self.upload()

        self.assertEqual(second.status_code, 409, second.content)


class MinorHoldTests(InlineImageCase):
    """A picture on a minor-band thread was held for a moderator while pictures were attachments
    (`views.attachments`). Moving them into the body must not have quietly lost that."""

    def _comment(self, body):
        r = as_(self.author).post(
            reverse('exercise-comments', args=[self.exercise.pk]), {'body': body}, format='json'
        )
        self.assertEqual(r.status_code, 201, r.content)
        return Comment.objects.get(pk=r.json()['id'])

    def _minor_band(self):
        self.exercise.audience = 'primary'
        self.exercise.save(update_fields=['audience'])

    def test_a_picture_in_the_body_is_held_on_a_minor_band_thread(self):
        self._minor_band()
        tag = self.upload().json()['embed_html']

        comment = self._comment(f'Look at this: {tag}')

        self.assertIsNotNone(comment.auto_hidden_at)
        self.assertTrue(
            Report.objects.filter(object_id=comment.pk, reason=HOLD_REASON).exists()
        )

    def test_words_alone_are_not_held(self):
        self._minor_band()

        comment = self._comment('No picture here, just a sentence.')

        self.assertIsNone(comment.auto_hidden_at)

    def test_an_ordinary_thread_is_not_held(self):
        tag = self.upload().json()['embed_html']

        comment = self._comment(f'Look at this: {tag}')

        self.assertIsNone(comment.auto_hidden_at)
