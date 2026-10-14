"""Account deletion and data export (`accounts/erasure.py`, `accounts/export.py`, `erasure_views.py`).

What these pin, in the order a reader would worry about them:

1. The registry is COMPLETE — a new foreign key to a person without an entry fails here.
2. Asking: re-authentication, every refusal with its reason, the switch-off, the cancel mail.
3. The grace period: signing in offers to cancel; the link cancels; nothing is erased early.
4. The erasure: every action type, other people's data intact, the tombstone, idempotence.
5. The guardian path goes through the same module.
6. The export holds the person's data and not other people's, and is throttled.
7. The retention rules delete what is old and nothing else.
"""

import json
from datetime import timedelta
from unittest import mock

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core import mail as django_mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from accounts import erasure
from accounts.models import AccountErasure, Guardianship, Profile
from telemetry.routers import all_log_shards, shard_for_user
from testing.factories import make_branch, make_exercise, make_material, make_user, make_viewer

User = get_user_model()
PASSWORD = 'testpass123'


class _Base(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()

    def sign_in(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        return token

    def ask(self, user, password=PASSWORD, username=None):
        self.sign_in(user)
        return self.client.post(
            '/api/auth/me/erasure/', {'password': password, 'username': username or user.username}, format='json'
        )


# ---- 1. the registry -----------------------------------------------------------------------------

class RegistryCompletenessTests(APITestCase):
    """The test that makes a new app decide. If this fails, add a `Rule` to `accounts/erasure.py`
    for the field it names: delete (private), anonymise (a public contribution), keep (a record
    others rely on) or end (something live with somebody on the other side)."""

    def _person_fields(self):
        User = get_user_model()
        found = set()
        for model in apps.get_models(include_auto_created=True):
            if model._meta.proxy:
                continue
            for f in model._meta.get_fields():
                if not (f.is_relation and f.concrete and (f.many_to_one or f.one_to_one)):
                    continue
                if f.related_model is User:
                    found.add((model._meta.label, f.name))
                elif f.related_model is Profile:
                    found.add((model._meta.label, f'{f.name}__user'))
        return found

    def test_every_foreign_key_to_a_person_has_a_rule(self):
        index = erasure.rule_index()
        missing = sorted(k for k in self._person_fields() if k not in index)
        self.assertEqual(missing, [], 'Add these to accounts/erasure.py REGISTRY: ' + repr(missing))

    def test_every_rule_names_a_real_field(self):
        for rule in erasure.REGISTRY:
            model = apps.get_model(rule.model)
            model._base_manager.filter(**{rule.field: None})  # raises FieldError if the path is wrong
            self.assertIn(rule.action, erasure.ACTIONS, rule)
            self.assertIn(rule.group, erasure.GROUPS, rule)

    def test_no_rule_is_listed_twice(self):
        keys = [(r.model, r.field) for r in erasure.REGISTRY]
        self.assertEqual(len(keys), len(set(keys)))

    def test_log_shard_columns_that_hold_a_person_are_listed(self):
        """The shards cannot carry a foreign key, so the walk above cannot see them."""
        for model in apps.get_app_config('telemetry').get_models():
            for f in model._meta.concrete_fields:
                if f.name in ('user_id', 'actor_id'):
                    self.assertEqual(erasure.SHARD_FIELDS.get(model._meta.label), f.name)


# ---- 2. asking --------------------------------------------------------------------------------------

class AskingTests(_Base):
    def setUp(self):
        super().setUp()
        self.user = make_user('ola')
        self.user.email = 'ola@example.com'
        self.user.save()

    def test_the_plan_is_readable_before_asking(self):
        Comment = apps.get_model('community', 'Comment')
        ex = make_exercise(make_branch(), 1)
        Comment.objects.create(content_type=ContentType.objects.get_for_model(ex), object_id=ex.pk, author=self.user, body='x')
        self.sign_in(self.user)
        r = self.client.get('/api/auth/me/erasure/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'none')
        self.assertIsNone(r.data['refusal'])
        self.assertEqual(r.data['grace_days'], 14)
        plan = {(p['group'], p['action']): p['count'] for p in r.data['plan']}
        self.assertEqual(plan[('discussion', 'anonymise')], 1)
        self.assertEqual(plan[('account', 'delete')], 1)

    def test_wrong_password_is_refused_with_its_reason(self):
        r = self.ask(self.user, password='nope')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'wrong_password'))
        self.assertTrue(User.objects.get(pk=self.user.pk).is_active)

    def test_the_username_must_be_typed(self):
        r = self.ask(self.user, username='someone')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'username_mismatch'))

    def test_a_password_less_account_is_sent_to_set_one(self):
        self.user.set_unusable_password()
        self.user.save()
        r = self.ask(self.user)
        self.assertEqual((r.status_code, r.data['reason']), (400, 'password_required'))

    def test_a_child_asks_their_guardian(self):
        self.user.profile.is_minor = True
        self.user.profile.save()
        r = self.ask(self.user)
        self.assertEqual((r.status_code, r.data['reason']), (400, 'guardian_managed'))

    def test_asking_switches_the_account_off_at_once(self):
        from mail.models import ConfirmedEmail

        ConfirmedEmail.objects.create(user=self.user, email=self.user.email)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.ask(self.user)
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.data['status'], 'pending')
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertFalse(Token.objects.filter(user=self.user).exists())
        # The old token no longer works anywhere, and the profile is hidden.
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials()
        hidden = self.client.get(f'/api/users/{self.user.pk}/')
        self.assertEqual(hidden.status_code, 200)  # bylines keep resolving
        self.assertEqual((hidden.data['bio'], hidden.data['is_profile_public']), ('', False))
        # The owner's inbox hears about it, with a link that cancels — never stored in the log.
        self.assertEqual(len(django_mail.outbox), 1)
        self.assertIn('/cancel-deletion?token=', django_mail.outbox[0].body)
        from mail.models import OutboundEmail

        logged = OutboundEmail.objects.get(kind='account_erasure')
        self.assertIn(OutboundEmail.LINK_MARKER, logged.body)
        self.assertNotIn('cancel-deletion?token=', logged.body)

    def test_an_unconfirmed_address_gets_no_mail(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.ask(self.user)
        self.assertEqual(len(django_mail.outbox), 0)

    def test_a_second_request_is_a_409(self):
        erasure.request_erasure(self.user, requested_by=self.user)
        with self.assertRaises(erasure.Refusal) as ctx:
            erasure.request_erasure(self.user, requested_by=self.user)
        self.assertEqual((ctx.exception.reason, ctx.exception.status), ('already_pending', 409))

    def test_a_course_with_participants_blocks_and_is_named(self):
        Course = apps.get_model('courses', 'Course')
        Enrollment = apps.get_model('courses', 'Enrollment')
        course = Course.objects.create(instructor=self.user, title='Analiza I', status='running')
        Enrollment.objects.create(course=course, participant=make_viewer('student'), status='active')
        r = self.ask(self.user)
        self.assertEqual((r.status_code, r.data['reason']), (409, 'blocked'))
        self.assertEqual(r.data['blockers'], [
            {'kind': 'course', 'id': course.pk, 'title': 'Analiza I', 'reason': 'course_has_participants'}
        ])
        self.assertTrue(User.objects.get(pk=self.user.pk).is_active)
        # A finished course is history, not a blocker.
        Course.objects.filter(pk=course.pk).update(status='finished')
        self.assertEqual(self.ask(self.user).status_code, 202)

    def test_an_organisation_with_no_other_owner_blocks(self):
        Organization = apps.get_model('organizations', 'Organization')
        Member = apps.get_model('organizations', 'OrganizationMember')
        org = Organization.objects.create(name='Koło', slug='kolo')
        Member.objects.create(organization=org, user=self.user, role='owner')
        Member.objects.create(organization=org, user=make_viewer('m'), role='member')
        self.assertEqual(erasure.blockers(self.user)[0]['reason'], 'sole_owner')


# ---- 3. the grace period ------------------------------------------------------------------------------

class GracePeriodTests(_Base):
    def setUp(self):
        super().setUp()
        self.user = make_user('ola')
        erasure.request_erasure(self.user, requested_by=self.user)
        self.client.credentials()

    def test_signing_in_says_why_and_offers_to_cancel(self):
        r = self.client.post('/api/auth/login/', {'username': 'ola', 'password': PASSWORD}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data['detail'], 'erasure_pending')
        self.assertTrue(r.data['can_cancel'])

    def test_a_wrong_password_learns_nothing(self):
        r = self.client.post('/api/auth/login/', {'username': 'ola', 'password': 'x'}, format='json')
        self.assertEqual(r.status_code, 401)

    def test_cancelling_with_the_password_signs_back_in(self):
        r = self.client.post('/api/auth/erasure/cancel/', {'username': 'ola', 'password': PASSWORD}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['token'])
        self.assertTrue(User.objects.get(pk=self.user.pk).is_active)
        self.assertEqual(AccountErasure.objects.get(user=self.user).status, 'cancelled')
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {r.data['token']}")
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    def test_the_mailed_link_cancels(self):
        token = erasure.cancel_token(self.user)
        r = self.client.post('/api/auth/erasure/cancel/', {'token': token}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(User.objects.get(pk=self.user.pk).is_active)
        # Used once, it is spent: the request it was signed for is no longer pending.
        r = self.client.post('/api/auth/erasure/cancel/', {'token': token}, format='json')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'nothing_pending'))

    def test_a_forged_link_is_refused(self):
        r = self.client.post('/api/auth/erasure/cancel/', {'token': 'abc'}, format='json')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'invalid'))

    def test_nothing_is_erased_before_the_grace_period_ends(self):
        self.assertEqual(erasure.run_due(), [])
        self.assertEqual(User.objects.get(pk=self.user.pk).username, 'ola')
        later = timezone.now() + erasure.GRACE_PERIOD + timedelta(minutes=1)
        self.assertEqual(len(erasure.run_due(later)), 1)
        self.assertEqual(User.objects.get(pk=self.user.pk).username, f'deleted-{self.user.pk}')

    def test_a_cancel_cannot_land_once_erasure_has_started(self):
        row = AccountErasure.objects.get(user=self.user)
        self.assertTrue(erasure.claim(row))
        self.assertFalse(erasure.cancel_erasure(self.user))
        self.assertFalse(User.objects.get(pk=self.user.pk).is_active)

    def test_the_command_needs_one_named_account_to_skip_the_grace_period(self):
        from django.core.management import CommandError, call_command

        with self.assertRaises(CommandError):
            call_command('erase_due_accounts', '--now')
        call_command('erase_due_accounts', '--now', '--user', str(self.user.pk), stdout=open('/dev/null', 'w'))
        self.assertEqual(AccountErasure.objects.get(user=self.user).status, 'done')


