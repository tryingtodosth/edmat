"""Site issue reports: who may file, what an anonymous report does NOT store, who sees a private
one, who may move its status, and that the reporter is told."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from moderation.models import FeatureFlag
from notifications.models import Notification
from telemetry.routers import all_log_shards

from .models import Issue


class IssueTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.me = User.objects.create_user('ania', 'ania@x.example', 'pw12345!')
        self.other = User.objects.create_user('piotr', 'piotr@x.example', 'pw12345!')
        self.staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        self.anon = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def file(self, client, **extra):
        payload = {'kind': 'bug', 'title': 'The dice button does nothing', 'body': 'On Firefox.'}
        payload.update(extra)
        return client.post('/api/issues/', payload, format='json')


class FilingTests(IssueTestCase):
    def test_a_guest_can_file_and_is_anonymous_unless_they_leave_an_email(self):
        res = self.file(self.anon, contact_email='guest@x.example')
        self.assertEqual(res.status_code, 201)
        issue = Issue.objects.get()
        self.assertIsNone(issue.reporter)
        self.assertEqual(issue.contact_email, 'guest@x.example')
        self.assertEqual(res.data['reporter_display_name'], '')
        # The email is staff-only, never on the wire to anybody else.
        self.assertEqual(res.data['contact_email'], '')

    def test_a_signed_in_report_carries_the_reporter(self):
        res = self.file(self.as_(self.me))
        self.assertEqual(Issue.objects.get().reporter, self.me)
        self.assertEqual(res.data['reporter_display_name'], 'ania')

    def test_anonymous_stores_neither_reporter_nor_email(self):
        self.file(self.as_(self.me), anonymous=True, contact_email='ania@x.example')
        issue = Issue.objects.get()
        self.assertIsNone(issue.reporter)
        self.assertEqual(issue.contact_email, '')

    def test_context_is_allowlisted_and_bounded(self):
        self.file(
            self.as_(self.me),
            context={'path': '/exercises/51', 'page_title': 'Ex 51', 'secret': 'x', 'viewport': 'a' * 900},
        )
        context = Issue.objects.get().context
        self.assertEqual(set(context), {'path', 'page_title', 'viewport'})
        self.assertEqual(len(context['viewport']), 500)

    def test_a_title_is_required_and_the_kind_is_checked(self):
        self.assertEqual(self.file(self.anon, title='').status_code, 400)
        self.assertEqual(self.file(self.anon, kind='rant').status_code, 400)

    def test_the_kill_switch_stops_filing_for_everybody_but_staff(self):
        FeatureFlag.objects.filter(key='issues').update(is_enabled=False)
        self.assertEqual(self.file(self.as_(self.me)).status_code, 403)
        self.assertIn(self.anon.get('/api/issues/').status_code, (401, 403))
        self.assertEqual(self.file(self.as_(self.staff)).status_code, 201)


class VisibilityTests(IssueTestCase):
    def setUp(self):
        super().setUp()
        self.public = Issue.objects.create(title='Public one', reporter=self.me, is_public=True)
        self.private = Issue.objects.create(title='Private one', reporter=self.me, is_public=False)

    def test_the_list_shows_only_published_reports(self):
        for client in (self.anon, self.as_(self.me), self.as_(self.other)):
            res = client.get('/api/issues/')
            self.assertEqual([i['title'] for i in res.data], ['Public one'])

    def test_a_private_report_is_a_404_even_to_its_own_reporter(self):
        # By decision: a private report is for staff; the reporter gets notifications instead.
        self.assertEqual(self.as_(self.me).get(f'/api/issues/{self.private.pk}/').status_code, 404)
        self.assertEqual(self.anon.get(f'/api/issues/{self.private.pk}/').status_code, 404)

    def test_staff_see_everything_when_they_ask(self):
        res = self.as_(self.staff).get('/api/issues/?all=1')
        self.assertEqual({i['title'] for i in res.data}, {'Public one', 'Private one'})
        self.assertEqual(self.as_(self.staff).get(f'/api/issues/{self.private.pk}/').status_code, 200)
        # Without asking, staff's list is the public one too — the same page everybody reads.
        self.assertEqual([i['title'] for i in self.as_(self.staff).get('/api/issues/').data], ['Public one'])

    def test_status_and_kind_filters(self):
        Issue.objects.create(title='Done', is_public=True, status='resolved', kind='idea')
        self.assertEqual([i['title'] for i in self.anon.get('/api/issues/?status=resolved').data], ['Done'])
        self.assertEqual([i['title'] for i in self.anon.get('/api/issues/?kind=idea').data], ['Done'])


class StatusTests(IssueTestCase):
    def setUp(self):
        super().setUp()
        self.issue = Issue.objects.create(title='Broken', reporter=self.me, is_public=True)

    def test_only_staff_move_a_report(self):
        for client in (self.anon, self.as_(self.me), self.as_(self.other)):
            res = client.patch(f'/api/issues/{self.issue.pk}/', {'status': 'resolved'}, format='json')
            self.assertIn(res.status_code, (401, 403))
        res = self.as_(self.staff).patch(
            f'/api/issues/{self.issue.pk}/', {'status': 'in_progress', 'staff_note': 'Looking'}, format='json'
        )
        self.assertEqual(res.status_code, 200)
        self.issue.refresh_from_db()
        self.assertEqual((self.issue.status, self.issue.staff_note, self.issue.status_changed_by), ('in_progress', 'Looking', self.staff))

    def test_the_reporter_is_told_with_the_note(self):
        self.as_(self.staff).patch(
            f'/api/issues/{self.issue.pk}/', {'status': 'resolved', 'staff_note': 'Fixed in 1.2'}, format='json'
        )
        n = Notification.objects.get(recipient=self.me)
        self.assertEqual((n.type, n.issue, n.note, n.actor), ('issue_status_changed', self.issue, 'Fixed in 1.2', self.staff))

    def test_a_note_alone_does_not_notify_and_an_anonymous_report_notifies_nobody(self):
        self.as_(self.staff).patch(f'/api/issues/{self.issue.pk}/', {'staff_note': 'hm'}, format='json')
        self.assertEqual(Notification.objects.count(), 0)
        anonymous = Issue.objects.create(title='Anon', is_public=True)
        self.as_(self.staff).patch(f'/api/issues/{anonymous.pk}/', {'status': 'closed'}, format='json')
        self.assertEqual(Notification.objects.count(), 0)

    def test_staff_may_unpublish_but_never_publish(self):
        res = self.as_(self.staff).patch(f'/api/issues/{self.issue.pk}/', {'is_public': False}, format='json')
        self.assertEqual(res.status_code, 200)
        res = self.as_(self.staff).patch(f'/api/issues/{self.issue.pk}/', {'is_public': True}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_the_reporters_words_cannot_be_edited_by_staff(self):
        self.as_(self.staff).patch(f'/api/issues/{self.issue.pk}/', {'title': 'Renamed'}, format='json')
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.title, 'Broken')


class DiscussionTests(IssueTestCase):
    def setUp(self):
        super().setUp()
        self.issue = Issue.objects.create(title='Broken', is_public=True)

    def test_anyone_reads_and_only_accounts_post(self):
        self.assertEqual(self.anon.post(f'/api/issues/{self.issue.pk}/comments/', {'body': 'me too'}, format='json').status_code, 401)
        res = self.as_(self.other).post(f'/api/issues/{self.issue.pk}/comments/', {'body': 'me too'}, format='json')
        self.assertEqual(res.status_code, 201)
        listed = self.anon.get(f'/api/issues/{self.issue.pk}/comments/')
        self.assertEqual([c['body'] for c in listed.data], ['me too'])
        self.assertEqual(self.anon.get(f'/api/issues/{self.issue.pk}/').data['comment_count'], 1)
        self.assertEqual(self.anon.get('/api/issues/').data[0]['comment_count'], 1)

    def test_a_reply_must_belong_to_the_same_thread(self):
        other_issue = Issue.objects.create(title='Other', is_public=True)
        root = self.as_(self.other).post(f'/api/issues/{other_issue.pk}/comments/', {'body': 'x'}, format='json')
        res = self.as_(self.other).post(
            f'/api/issues/{self.issue.pk}/comments/', {'body': 'y', 'parent': root.data['id']}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_a_private_issue_has_no_readable_thread(self):
        private = Issue.objects.create(title='P', is_public=False)
        self.assertEqual(self.anon.get(f'/api/issues/{private.pk}/comments/').status_code, 404)
