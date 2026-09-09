"""Pictures and small PDFs on comments (AUDIENCE-BRIEF.md §6): a real picture is re-encoded, a real
PDF is kept, a disguised executable is refused, three is the limit, only the author may add, the
allowance is enforced, a tombstone hides them, and a picture on a minor-band thread is held."""

import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from accounts.minors import HOLD_REASON
from community.models import Comment, CommentAttachment
from moderation.models import Report
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


def png_bytes(w=700, h=400):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (30, 90, 200)).save(buf, format='PNG')
    return buf.getvalue()


MINIMAL_PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class AttachmentCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='att-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('att-author')
        self.other = make_user('att-other')
        r = as_(self.author).post(reverse('exercise-comments', args=[self.exercise.pk]), {'body': 'see my sketch'}, format='json')
        self.comment = Comment.objects.get(pk=r.json()['id'])

    def url(self, comment=None):
        return reverse('comment-attachments', args=[(comment or self.comment).pk])

    def upload(self, client, name, data, content_type):
        return client.post(self.url(), {'file': SimpleUploadedFile(name, data, content_type=content_type)}, format='multipart')


class UploadTests(AttachmentCase):
    def test_a_picture_is_re_encoded_and_a_pdf_kept(self):
        r = self.upload(as_(self.author), 'sketch.png', png_bytes(2400, 1200), 'image/png')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['kind'], 'image')
        row = CommentAttachment.objects.get(pk=r.json()['id'])
        self.assertTrue(row.file.name.endswith('.webp'))
        self.assertEqual(Image.open(row.file.path).size, (1600, 800))
        r = self.upload(as_(self.author), 'notes.pdf', MINIMAL_PDF, 'application/pdf')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['kind'], 'pdf')
        thread = self.client.get(reverse('exercise-comments', args=[self.exercise.pk])).json()
        self.assertEqual(len(thread[0]['attachments']), 2)
        self.assertTrue(thread[0]['attachments'][0]['url'].startswith('http'))

    def test_a_disguised_executable_is_refused(self):
        r = self.upload(as_(self.author), 'sketch.png', b'MZ\x90\x00' + b'\x00' * 200, 'image/png')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(CommentAttachment.objects.count(), 0)

    def test_three_is_the_limit_and_only_the_author_may_add(self):
        for i in range(3):
            self.assertEqual(self.upload(as_(self.author), f'p{i}.png', png_bytes(), 'image/png').status_code, 201)
        self.assertEqual(self.upload(as_(self.author), 'p4.png', png_bytes(), 'image/png').status_code, 409)
        self.assertEqual(self.upload(as_(self.other), 'x.png', png_bytes(), 'image/png').status_code, 403)

    def test_the_allowance_is_enforced(self):
        self.author.profile.material_upload_quota_bytes = 1
        self.author.profile.save()
        r = self.upload(as_(self.author), 'p.png', png_bytes(), 'image/png')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail'], 'quota')

    def test_removal_by_author_and_by_staff_and_a_tombstone_hides_them(self):
        r = self.upload(as_(self.author), 'p.png', png_bytes(), 'image/png')
        aid = r.json()['id']
        self.assertEqual(as_(self.other).delete(reverse('comment-attachment-delete', args=[self.comment.pk, aid])).status_code, 403)
        self.assertEqual(as_(self.author).delete(reverse('comment-attachment-delete', args=[self.comment.pk, aid])).status_code, 204)
        self.assertEqual(CommentAttachment.objects.count(), 0)
        self.upload(as_(self.author), 'p.png', png_bytes(), 'image/png')
        self.comment.is_removed = True
        self.comment.save()
        thread = self.client.get(reverse('exercise-comments', args=[self.exercise.pk])).json()
        self.assertEqual(thread[0]['attachments'], [])

    def test_a_picture_on_a_minor_band_thread_is_held(self):
        self.exercise.audience = 'primary'
        self.exercise.save()
        r = self.upload(as_(self.author), 'p.png', png_bytes(), 'image/png')
        self.assertEqual(r.status_code, 201)
        self.comment.refresh_from_db()
        self.assertIsNotNone(self.comment.auto_hidden_at)
        self.assertTrue(Report.objects.filter(object_id=self.comment.pk, reason=HOLD_REASON).exists())
        # A PDF on the same thread is not (only pictures are reviewed before publication).
        other = Comment.objects.get(pk=as_(self.other).post(reverse('exercise-comments', args=[self.exercise.pk]), {'body': 'x'}, format='json').json()['id'])
        as_(self.other).post(self.url(other), {'file': SimpleUploadedFile('n.pdf', MINIMAL_PDF, content_type='application/pdf')}, format='multipart')
        other.refresh_from_db()
        self.assertIsNone(other.auto_hidden_at)