# ---- 4. the erasure ----------------------------------------------------------------------------------

class ErasureTests(_Base):
    def setUp(self):
        super().setUp()
        self.user = make_user('ola')
        self.user.email = 'ola@example.com'
        self.user.first_name = 'Ola'
        self.user.save()
        p = self.user.profile
        p.display_name = 'Ola Kowalska'
        p.bio = 'I study physics'
        p.save()
        self.other = make_user('bartek')
        self.other.email = 'bartek@example.com'
        self.other.save()
        self.exercise = make_exercise(make_branch(), 1)
        self.ct = ContentType.objects.get_for_model(self.exercise)

    def _erase(self):
        erasure.request_erasure(self.user, requested_by=self.user)
        result = erasure.run_due(ignore_grace=True, only_user_id=self.user.pk)
        self.user.refresh_from_db()
        return result

    def test_the_tombstone_names_nobody(self):
        self._erase()
        self.assertEqual(self.user.username, f'deleted-{self.user.pk}')
        self.assertEqual((self.user.email, self.user.first_name), ('', ''))
        self.assertFalse(self.user.has_usable_password())
        self.assertFalse(self.user.is_active)
        profile = Profile.objects.get(user=self.user)
        self.assertEqual(profile.display_name, erasure.DELETED_LABEL)
        self.assertEqual(profile.bio, '')
        self.assertFalse(profile.show_profile_publicly)
        row = AccountErasure.objects.get(user=self.user)
        self.assertEqual(row.status, 'done')
        self.assertTrue(row.summary)
        # Once erased the public profile answers again — as the tombstone.
        self.client.credentials()
        r = self.client.get(f'/api/users/{self.user.pk}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['display_name'], erasure.DELETED_LABEL)

    def test_public_contributions_stay_without_the_name(self):
        Comment = apps.get_model('community', 'Comment')
        reply_to = Comment.objects.create(content_type=self.ct, object_id=self.exercise.pk, author=self.other, body='q')
        mine = Comment.objects.create(content_type=self.ct, object_id=self.exercise.pk, author=self.user, body='a', parent=reply_to)
        self.exercise.submitted_by = self.user
        self.exercise.save()
        self._erase()
        mine.refresh_from_db()
        self.assertFalse(mine.is_removed)
        self.assertEqual(mine.author_id, self.user.pk)
        self.exercise.refresh_from_db()
        self.assertEqual(self.exercise.submitted_by_id, self.user.pk)
        self.assertTrue(Comment.objects.filter(pk=reply_to.pk).exists())

    def test_private_rows_are_deleted(self):
        TagFollow = apps.get_model('exercises', 'TagFollow')
        ContentView = apps.get_model('moderation', 'ContentView')
        ExerciseSet = apps.get_model('study', 'ExerciseSet')
        Notification = apps.get_model('notifications', 'Notification')
        SsoIdentity = apps.get_model('sso', 'SsoIdentity')
        ContentView.objects.create(user=self.user, exercise=self.exercise)
        private = ExerciseSet.objects.create(owner=self.user, name='mine')
        public = ExerciseSet.objects.create(owner=self.user, name='shared', is_public=True)
        Notification.objects.create(recipient=self.user, type='comment_reply')
        SsoIdentity.objects.create(user=self.user, provider='google', issuer='https://accounts.google.com', subject='123')
        tag_follow_fields = {f.name for f in TagFollow._meta.concrete_fields}
        self._erase()
        self.assertFalse(ContentView.objects.filter(user=self.user).exists())
        self.assertFalse(ExerciseSet.objects.filter(pk=private.pk).exists())
        self.assertTrue(ExerciseSet.objects.filter(pk=public.pk).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())
        self.assertFalse(SsoIdentity.objects.filter(user=self.user).exists())
        self.assertTrue(tag_follow_fields)

    def test_the_other_party_keeps_the_conversation(self):
        from messaging.services import send_message

        send_message(self.user, self.other, 'Korki', 'hello from ola')
        send_message(self.other, self.user, 'Re: Korki', 'hi ola')
        self._erase()
        Message = apps.get_model('postman', 'Message')
        self.assertEqual(Message.objects.filter(recipient=self.other).count(), 1)
        self.sign_in(self.other)
        r = self.client.get('/api/messages/?folder=inbox')
        self.assertEqual(r.status_code, 200)
        text = json.dumps(r.data)
        self.assertIn(erasure.DELETED_LABEL, text)
        self.assertNotIn('Ola Kowalska', text)

    def test_a_future_booking_is_cancelled_and_the_tutor_told(self):
        Service = apps.get_model('services', 'Service')
        Booking = apps.get_model('booking', 'Booking')
        Notification = apps.get_model('notifications', 'Notification')
        service = Service.objects.create(provider=self.other, title='Fizyka')
        start = timezone.now() + timedelta(days=3)
        future = Booking.objects.create(service=service, tutor=self.other, student=self.user, starts_at=start,
                                        ends_at=start + timedelta(hours=1), status='confirmed')
        past = Booking.objects.create(service=service, tutor=self.other, student=self.user,
                                      starts_at=start - timedelta(days=30), ends_at=start - timedelta(days=30, hours=-1),
                                      status='completed')
        self._erase()
        future.refresh_from_db()
        past.refresh_from_db()
        self.assertEqual((future.status, future.cancelled_by_id), ('cancelled', self.user.pk))
        self.assertEqual(past.status, 'completed')
        self.assertTrue(Notification.objects.filter(recipient=self.other, type='booking_cancelled').exists())

    def test_a_tutoring_listing_is_switched_off(self):
        Service = apps.get_model('services', 'Service')
        service = Service.objects.create(provider=self.user, title='Matma')
        self._erase()
        service.refresh_from_db()
        self.assertFalse(service.is_active)

    def test_a_live_enrolment_ends_as_left(self):
        Course = apps.get_model('courses', 'Course')
        Enrollment = apps.get_model('courses', 'Enrollment')
        course = Course.objects.create(instructor=self.other, title='Kurs', status='running')
        row = Enrollment.objects.create(course=course, participant=self.user, status='active')
        self._erase()
        row.refresh_from_db()
        self.assertEqual(row.status, 'left')

    def test_the_audit_log_is_pseudonymised_not_deleted(self):
        AuditEvent = apps.get_model('telemetry', 'AuditEvent')
        shard = shard_for_user(self.user.pk)
        AuditEvent.objects.using(shard).create(actor_id=self.user.pk, actor_label='ola', action='moderation_decision',
                                               summary='removed a comment', ip_address='10.0.0.1')
        self._erase()
        event = AuditEvent.objects.using(shard).get(summary='removed a comment')
        self.assertIsNone(event.actor_id)
        self.assertEqual(event.actor_label, erasure.DELETED_LABEL)
        self.assertIsNone(event.ip_address)

    def test_mail_to_the_address_is_forgotten(self):
        from mail.models import OutboundEmail

        OutboundEmail.objects.create(kind='test', to='ola@example.com', subject='s', body='b')
        self._erase()
        self.assertFalse(OutboundEmail.objects.filter(to__iexact='ola@example.com').exists())

    def test_running_twice_changes_nothing_more(self):
        Comment = apps.get_model('community', 'Comment')
        Comment.objects.create(content_type=self.ct, object_id=self.exercise.pk, author=self.user, body='a')
        self._erase()
        before = (User.objects.get(pk=self.user.pk).username, Comment.objects.filter(is_removed=False).count())
        self.assertEqual(erasure.run_due(ignore_grace=True, only_user_id=self.user.pk), [])
        erasure.erase(self.user)  # by hand, on an already-erased account: no error, no change
        self.assertEqual(before, (User.objects.get(pk=self.user.pk).username, Comment.objects.filter(is_removed=False).count()))

    def test_a_run_that_died_half_way_is_finished_by_the_next(self):
        erasure.request_erasure(self.user, requested_by=self.user)
        AccountErasure.objects.filter(user=self.user).update(status='erasing')
        self.assertEqual(len(erasure.run_due(ignore_grace=True)), 1)
        self.assertEqual(AccountErasure.objects.get(user=self.user).status, 'done')

    def test_a_childs_comments_go_with_the_account(self):
        Comment = apps.get_model('community', 'Comment')
        self.user.profile.is_minor = True
        self.user.profile.save()
        c = Comment.objects.create(content_type=self.ct, object_id=self.exercise.pk, author=self.user, body='a')
        self._erase()
        c.refresh_from_db()
        self.assertTrue(c.is_removed)


# ---- 5. the guardian path -------------------------------------------------------------------------------

class GuardianTests(_Base):
    def setUp(self):
        super().setUp()
        self.guardian = make_user('mama')
        self.sign_in(self.guardian)
        r = self.client.post('/api/auth/children/', {'username': 'jas', 'password': 'Dziecko-123!', 'display_name': 'Jaś'}, format='json')
        self.child = User.objects.get(pk=r.data['id'])

    def test_deleting_a_child_waits_out_the_same_grace_period(self):
        r = self.client.delete(f'/api/auth/children/{self.child.pk}/')
        self.assertEqual(r.status_code, 202)
        self.child.refresh_from_db()
        self.assertFalse(self.child.is_active)
        row = AccountErasure.objects.get(user=self.child)
        self.assertTrue(row.by_guardian)
        me = self.client.get('/api/auth/me/').data
        self.assertTrue(me['guardian_of'][0]['erasure_due_at'])

    def test_the_child_cannot_undo_the_guardians_decision(self):
        self.client.delete(f'/api/auth/children/{self.child.pk}/')
        self.client.credentials()
        r = self.client.post('/api/auth/login/', {'username': 'jas', 'password': 'Dziecko-123!'}, format='json')
        self.assertEqual((r.status_code, r.data['can_cancel']), (403, False))
        r = self.client.post('/api/auth/erasure/cancel/', {'username': 'jas', 'password': 'Dziecko-123!'}, format='json')
        self.assertEqual((r.status_code, r.data['reason']), (409, 'guardian_requested'))

    def test_reactivating_cancels(self):
        self.client.delete(f'/api/auth/children/{self.child.pk}/')
        r = self.client.patch(f'/api/auth/children/{self.child.pk}/', {'is_active': True}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(AccountErasure.objects.get(user=self.child).status, 'cancelled')
        self.assertTrue(User.objects.get(pk=self.child.pk).is_active)

    def test_erasing_the_only_guardian_erases_the_child(self):
        erasure.request_erasure(self.guardian, requested_by=self.guardian)
        erasure.run_due(ignore_grace=True, only_user_id=self.guardian.pk)
        self.child.refresh_from_db()
        self.assertEqual(self.child.username, f'deleted-{self.child.pk}')
        self.assertEqual(AccountErasure.objects.get(user=self.child).status, 'done')
        self.assertTrue(Guardianship.objects.get(child=self.child).revoked_at)

    def test_a_second_guardian_keeps_the_child(self):
        Guardianship.objects.create(guardian=make_viewer('tata'), child=self.child)
        erasure.request_erasure(self.guardian, requested_by=self.guardian)
        erasure.run_due(ignore_grace=True, only_user_id=self.guardian.pk)
        self.child.refresh_from_db()
        self.assertEqual(self.child.username, 'jas')


# ---- 6. the export --------------------------------------------------------------------------------

class ExportTests(_Base):
    def setUp(self):
        super().setUp()
        self.user = make_user('ola')
        self.user.email = 'ola@example.com'
        self.user.save()
        self.other = make_user('bartek')
        self.other.email = 'bartek@example.com'
        self.other.save()
        self.other.profile.display_name = 'Bartek N.'
        self.other.profile.save()

    def _export(self):
        self.sign_in(self.user)
        r = self.client.get('/api/auth/me/export/')
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertIn('attachment', r['Content-Disposition'])
        return json.loads(r.content)

    def test_messages_are_decrypted_and_name_the_other_party_by_display_name_only(self):
        from messaging.services import send_message

        send_message(self.user, self.other, 'Korki', 'secret body')
        send_message(self.other, self.user, 'Re: Korki', 'their reply')
        data = self._export()
        rows = data['sections']['postman.Message']['rows']
        self.assertEqual({r['body'] for r in rows}, {'secret body', 'their reply'})
        sender = next(r for r in rows if r['body'] == 'their reply')['sender']
        self.assertEqual(sender, {'id': self.other.pk, 'display_name': 'Bartek N.'})
        blob = json.dumps(data)
        self.assertNotIn('bartek@example.com', blob)
        self.assertNotIn('"bartek"', blob)

    def test_it_holds_the_account_and_content_and_no_secrets(self):
        Comment = apps.get_model('community', 'Comment')
        ex = make_exercise(make_branch(), 1)
        Comment.objects.create(content_type=ContentType.objects.get_for_model(ex), object_id=ex.pk, author=self.user, body='my words')
        data = self._export()
        self.assertEqual((data['format'], data['version']), ('edmat-account-export', 1))
        self.assertEqual(data['sections']['accounts.User']['rows'][0]['account']['email'], 'ola@example.com')
        self.assertEqual(data['sections']['community.Comment']['rows'][0]['body'], 'my words')
        self.assertIn('body', data['sections']['community.Comment']['fields'])
        blob = json.dumps(data)
        self.assertNotIn(self.user.password, blob)
        self.assertNotIn(Token.objects.get(user=self.user).key, blob)
        self.assertNotIn('anon_ip_hash', blob)

    def test_it_includes_the_persons_own_request_log(self):
        RequestLog = apps.get_model('telemetry', 'RequestLog')
        RequestLog.objects.using(shard_for_user(self.user.pk)).create(
            user_id=self.user.pk, method='GET', path='/api/exercises/1/', status_code=200, duration_ms=3, request_id='r1'
        )
        data = self._export()
        paths = [r['path'] for r in data['sections']['telemetry.RequestLog']['rows']]
        self.assertIn('/api/exercises/1/', paths)

    def test_a_minor_may_still_download(self):
        self.user.profile.is_minor = True
        self.user.profile.save()
        self._export()

    def test_three_a_day(self):
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'account_export': '3/day'}):
            self.sign_in(self.user)
            codes = [self.client.get('/api/auth/me/export/').status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])


