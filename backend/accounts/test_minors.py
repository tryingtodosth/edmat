"""Guardian accounts and minor-safe defaults (AUDIENCE-BRIEF.md §2): the under-16 rule at
registration, a guardian making and controlling a child's account, and every ability a minor's
account does NOT have — each enforced by the server, not by a hidden button."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from accounts.models import Guardianship
from activity.models import Post
from community.models import Comment
from events.models import Event
from moderation.models import Report
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

User = get_user_model()


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class MinorCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.guardian = make_user('m-guardian')
        self.other = make_user('m-other')
        r = as_(self.guardian).post(reverse('auth-children'), {'username': 'kid', 'password': 'a-strong-passw0rd!', 'display_name': 'Zosia'}, format='json')
        assert r.status_code == 201, r.content
        self.child = User.objects.get(username='kid')


class RegistrationRuleTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_under_sixteen_cannot_self_register_and_the_year_is_not_stored(self):
        year = timezone.now().year
        body = {'username': 'young', 'email': 'young@example.org', 'password': 'a-strong-passw0rd!', 'birth_year': year - 12}
        r = self.client.post(reverse('auth-register'), body, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('guardian_required', str(r.json()))
        self.assertFalse(User.objects.filter(username='young').exists())
        body.update(birth_year=year - 20, username='grown', email='grown@example.org')
        r = self.client.post(reverse('auth-register'), body, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertFalse(User.objects.get(username='grown').profile.is_minor)


class GuardianTests(MinorCase):
    def test_a_child_has_no_email_is_a_minor_and_is_private(self):
        self.assertEqual(self.child.email, '')
        self.assertTrue(self.child.profile.is_minor)
        self.assertFalse(self.child.profile.show_profile_publicly)
        self.assertTrue(Guardianship.objects.filter(guardian=self.guardian, child=self.child).exists())
        me = as_(self.guardian).get(reverse('auth-me')).json()
        self.assertEqual([c['username'] for c in me['guardian_of']], ['kid'])
        kid_me = as_(self.child).get(reverse('auth-me')).json()
        self.assertTrue(kid_me['is_minor'])
        self.assertEqual([g['id'] for g in kid_me['guardians']], [self.guardian.pk])

    def test_a_child_logs_in_with_the_username(self):
        r = self.client.post(reverse('auth-login'), {'username': 'kid', 'password': 'a-strong-passw0rd!'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def test_a_minor_cannot_make_children_and_a_stranger_cannot_touch_one(self):
        self.assertEqual(as_(self.child).post(reverse('auth-children'), {'username': 'kid2', 'password': 'a-strong-passw0rd!'}, format='json').status_code, 403)
        self.assertEqual(as_(self.other).delete(reverse('auth-child', args=[self.child.pk])).status_code, 404)
        self.assertEqual(as_(self.other).get(reverse('auth-child-content', args=[self.child.pk])).status_code, 404)

    def test_the_guardian_sees_and_removes_what_the_child_wrote_and_can_delete_the_account(self):
        branch = make_branch(slug='m-branch')
        ex = make_exercise(branch, 1)
        as_(self.child).post(reverse('exercise-comments', args=[ex.pk]), {'body': 'is this right?'}, format='json')
        content = as_(self.guardian).get(reverse('auth-child-content', args=[self.child.pk])).json()
        self.assertEqual(len(content['comments']), 1)
        self.assertTrue(content['comments'][0]['held'])
        cid = content['comments'][0]['id']
        self.assertEqual(as_(self.guardian).delete(reverse('auth-child-content-item', args=[self.child.pk, 'comment', cid])).status_code, 204)
        self.assertTrue(Comment.objects.get(pk=cid).is_removed)
        self.assertEqual(as_(self.guardian).delete(reverse('auth-child', args=[self.child.pk])).status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.child.pk).exists())

    def test_deleting_the_guardian_takes_the_child_unless_another_guardian_remains(self):
        self.guardian.delete()
        self.assertFalse(User.objects.filter(username='kid').exists())
        g2 = make_user('m-g2')
        g3 = make_user('m-g3')
        r = as_(g2).post(reverse('auth-children'), {'username': 'kid2', 'password': 'a-strong-passw0rd!'}, format='json')
        kid2 = User.objects.get(pk=r.json()['id'])
        Guardianship.objects.create(guardian=g3, child=kid2)
        g2.delete()
        self.assertTrue(User.objects.filter(pk=kid2.pk).exists())


class MinorDefaultsTests(MinorCase):
    def test_the_profile_stays_private_whatever_the_form_sends(self):
        r = as_(self.child).patch(reverse('auth-me'), {'show_profile_publicly': True, 'offers_tutoring': True}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.child.profile.refresh_from_db()
        self.assertFalse(self.child.profile.show_profile_publicly)
        self.assertFalse(self.child.profile.offers_tutoring)
        public = self.client.get(reverse('user-public', args=[self.child.pk])).json()
        self.assertIsNone(public['joined_at'])

    def test_no_messaging_in_either_direction(self):
        self.assertEqual(as_(self.child).post('/api/messages/', {'recipient_id': self.other.pk, 'subject': 'hi', 'body': 'x'}, format='json').status_code, 403)
        self.assertEqual(as_(self.other).post('/api/messages/', {'recipient_id': self.child.pk, 'subject': 'hi', 'body': 'x'}, format='json').status_code, 403)

    def test_no_listing_no_hosting_no_avatar_no_geocoding(self):
        self.assertEqual(as_(self.child).post(reverse('service-list'), {'title': 'Tutoring', 'audience': 'primary'}, format='json').status_code, 403)
        self.assertEqual(as_(self.child).post(reverse('event-list'), {'title': 'My party', 'audience': 'primary'}, format='json').status_code, 403)
        self.assertEqual(as_(self.child).post(reverse('auth-me-avatar'), {}, format='multipart').status_code, 403)
        self.assertEqual(as_(self.child).get('/api/geocode/', {'q': 'Warszawa'}).status_code, 403)

    def test_a_minors_comment_and_post_are_held_until_a_moderator_restores(self):
        branch = make_branch(slug='m-branch-2')
        ex = make_exercise(branch, 1)
        r = as_(self.child).post(reverse('exercise-comments', args=[ex.pk]), {'body': 'held?'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        c = Comment.objects.get(pk=r.json()['id'])
        self.assertIsNotNone(c.auto_hidden_at)
        self.assertTrue(Report.objects.filter(object_id=c.pk, reason='held_for_review').exists())
        # An adult's comment is not held.
        r2 = as_(self.other).post(reverse('exercise-comments', args=[ex.pk]), {'body': 'fine'}, format='json')
        self.assertIsNone(Comment.objects.get(pk=r2.json()['id']).auto_hidden_at)
        # A moderator's restore publishes it.
        mod = make_user('m-mod', is_staff=True)
        as_(mod).post(reverse('moderation-report-action', kwargs={'kind': 'comment', 'pk': c.pk, 'decision': 'restore'}))
        c.refresh_from_db()
        self.assertIsNone(c.auto_hidden_at)
        # A post by a minor is held too and not announced to the feed.
        p = as_(self.child).post('/api/posts/', {'body': 'my first post', 'audience': 'primary', 'branch': branch.slug}, format='json')
        self.assertEqual(p.status_code, 201, p.content)
        post = Post.objects.get(pk=p.json()['id'])
        self.assertIsNotNone(post.auto_hidden_at)

    def test_a_guardian_registers_the_child_for_an_event(self):
        host = make_user('m-host')
        ev = Event.objects.create(host=host, title='Kids day', status='published', visibility='public', starts_at=timezone.now() + timedelta(days=3), location_kind='online', online_url='https://x.org', audience='primary')
        url = reverse('event-attend', args=[ev.pk])
        self.assertEqual(as_(self.other).post(url, {'status': 'going', 'on_behalf_of': self.child.pk}, format='json').status_code, 403)
        r = as_(self.guardian).post(url, {'status': 'going', 'on_behalf_of': self.child.pk}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        row = ev.attendances.get(attendee=self.child)
        self.assertEqual(row.status, 'going')
        self.assertEqual(row.registered_by_id, self.guardian.pk)
        self.assertEqual(r.json()['attendance']['registered_by']['id'], self.guardian.pk)
