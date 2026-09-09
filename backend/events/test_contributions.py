"""The call for contributions (AUDIENCE-BRIEF.md §3.4): who may propose and when, who sees what,
the review transitions with their refusals, single-blind, scheduling into a real Session, and
the report kinds. Refusals first."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Contribution, Event, EventStaff, Session


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class ContributionCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('cfp-host')
        self.reviewer = make_user('cfp-reviewer')
        self.author = make_user('cfp-author')
        self.other = make_user('cfp-other')
        self.start = timezone.now() + timedelta(days=10)
        self.event = Event.objects.create(
            host=self.host, title='Student colloquium', status='published', visibility='public',
            starts_at=self.start, runs_until=self.start + timedelta(days=1), location_kind='onsite',
            location_text='Aula', cfp_open=True,
        )
        EventStaff.objects.create(event=self.event, user=self.reviewer, role='reviewer')

    def url(self, suffix=''):
        return reverse('event-contributions', args=[self.event.pk]) + suffix

    def verb(self, c, verb):
        return reverse('event-contribution-transition', kwargs={'pk': self.event.pk, 'contribution_id': c.pk, 'verb': verb})

    def propose(self, user=None, **extra):
        body = {'kind': 'talk', 'title': 'Why integrals', 'abstract': 'A short talk.', 'audience': 'secondary', **extra}
        return as_(user or self.author).post(self.url(), body, format='json')


class ProposingTests(ContributionCase):
    def test_a_proposal_is_submitted_and_the_staff_are_told(self):
        r = self.propose()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['status'], 'submitted')
        told = set(Notification.objects.filter(type='contribution_submitted').values_list('recipient_id', flat=True))
        self.assertEqual(told, {self.host.pk, self.reviewer.pk})

    def test_a_closed_call_refuses(self):
        self.event.cfp_open = False
        self.event.save()
        self.assertEqual(self.propose().status_code, 409)
        self.event.cfp_open = True
        self.event.cfp_deadline = timezone.now() - timedelta(hours=1)
        self.event.save()
        self.assertEqual(self.propose().status_code, 409)

    def test_visibility_until_accepted(self):
        c = Contribution.objects.get(pk=self.propose().json()['id'])
        self.assertEqual(self.client.get(self.url()).json(), [])
        self.assertEqual(as_(self.other).get(self.url()).json(), [])
        self.assertEqual([row['id'] for row in as_(self.author).get(self.url()).json()], [c.pk])
        self.assertEqual([row['id'] for row in as_(self.reviewer).get(self.url()).json()], [c.pk])
        as_(self.reviewer).post(self.verb(c, 'accept'), {}, format='json')
        self.assertEqual([row['id'] for row in self.client.get(self.url()).json()], [c.pk])

    def test_editing_is_the_authors_while_undecided(self):
        c = Contribution.objects.get(pk=self.propose().json()['id'])
        detail = reverse('event-contribution-detail', kwargs={'pk': self.event.pk, 'contribution_id': c.pk})
        self.assertEqual(as_(self.other).patch(detail, {'title': 'x'}, format='json').status_code, 404)
        self.assertEqual(as_(self.reviewer).patch(detail, {'title': 'x'}, format='json').status_code, 403)
        self.assertEqual(as_(self.author).patch(detail, {'title': 'Why integrals, really'}, format='json').status_code, 200)
        as_(self.reviewer).post(self.verb(c, 'review'), {}, format='json')
        self.assertEqual(as_(self.author).patch(detail, {'title': 'y'}, format='json').status_code, 409)

    def test_co_authors_are_bounded(self):
        r = self.propose(co_authors=[{'name': f'P{i}'} for i in range(6)])
        self.assertEqual(r.status_code, 400)
        r = self.propose(co_authors=[{'name': 'Ala', 'affiliation': 'UW'}, {'name': 'Ola'}])
        self.assertEqual(r.status_code, 201, r.content)


class ReviewTests(ContributionCase):
    def make(self):
        return Contribution.objects.get(pk=self.propose().json()['id'])

    def test_only_reviewers_and_organisers_decide(self):
        c = self.make()
        self.assertEqual(as_(self.other).post(self.verb(c, 'accept'), {}, format='json').status_code, 404)
        self.assertEqual(as_(self.author).post(self.verb(c, 'accept'), {}, format='json').status_code, 403)
        volunteer = make_user('cfp-vol')
        EventStaff.objects.create(event=self.event, user=volunteer, role='volunteer')
        self.assertEqual(as_(volunteer).post(self.verb(c, 'accept'), {}, format='json').status_code, 403)
        self.assertEqual(as_(self.reviewer).post(self.verb(c, 'accept'), {}, format='json').status_code, 200)

    def test_a_rejection_needs_a_reason_code_and_the_author_never_sees_who(self):
        c = self.make()
        self.assertEqual(as_(self.reviewer).post(self.verb(c, 'reject'), {}, format='json').status_code, 400)
        r = as_(self.reviewer).post(self.verb(c, 'reject'), {'reason_code': 'out_of_scope', 'note': 'Not for this event.'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['decided_by']['id'], self.reviewer.pk)
        mine = as_(self.author).get(reverse('event-contribution-detail', kwargs={'pk': self.event.pk, 'contribution_id': c.pk})).json()
        self.assertEqual(mine['status'], 'rejected')
        self.assertEqual(mine['reason_code'], 'out_of_scope')
        self.assertEqual(mine['review_note'], 'Not for this event.')
        self.assertIsNone(mine['decided_by'])
        self.assertEqual(Notification.objects.filter(recipient=self.author, type='contribution_decided').count(), 1)

    def test_revisions_reopen_editing_and_need_a_note(self):
        c = self.make()
        as_(self.reviewer).post(self.verb(c, 'review'), {}, format='json')
        self.assertEqual(as_(self.reviewer).post(self.verb(c, 'revisions'), {}, format='json').status_code, 400)
        r = as_(self.reviewer).post(self.verb(c, 'revisions'), {'note': 'Shorten the abstract.'}, format='json')
        self.assertEqual(r.json()['status'], 'submitted')
        self.assertTrue(r.json()['can_edit'] is False)  # the reviewer is not the author
        mine = as_(self.author).get(reverse('event-contribution-detail', kwargs={'pk': self.event.pk, 'contribution_id': c.pk})).json()
        self.assertTrue(mine['can_edit'])

    def test_the_author_may_pull_back_and_withdraw(self):
        c = self.make()
        self.assertEqual(as_(self.author).post(self.verb(c, 'unsubmit'), {}, format='json').json()['status'], 'draft')
        self.assertEqual(as_(self.author).post(self.verb(c, 'submit'), {}, format='json').json()['status'], 'submitted')
        self.assertEqual(as_(self.author).post(self.verb(c, 'withdraw'), {}, format='json').json()['status'], 'withdrawn')
        self.assertEqual(as_(self.author).post(self.verb(c, 'submit'), {}, format='json').status_code, 409)


class SchedulingTests(ContributionCase):
    def test_scheduling_makes_a_session_with_the_submitter_as_speaker(self):
        c = Contribution.objects.get(pk=self.propose(co_authors=[{'name': 'Co Author', 'affiliation': 'PW'}]).json()['id'])
        as_(self.reviewer).post(self.verb(c, 'accept'), {}, format='json')
        # A reviewer may not write the programme.
        body = {'starts_at': (self.start + timedelta(hours=2)).isoformat(), 'duration_minutes': 30, 'location_text': 'Room 1'}
        self.assertEqual(as_(self.reviewer).post(self.verb(c, 'schedule'), body, format='json').status_code, 403)
        r = as_(self.host).post(self.verb(c, 'schedule'), body, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['status'], 'scheduled')
        session = Session.objects.get(pk=r.json()['session_id'])
        self.assertEqual(session.title, 'Why integrals')
        self.assertEqual([s.name for s in session.speakers.all()], ['cfp-author', 'Co Author'])
        self.assertEqual(session.speakers.first().user_id, self.author.pk)
        # Outside the event it is refused, the session's own rule.
        c2 = Contribution.objects.get(pk=self.propose(title='Second').json()['id'])
        as_(self.reviewer).post(self.verb(c2, 'accept'), {}, format='json')
        bad = as_(self.host).post(self.verb(c2, 'schedule'), {'starts_at': (self.start - timedelta(days=1)).isoformat()}, format='json')
        self.assertEqual(bad.status_code, 400)
        # Unscheduling releases the slot and keeps the proposal in the pool.
        self.assertEqual(as_(self.host).post(self.verb(c, 'unschedule'), {}, format='json').json()['status'], 'accepted')
        self.assertFalse(Session.objects.filter(pk=session.pk).exists())

    def test_withdrawing_a_scheduled_talk_vacates_the_slot(self):
        c = Contribution.objects.get(pk=self.propose().json()['id'])
        as_(self.reviewer).post(self.verb(c, 'accept'), {}, format='json')
        r = as_(self.host).post(self.verb(c, 'schedule'), {'starts_at': (self.start + timedelta(hours=1)).isoformat()}, format='json')
        sid = r.json()['session_id']
        as_(self.author).post(self.verb(c, 'withdraw'), {}, format='json')
        self.assertFalse(Session.objects.filter(pk=sid).exists())
        c.refresh_from_db()
        self.assertEqual(c.status, 'withdrawn')

    def test_counts_on_the_event(self):
        c = Contribution.objects.get(pk=self.propose().json()['id'])
        body = as_(self.reviewer).get(reverse('event-detail', args=[self.event.pk])).json()
        self.assertEqual(body['contribution_counts'], {'accepted': 0, 'pending': 1})
        self.assertTrue(body['call_is_open'])
        self.assertEqual(self.client.get(reverse('event-detail', args=[self.event.pk])).json()['contribution_counts'], {'accepted': 0})
        as_(self.reviewer).post(self.verb(c, 'accept'), {}, format='json')
        self.assertEqual(self.client.get(reverse('event-detail', args=[self.event.pk])).json()['contribution_counts'], {'accepted': 1})


class ReportKindTests(ContributionCase):
    def test_a_moderator_removing_a_reported_event_hides_it_and_restore_reveals_it(self):
        mod = make_user('cfp-mod', is_staff=True)
        r = as_(self.other).post('/api/reports/', {'kind': 'event', 'object_id': self.event.pk, 'reason': 'spam'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        act = as_(mod).post(reverse('moderation-report-action', kwargs={'kind': 'event', 'pk': self.event.pk, 'decision': 'remove'}))
        self.assertEqual(act.status_code, 200, act.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.visibility, 'private')
        as_(self.mod_or(mod)).post(reverse('moderation-report-action', kwargs={'kind': 'event', 'pk': self.event.pk, 'decision': 'restore'}))
        self.event.refresh_from_db()
        self.assertEqual(self.event.visibility, 'public')

    def mod_or(self, mod):
        return mod

    def test_a_reported_proposal_can_be_withdrawn_by_a_moderator(self):
        c = Contribution.objects.get(pk=self.propose().json()['id'])
        mod = make_user('cfp-mod2', is_staff=True)
        as_(self.other).post('/api/reports/', {'kind': 'contribution', 'object_id': c.pk, 'reason': 'abuse'}, format='json')
        act = as_(mod).post(reverse('moderation-report-action', kwargs={'kind': 'contribution', 'pk': c.pk, 'decision': 'remove'}))
        self.assertEqual(act.status_code, 200, act.content)
        c.refresh_from_db()
        self.assertEqual(c.status, 'withdrawn')