# ---- 7. retention ---------------------------------------------------------------------------------

class RetentionTests(_Base):
    def test_old_rows_go_and_recent_ones_stay(self):
        from accounts.retention import enforce
        from mail.models import OutboundEmail

        ContentView = apps.get_model('moderation', 'ContentView')
        Comment = apps.get_model('community', 'Comment')
        user = make_viewer('v')
        ex1, ex2 = make_exercise(make_branch(), 1), make_exercise(make_branch(slug='b2'), 2)
        old = ContentView.objects.create(user=user, exercise=ex1)
        new = ContentView.objects.create(user=user, exercise=ex2)
        ContentView.objects.filter(pk=old.pk).update(viewed_at=timezone.now() - timedelta(days=400))
        anon = Comment.objects.create(content_type=ContentType.objects.get_for_model(ex1), object_id=ex1.pk,
                                      anon_name='Gość', anon_ip_hash='a' * 64, body='hi')
        Comment.objects.filter(pk=anon.pk).update(created_at=timezone.now() - timedelta(days=31))
        sent = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='b', status='sent')
        waiting = OutboundEmail.objects.create(kind='test', to='x@example.com', subject='s', body='b', status='queued')
        OutboundEmail.objects.filter(pk__in=[sent.pk, waiting.pk]).update(created_at=timezone.now() - timedelta(days=400))

        self.assertEqual(enforce(dry_run=True)['content_views'], 1)
        self.assertTrue(ContentView.objects.filter(pk=old.pk).exists())
        result = enforce()
        self.assertEqual(result['content_views'], 1)
        self.assertFalse(ContentView.objects.filter(pk=old.pk).exists())
        self.assertTrue(ContentView.objects.filter(pk=new.pk).exists())
        anon.refresh_from_db()
        self.assertEqual((anon.anon_ip_hash, anon.body), ('', 'hi'))
        self.assertFalse(OutboundEmail.objects.filter(pk=sent.pk).exists())
        self.assertTrue(OutboundEmail.objects.filter(pk=waiting.pk).exists())
        self.assertEqual(enforce()['content_views'], 0)


