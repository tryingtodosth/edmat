"""Refusals first, then the things that must still work.

The order is this project's standing habit and it earns its keep here more than usual: this app
replaced three narrower tables, so what has to be proven is not that a file uploads but that every
rule each of those three carried still holds — a tier below yours, a kind that is not yours to set,
a mandatory reading, a supersession, a withdrawal that is not a delete, and the file endpoint
refusing somebody who can see the page but not the row.
"""

import base64
import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from courses.models import Course, CourseStaff, Enrollment
from events.models import Event, EventStaff
from moderation.models import FeatureFlag
from organizations.models import Organization, OrganizationMember
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Acknowledgement, Attachment

# A real 1x1 PNG — libmagic has to agree it is a PNG before `imaging.py` will decode it.
PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
)
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'


def as_(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


class AttachmentCase(APITestCase):
    """Its own temporary MEDIA_ROOT per class — the arrangement `documents/tests.py`,
    `sketches/tests.py` and `galleries/tests.py` already use, so a run never leaves files behind
    under `media/attachments/`."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-attachments-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.host = make_user('att-host')
        self.volunteer = make_user('att-volunteer')
        self.attendee = make_user('att-attendee')
        self.stranger = make_user('att-stranger')
        self.event = Event.objects.create(
            host=self.host, title='Conference', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=3), duration_minutes=240,
            location_kind='onsite', location_text='Room 1',
        )
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')
        self.event.attendances.create(attendee=self.attendee, status='going')
        self.list_url = reverse('target-attachments', args=['event', self.event.pk])

    def make_attachment(self, **over):
        from django.contrib.contenttypes.models import ContentType

        fields = dict(
            content_type=ContentType.objects.get_for_model(Event),
            object_id=self.event.pk,
            title='Fire plan', kind='link', url='https://example.org/plan',
            visibility='staff', uploaded_by=self.host,
        )
        fields.update(over)
        return Attachment.objects.create(**fields)


class TierTests(AttachmentCase):
    def test_a_stranger_sees_only_the_public_tier(self):
        self.make_attachment(title='Programme', visibility='public')
        self.make_attachment(title='Staff notes', visibility='staff')
        rows = APIClient().get(self.list_url).data
        self.assertEqual([r['title'] for r in rows], ['Programme'])

    def test_an_attendee_sees_the_members_tier_and_not_the_staff_one(self):
        self.make_attachment(title='Joining instructions', visibility='members')
        self.make_attachment(title='Staff notes', visibility='staff')
        rows = as_(self.attendee).get(self.list_url).data
        self.assertEqual([r['title'] for r in rows], ['Joining instructions'])

    def test_staff_see_the_members_tier_too_because_the_ladder_is_a_ladder(self):
        self.make_attachment(title='Joining instructions', visibility='members')
        self.make_attachment(title='Staff notes', visibility='staff')
        titles = {r['title'] for r in as_(self.volunteer).get(self.list_url).data}
        self.assertEqual(titles, {'Joining instructions', 'Staff notes'})

    def test_a_manager_sees_everything_including_the_venue_tier(self):
        self.make_attachment(title='For the building', visibility='venue')
        self.make_attachment(title='Managers only', visibility='managers')
        titles = {r['title'] for r in as_(self.host).get(self.list_url).data}
        self.assertEqual(titles, {'For the building', 'Managers only'})

    def test_the_file_endpoint_refuses_a_tier_you_do_not_have(self):
        row = self.make_attachment(
            kind='file', url='', visibility='staff',
            file=SimpleUploadedFile('a.pdf', PDF), media_type='application/pdf',
        )
        url = reverse('attachment-file', args=[row.pk])
        # 404 and not 403: for them this row does not exist (house rule 4).
        self.assertEqual(as_(self.attendee).get(url).status_code, 404)
        self.assertEqual(as_(self.volunteer).get(url).status_code, 200)


class WriteTests(AttachmentCase):
    def test_a_stranger_cannot_attach(self):
        res = APIClient().post(self.list_url, {'title': 'x', 'url': 'https://e.org', 'kind': 'link'})
        self.assertIn(res.status_code, (401, 403))

    def test_an_attendee_cannot_attach_to_the_event(self):
        """Not every member: an attachment on an event page is the event's own pile of files. A
        participant with something to add has the comment thread, which has its own."""
        res = as_(self.attendee).post(
            self.list_url, {'title': 'Mine', 'url': 'https://e.org', 'kind': 'link'}
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['detail'], 'not_allowed')

    def test_staff_may_attach(self):
        res = as_(self.volunteer).post(
            self.list_url, {'title': 'Rota draft', 'url': 'https://e.org', 'kind': 'link'}
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['kind'], 'link')

    def test_only_a_manager_may_make_a_reading_mandatory(self):
        """A mandatory reading is an instruction to everybody else, so it is a manager's act even
        where attaching is not."""
        body = {'title': 'Briefing', 'url': 'https://e.org', 'kind': 'link',
                'requires_acknowledgement': True, 'visibility': 'staff'}
        self.assertEqual(as_(self.volunteer).post(self.list_url, body).status_code, 403)
        self.assertEqual(as_(self.host).post(self.list_url, body).status_code, 201)

    def test_the_venue_tier_is_refused_on_anything_but_an_event(self):
        org = Organization.objects.create(name='Circle', slug='circle', created_by=self.host)
        OrganizationMember.objects.create(organization=org, user=self.host, role='owner')
        url = reverse('target-attachments', args=['organization', org.pk])
        res = as_(self.host).post(
            url, {'title': 'x', 'url': 'https://e.org', 'kind': 'link', 'visibility': 'venue'}
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'venue_tier_is_event_only')

    def test_an_unknown_target_kind_is_404_not_500(self):
        res = as_(self.host).get('/api/nonsense/1/attachments/')
        self.assertEqual(res.status_code, 404)


class FileKindTests(AttachmentCase):
    def test_a_markdown_upload_becomes_text_whatever_the_caller_said(self):
        """What the bytes ARE is a question for `files.py`, not for the client — the same discipline
        `media_type` follows."""
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Notes', 'kind': 'file',
             'file': SimpleUploadedFile('notes.md', '# Tytuł\n\nTreść.'.encode())},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['kind'], 'text')
        self.assertIn('Tytuł', res.data['body'])
        self.assertIsNone(res.data['file_url'])

    def test_a_png_is_re_encoded_to_webp_and_keeps_none_of_its_bytes(self):
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Whiteboard', 'kind': 'file', 'file': SimpleUploadedFile('w.png', PNG)},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['media_type'], 'image/webp')
        self.assertTrue(res.data['scanned'])

    def test_a_pdf_is_stored_as_is_and_says_whether_it_was_scanned(self):
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Plan', 'kind': 'file', 'file': SimpleUploadedFile('p.pdf', PDF)},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['media_type'], 'application/pdf')
        # No clamd in this environment: `scanned=False` is the honest answer and never "clean"
        # (house rule 10). Asserted as a BOOLEAN FIELD BEING PRESENT rather than as False, so this
        # test keeps passing on a machine that does run a scanner.
        self.assertIn(res.data['scanned'], (True, False))

    def test_the_legacy_office_formats_are_refused_by_name(self):
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Old', 'kind': 'file', 'file': SimpleUploadedFile('old.doc', b'\xd0\xcf\x11\xe0junk')},
            format='multipart',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('.docx', str(res.data))

    def test_a_zip_renamed_docx_is_refused(self):
        """libmagic can only say "it is a zip", so the member list is what tells a real document
        from an arbitrary archive."""
        import io
        import zipfile

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('hello.txt', 'not a document')
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Fake', 'kind': 'file',
             'file': SimpleUploadedFile('fake.docx', buffer.getvalue())},
            format='multipart',
        )
        self.assertEqual(res.status_code, 400)

    def test_a_real_docx_is_accepted_and_served_as_a_download(self):
        import io
        import zipfile

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<w:document/>')
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Agenda', 'kind': 'file',
             'file': SimpleUploadedFile('agenda.docx', buffer.getvalue())},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['media_type'].endswith('wordprocessingml.document'))
        served = as_(self.host).get(reverse('attachment-file', args=[res.data['id']]))
        self.assertEqual(served.status_code, 200)
        self.assertIn('attachment;', served['Content-Disposition'])
        self.assertEqual(served['X-Content-Type-Options'], 'nosniff')

    def test_an_unknown_type_is_refused_with_a_list_of_what_is_wanted(self):
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Binary', 'kind': 'file', 'file': SimpleUploadedFile('x.bin', b'\x00\x01\x02\x03')},
            format='multipart',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('.md', str(res.data))

    def test_text_that_is_not_utf8_says_so(self):
        res = as_(self.host).post(
            self.list_url,
            {'title': 'Broken', 'kind': 'file', 'file': SimpleUploadedFile('x.md', b'\xff\xfe\x00bad')},
            format='multipart',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('UTF-8', str(res.data))


class LifecycleTests(AttachmentCase):
    def test_a_replacement_is_a_new_row_and_the_old_one_keeps_its_acknowledgements(self):
        old = self.make_attachment(title='Fire plan v1', requires_acknowledgement=True)
        Acknowledgement.objects.create(attachment=old, user=self.volunteer, version=old.version)
        res = as_(self.host).post(
            reverse('attachment-replace', args=[old.pk]),
            {'title': 'Fire plan v2', 'kind': 'link', 'url': 'https://example.org/v2',
             'visibility': 'staff'},
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['version'], 2)
        old.refresh_from_db()
        self.assertEqual(old.replaced_by_id, res.data['id'])
        self.assertEqual(old.acknowledgements.count(), 1, 'history is not rewritten')

    def test_replacing_twice_is_a_409(self):
        old = self.make_attachment()
        body = {'title': 'v2', 'kind': 'link', 'url': 'https://example.org/v2'}
        self.assertEqual(
            as_(self.host).post(reverse('attachment-replace', args=[old.pk]), body).status_code, 201
        )
        again = as_(self.host).post(reverse('attachment-replace', args=[old.pk]), body)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data['detail'], 'already_replaced')

    def test_withdrawing_is_a_state_not_a_delete(self):
        row = self.make_attachment()
        res = as_(self.host).post(reverse('attachment-withdraw', args=[row.pk]))
        self.assertEqual(res.status_code, 200)
        row.refresh_from_db()
        self.assertIsNotNone(row.removed_at)
        self.assertEqual(row.removed_by, self.host)
        self.assertTrue(Attachment.objects.filter(pk=row.pk).exists())
        # And it is gone from the list, because the list is what is CURRENT.
        self.assertEqual(as_(self.volunteer).get(self.list_url).data, [])

    def test_acknowledging_a_superseded_row_is_a_409_pointing_at_the_new_one(self):
        old = self.make_attachment(requires_acknowledgement=True)
        new = self.make_attachment(title='v2', version=2)
        Attachment.objects.filter(pk=old.pk).update(replaced_by=new)
        res = as_(self.volunteer).post(reverse('attachment-acknowledge', args=[old.pk]))
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['detail'], 'superseded')
        self.assertEqual(res.data['attachment'], new.pk)

    def test_acknowledging_twice_is_idempotent(self):
        row = self.make_attachment(requires_acknowledgement=True)
        url = reverse('attachment-acknowledge', args=[row.pk])
        self.assertEqual(as_(self.volunteer).post(url).status_code, 200)
        self.assertEqual(as_(self.volunteer).post(url).status_code, 200)
        self.assertEqual(row.acknowledgements.count(), 1)

    def test_only_a_manager_reads_the_receipts(self):
        row = self.make_attachment(requires_acknowledgement=True)
        Acknowledgement.objects.create(attachment=row, user=self.volunteer, version=1)
        url = reverse('attachment-receipts', args=[row.pk])
        self.assertEqual(as_(self.volunteer).get(url).status_code, 403)
        rows = as_(self.host).get(url)
        self.assertEqual(rows.status_code, 200)
        self.assertEqual(len(rows.data), 1)


class RowAndCommentTests(AttachmentCase):
    """The two target shapes that are not nodes."""

    def setUp(self):
        super().setUp()
        from tasks.models import Task
        from django.contrib.contenttypes.models import ContentType

        self.task = Task.objects.create(
            content_type=ContentType.objects.get_for_model(Event),
            object_id=self.event.pk,
            title='Print the badges',
            created_by=self.host,
        )
        self.task_url = reverse('target-attachments', args=['task', self.task.pk])

    def test_a_board_row_inherits_the_node_behind_it(self):
        """A task has no roster of its own; whoever runs the event runs its board."""
        res = as_(self.host).post(
            self.task_url, {'title': 'Layout', 'kind': 'link', 'url': 'https://example.org/l'}
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['target_kind'], 'task')
        self.assertEqual(as_(self.attendee).post(self.task_url, {'title': 'x', 'kind': 'link',
                                                                 'url': 'https://e.org'}).status_code, 403)

    def test_a_comment_takes_only_the_public_tier(self):
        from community.models import Comment
        from django.contrib.contenttypes.models import ContentType

        comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(Event),
            object_id=self.event.pk,
            author=self.attendee,
            body='A question',
        )
        url = reverse('target-attachments', args=['comment', comment.pk])
        refused = as_(self.attendee).post(
            url, {'title': 'x', 'kind': 'link', 'url': 'https://e.org', 'visibility': 'staff'}
        )
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data['detail'], 'tier_not_on_a_comment')
        ok = as_(self.attendee).post(
            url, {'title': 'x', 'kind': 'link', 'url': 'https://e.org', 'visibility': 'public'}
        )
        self.assertEqual(ok.status_code, 201)

    def test_nobody_attaches_to_somebody_elses_comment(self):
        from community.models import Comment
        from django.contrib.contenttypes.models import ContentType

        comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(Event),
            object_id=self.event.pk,
            author=self.attendee,
            body='A question',
        )
        url = reverse('target-attachments', args=['comment', comment.pk])
        res = as_(self.host).post(
            url, {'title': 'x', 'kind': 'link', 'url': 'https://e.org', 'visibility': 'public'}
        )
        self.assertEqual(res.status_code, 403)


class PollTargetTests(AttachmentCase):
    """A poll (2026-10-10), the fourth board row and the only one whose own visibility is narrower
    than its node's.

    The others are visible to whoever may see the node, so inheriting the node is the whole rule.
    A poll is not: a draft is managers-only and an open one is for the eligible, because the
    WORDING of a question put to the room is part of the decision (`decisions/rules.py`). So the
    attachments app has to ask that rule, or it becomes the way to read a question nobody was
    shown — which is what these two tests are for.
    """

    def setUp(self):
        super().setUp()
        from django.contrib.contenttypes.models import ContentType

        from decisions.models import Poll

        self.draft = Poll.objects.create(
            content_type=ContentType.objects.get_for_model(Event),
            object_id=self.event.pk,
            question='Shall we move the rota?',
            eligibility='staff',
            status='draft',
            created_by=self.host,
        )
        self.draft_url = reverse('target-attachments', args=['poll', self.draft.pk])

    def test_the_host_may_attach_the_thing_being_voted_on(self):
        res = as_(self.host).post(
            self.draft_url, {'title': 'The draft rota', 'kind': 'link',
                             'url': 'https://example.org/rota'}
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['target_kind'], 'poll')

    def test_a_draft_poll_hides_its_attachments_from_everybody_else(self):
        """404, not an empty list: for them the poll does not exist (house rule 4), and an empty
        list would still have confirmed that a poll with that id is there."""
        from django.contrib.contenttypes.models import ContentType

        self.make_attachment(
            content_type=ContentType.objects.get_for_model(self.draft),
            object_id=self.draft.pk,
            visibility='public',
        )
        self.assertEqual(as_(self.host).get(self.draft_url).status_code, 200)
        self.assertEqual(len(as_(self.host).get(self.draft_url).data), 1)
        self.assertEqual(as_(self.attendee).get(self.draft_url).status_code, 404)
        self.assertEqual(self.client.get(self.draft_url).status_code, 404)


class KillSwitchTests(AttachmentCase):
    def test_with_the_flag_off_the_surface_closes_for_everybody_but_staff(self):
        self.make_attachment(visibility='public')
        FeatureFlag.objects.update_or_create(key='attachments', defaults={'is_enabled': False})
        # 403 for somebody signed in and 401 for a guest — `feature_gate`'s own shape, asserted the
        # way `documents/tests.py` asserts it rather than invented here.
        self.assertEqual(as_(self.attendee).get(self.list_url).status_code, 403)
        self.assertEqual(APIClient().get(self.list_url).status_code, 401)
        # The platform's own staff bypass, the same one `feature_gate` gives every other surface.
        moderator = make_user('att-moderator', is_staff=True)
        self.assertEqual(as_(moderator).get(self.list_url).status_code, 200)

    def test_a_neighbouring_surface_keeps_working_with_the_flag_off(self):
        """House rule 3 cuts both ways: a killed feature must not break the page it was mounted on."""
        FeatureFlag.objects.update_or_create(key='attachments', defaults={'is_enabled': False})
        res = APIClient().get(reverse('event-detail', args=[self.event.pk]))
        self.assertEqual(res.status_code, 200)


class CourseTargetTests(AttachmentCase):
    def test_a_course_uses_the_same_ladder(self):
        teacher = make_user('att-teacher')
        course = Course.objects.create(title='Analiza', instructor=teacher, status='published')
        student = make_user('att-student')
        Enrollment.objects.create(course=course, participant=student, status='active')
        url = reverse('target-attachments', args=['course', course.pk])
        res = as_(teacher).post(
            url, {'title': 'Slides', 'kind': 'link', 'url': 'https://e.org', 'visibility': 'members'}
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(as_(student).get(url).data), 1)
        # A stranger does not reach the course at all, so the honest answer is 404 and not an empty
        # list (house rule 4). Asserted on the STATUS, because a 404's body is a dict and `len()` of
        # it is 1 — which is how this check first "passed" against the wrong thing.
        self.assertEqual(APIClient().get(url).status_code, 404)


class PostTargetTests(AttachmentCase):
    """A board post (2026-10-21) takes attachments the way a comment does: its author adds, the
    public tier only, visible to whoever may read the post."""

    def setUp(self):
        super().setUp()
        from activity.models import Post
        from exercises.models import Tag

        tag = Tag.objects.create(slug='att-post')
        self.post = Post.objects.create(author=self.attendee, body='My notes from week 2', tag=tag)
        self.post_url = reverse('target-attachments', args=['post', self.post.pk])

    def test_the_author_attaches_a_pdf_and_a_link_and_a_stranger_reads_them(self):
        res = as_(self.attendee).post(
            self.post_url,
            {'title': 'Notes', 'kind': 'file', 'visibility': 'public',
             'file': SimpleUploadedFile('notes.pdf', PDF, content_type='application/pdf')},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['target_kind'], 'post')
        link = as_(self.attendee).post(
            self.post_url, {'title': 'Lecture', 'kind': 'link', 'url': 'https://e.org/l', 'visibility': 'public'}
        )
        self.assertEqual(link.status_code, 201, link.data)
        listed = as_(self.stranger).get(self.post_url)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual({row['title'] for row in listed.data}, {'Notes', 'Lecture'})
        # And the post itself counts them.
        post = as_(self.stranger).get(f'/api/posts/{self.post.pk}/')
        self.assertEqual(post.data['attachment_count'], 2)

    def test_only_the_author_attaches_and_only_the_public_tier(self):
        res = as_(self.host).post(
            self.post_url, {'title': 'x', 'kind': 'link', 'url': 'https://e.org'}
        )
        self.assertEqual(res.status_code, 403)
        tier = as_(self.attendee).post(
            self.post_url, {'title': 'x', 'kind': 'link', 'url': 'https://e.org', 'visibility': 'staff'}
        )
        self.assertEqual(tier.status_code, 400)
        self.assertEqual(tier.data['detail'], 'tier_not_on_a_comment')

    def test_a_tombstoned_post_hides_its_attachments_from_everybody_but_author_and_staff(self):
        as_(self.attendee).post(
            self.post_url, {'title': 'Lecture', 'kind': 'link', 'url': 'https://e.org/l', 'visibility': 'public'}
        )
        self.post.is_removed = True
        self.post.save(update_fields=['is_removed'])
        self.assertEqual(as_(self.stranger).get(self.post_url).status_code, 404)
        self.assertEqual(as_(self.attendee).get(self.post_url).status_code, 200)
