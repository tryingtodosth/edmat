"""Tests for `decisions` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from config.nodes import resolve_node, can_manage_node
from courses.models import Course
from testing.factories import make_user
from . import rules
from .models import Poll, PollOption, Ballot, Vote


class DecisionRulesTests(TestCase):
    """Test the rules module."""

    def setUp(self):
        self.user = make_user('voter@test.example')
        self.manager = make_user('manager@test.example')
        self.course = Course.objects.create(
            title='Test Course',
            description='A test course',
            owner=self.manager,
            audience='all',
        )

    def test_vote_block_reason_poll_closed(self):
        """Closed poll refuses votes."""
        poll = Poll.objects.create(
            content_type_id=25,  # courses.Course content type
            object_id=self.course.id,
            question='Test?',
            status='closed',
            eligibility='members',
        )
        reason = rules.vote_block_reason(self.user, poll, [1])
        self.assertEqual(reason, rules.NOT_OPEN)

    def test_vote_block_reason_not_eligible(self):
        """Non-eligible user cannot vote."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='staff',
        )
        PollOption.objects.create(poll=poll, text='Yes', order=1)

        reason = rules.vote_block_reason(self.user, poll, [1])
        self.assertEqual(reason, rules.NOT_ELIGIBLE)

    def test_vote_block_reason_already_voted(self):
        """User who already voted cannot vote again."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)

        # User votes
        ballot = Ballot.objects.create(poll=poll, user=self.user)
        Vote.objects.create(poll=poll, option=opt, ballot=ballot)

        reason = rules.vote_block_reason(self.user, poll, [opt.id])
        self.assertEqual(reason, rules.ALREADY_VOTED)

    def test_vote_block_reason_too_many_choices(self):
        """Single-mode poll refuses multiple votes."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            mode='single',
            eligibility='members',
        )
        opt1 = PollOption.objects.create(poll=poll, text='Yes', order=1)
        opt2 = PollOption.objects.create(poll=poll, text='No', order=2)

        reason = rules.vote_block_reason(self.user, poll, [opt1.id, opt2.id])
        self.assertEqual(reason, rules.TOO_MANY_CHOICES)

    def test_vote_block_reason_unknown_option(self):
        """Unknown option ID is rejected."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )

        reason = rules.vote_block_reason(self.user, poll, [999])
        self.assertEqual(reason, rules.UNKNOWN_OPTION)

    def test_open_block_reason_no_options(self):
        """Cannot open poll with fewer than 2 options."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='draft',
            eligibility='members',
        )

        reason = rules.open_block_reason(poll)
        self.assertEqual(reason, rules.NO_OPTIONS)

    def test_open_block_reason_already_open(self):
        """Cannot open an already-open poll."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        PollOption.objects.create(poll=poll, text='Yes', order=1)
        PollOption.objects.create(poll=poll, text='No', order=2)

        reason = rules.open_block_reason(poll)
        self.assertEqual(reason, rules.ALREADY_OPEN)

    def test_close_block_reason_already_closed(self):
        """Cannot close an already-closed poll."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='closed',
            eligibility='members',
        )

        reason = rules.close_block_reason(poll)
        self.assertEqual(reason, rules.ALREADY_CLOSED)


class PollAPITests(APITestCase):
    """Test poll endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.voter = make_user('voter@test.example')
        self.manager = make_user('manager@test.example')
        self.course = Course.objects.create(
            title='Test Course',
            description='A test course',
            owner=self.manager,
            audience='all',
        )
        self.course.staff.add(self.manager)

    def test_create_poll_requires_manager(self):
        """Non-managers cannot create polls."""
        self.client.force_authenticate(self.voter)
        response = self.client.post(
            f'/api/nodes/course/{self.course.id}/polls/',
            {'question': 'Test?', 'mode': 'single'},
        )
        self.assertEqual(response.status_code, 403)

    def test_create_poll_success(self):
        """Manager can create a poll."""
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.id}/polls/',
            {'question': 'Test?', 'mode': 'single', 'eligibility': 'members'},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['status'], 'draft')

    def test_vote_success(self):
        """User can vote in an open poll."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='open',
            mode='single',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)

        self.course.enrollments.create(user=self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.post(
            f'/api/polls/{poll.id}/vote/',
            {'options': [opt.id]},
        )
        self.assertEqual(response.status_code, 201)

        # Check ballot was created
        self.assertTrue(Ballot.objects.filter(poll=poll, user=self.voter).exists())

    def test_results_visible_when_closed(self):
        """Results are visible when poll is closed."""
        poll = Poll.objects.create(
            content_type_id=25,
            object_id=self.course.id,
            question='Test?',
            status='closed',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        ballot = Ballot.objects.create(poll=poll, user=self.voter)
        Vote.objects.create(poll=poll, option=opt, ballot=ballot)

        self.client.force_authenticate(self.voter)
        response = self.client.get(f'/api/polls/{poll.id}/results/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['options'][0]['count'], 1)