# ---- 8. the choice about content that is not openly licensed (owner, 2026-10-14) -------------------

class WithdrawableContentTests(_Base):
    """`edmat-only` / `unknown` content: the person chooses keep or remove. Openly licensed content
    always stays (a CC grant cannot be revoked); a co-authored item stays whatever the choice."""

    def setUp(self):
        super().setUp()
        self.user = make_user('ola')
        branch = make_branch()
        self.mine = make_exercise(branch, 1)  # edmat-only, the default
        self.open = make_exercise(branch, 2)
        self.corpus = make_exercise(branch, 3)
        apps.get_model('exercises', 'Exercise').objects.filter(pk__in=[self.mine.pk, self.open.pk, self.corpus.pk]).update(submitted_by=self.user)
        apps.get_model('exercises', 'Exercise').objects.filter(pk=self.open.pk).update(licence='cc-by-sa-4.0')
        apps.get_model('exercises', 'Exercise').objects.filter(pk=self.corpus.pk).update(licence='unknown')
        # A co-authored material: somebody else's published version is in it.
        from coauthoring.models import MaterialProject, MaterialVersion

        self.material = make_material(branch)
        apps.get_model('materials', 'Material').objects.filter(pk=self.material.pk).update(submitted_by=self.user)
        project = MaterialProject.objects.create(material=self.material, branch=branch, created_by=self.user)
        MaterialVersion.objects.create(project=project, number=1, title='v1', file='m/v1.pdf',
                                       created_by=make_viewer('coauthor'), status='published')

    def _published(self, obj):
        return type(obj).objects.get(pk=obj.pk).published

    def test_the_plan_counts_what_each_answer_would_touch(self):
        self.sign_in(self.user)
        r = self.client.get('/api/auth/me/erasure/')
        self.assertEqual(r.data['withdrawable'], {'removable': 2, 'shared': 1})

    def test_the_question_has_no_default_answer(self):
        r = self.ask(self.user)
        self.assertEqual((r.status_code, r.data['reason']), (400, 'choice_required'))
        self.sign_in(self.user)
        r = self.client.post('/api/auth/me/erasure/', {'password': PASSWORD, 'username': 'ola', 'withdrawable_content': 'maybe'}, format='json')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'choice_invalid'))

    def _erase_with(self, choice):
        self.sign_in(self.user)
        r = self.client.post('/api/auth/me/erasure/', {'password': PASSWORD, 'username': 'ola', 'withdrawable_content': choice}, format='json')
        self.assertEqual(r.status_code, 202)
        self.assertEqual(AccountErasure.objects.get(user=self.user).withdrawable_content, choice)
        erasure.run_due(ignore_grace=True, only_user_id=self.user.pk)

    def test_keep_leaves_everything_published_without_the_name(self):
        self._erase_with('keep')
        self.assertTrue(self._published(self.mine))
        self.assertTrue(self._published(self.corpus))
        self.assertEqual(type(self.mine).objects.get(pk=self.mine.pk).submitted_by_id, self.user.pk)

    def test_remove_hides_only_what_can_be_taken_back(self):
        self._erase_with('remove')
        self.assertFalse(self._published(self.mine))     # edmat-only: hidden, row kept
        self.assertFalse(self._published(self.corpus))   # unknown: follows the choice
        self.assertTrue(self._published(self.open))      # CC: cannot be revoked
        self.assertTrue(self._published(self.material))  # co-authored: somebody else's work is in it

    def test_a_guardians_delete_removes(self):
        guardian = make_user('mama')
        Guardianship.objects.create(guardian=guardian, child=self.user)
        self.user.profile.is_minor = True
        self.user.profile.save()
        self.sign_in(guardian)
        self.assertEqual(self.client.delete(f'/api/auth/children/{self.user.pk}/').status_code, 202)
        self.assertEqual(AccountErasure.objects.get(user=self.user).withdrawable_content, 'remove')

    def test_a_minor_is_refused_server_side_with_the_reason(self):
        self.user.profile.is_minor = True
        self.user.profile.save()
        self.sign_in(self.user)
        self.assertEqual(self.client.get('/api/auth/me/erasure/').data['refusal'], 'guardian_managed')
        r = self.client.post('/api/auth/me/erasure/', {'password': PASSWORD, 'username': 'ola', 'withdrawable_content': 'keep'}, format='json')
        self.assertEqual((r.status_code, r.data['reason']), (400, 'guardian_managed'))
        self.assertFalse(AccountErasure.objects.filter(user=self.user).exists())
