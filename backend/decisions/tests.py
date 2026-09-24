"""Tests for `decisions` — refusals first (MANAGEMENT-BRIEF.md §3, §4 rule 14)."""

from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APITestCase, APIClient

from config.test_nodes import _course
from courses.models import Course, Enrollment
from testing.factories import make_user
from . import rules
from .models import Ballot, Poll, PollOption, Vote


def _course_content_type():
    return ContentType.objects.get_for_model(Course)


class DecisionRulesTests(TestCase):
    """Test the rules module directly."""

    def setUp(self):
        self.user = make_user('voter@test.example')
        self.manager = make_user('manager@test.example')
        # `_course` (config/test_nodes.py) makes the instructor's own staff row and defaults to
        # `visibility='public'` — a stranger's course-node authority checks then hinge on
        # membership/eligibility, not on the course being invisible in the first place.
        self.course = _course(self.manager, title='Test Course')
        self.content_type = _course_content_type()

    def _enroll(self, user, status='active'):
        Enrollment.objects.create(course=self.course, participant=user, status=status)

    def test_vote_block_reason_poll_closed(self):
        """Closed poll refuses votes."""
        poll = Poll.objects.create(
            content_type=self.content_type,
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
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='staff',
        )
        PollOption.objects.create(poll=poll, text='Yes', order=1)

        # The user is enrolled (a member) but this poll is staff-only.
        self._enroll(self.user)

        reason = rules.vote_block_reason(self.user, poll, [1])
        self.assertEqual(reason, rules.NOT_ELIGIBLE)

    def test_vote_block_reason_already_voted(self):
        """User who already voted cannot vote again."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        self._enroll(self.user)

        # User votes
        ballot = Ballot.objects.create(poll=poll, user=self.user)
        Vote.objects.create(poll=poll, option=opt, ballot=ballot)

        reason = rules.vote_block_reason(self.user, poll, [opt.id])
        self.assertEqual(reason, rules.ALREADY_VOTED)

    def test_vote_block_reason_too_many_choices(self):
        """Single-mode poll refuses multiple votes."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            mode='single',
            eligibility='members',
        )
        opt1 = PollOption.objects.create(poll=poll, text='Yes', order=1)
        opt2 = PollOption.objects.create(poll=poll, text='No', order=2)
        self._enroll(self.user)

        reason = rules.vote_block_reason(self.user, poll, [opt1.id, opt2.id])
        self.assertEqual(reason, rules.TOO_MANY_CHOICES)

    def test_vote_block_reason_unknown_option(self):
        """Unknown option ID is rejected."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        self._enroll(self.user)

        reason = rules.vote_block_reason(self.user, poll, [999])
        self.assertEqual(reason, rules.UNKNOWN_OPTION)

    def test_open_block_reason_no_options(self):
        """Cannot open poll with fewer than 2 options."""
        poll = Poll.objects.create(
            content_type=self.content_type,
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
            content_type=self.content_type,
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
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='closed',
            eligibility='members',
        )

        reason = rules.close_block_reason(poll)
        self.assertEqual(reason, rules.ALREADY_CLOSED)

    def test_poll_node_resolves_through_content_type(self):
        """`rules.poll_node` maps a poll's ContentType back to the actual course row — the bug this
        suite was built to pin down: `content_type.app_label` is 'courses' (plural), not the
        `resolve_node` kind 'course'."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        node = rules.poll_node(poll)
        self.assertEqual(node.pk, self.course.pk)

    def test_is_eligible_staff_vs_members(self):
        """The manager (course staff) is eligible under 'staff'; a plain enrollee is not, but is
        eligible under 'members'."""
        staff_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='open',
            eligibility='staff',
        )
        members_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='open',
            eligibility='members',
        )
        self._enroll(self.user)

        self.assertTrue(rules.is_eligible(self.manager, staff_poll))
        self.assertFalse(rules.is_eligible(self.user, staff_poll))
        self.assertTrue(rules.is_eligible(self.user, members_poll))

    def test_can_see_results_manager_always_others_only_when_closed(self):
        open_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='open',
            eligibility='members',
        )
        closed_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='closed',
            eligibility='members',
        )
        self._enroll(self.user)

        self.assertTrue(rules.can_see_results(self.manager, open_poll))
        self.assertFalse(rules.can_see_results(self.user, open_poll))
        self.assertTrue(rules.can_see_results(self.user, closed_poll))

    def test_eligible_count_recounts_staff_and_members(self):
        """`eligible_count` is a real recount of the roster, not a placeholder (house rule 5)."""
        other = make_user('other@test.example')
        self._enroll(self.user)
        self._enroll(other, status='pending')  # not active — does not count

        staff_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='open',
            eligibility='staff',
        )
        members_poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Q', status='open',
            eligibility='members',
        )
        # Staff-only: just the manager (course owner staff row).
        self.assertEqual(rules.eligible_count(staff_poll, self.course), 1)
        # Members: the manager (staff) plus the one active enrollee.
        self.assertEqual(rules.eligible_count(members_poll, self.course), 2)


class PollAPITests(APITestCase):
    """Test poll endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.voter = make_user('voter@test.example')
        self.manager = make_user('manager@test.example')
        self.course = _course(self.manager, title='Test Course')
        self.content_type = _course_content_type()

    def _enroll(self, user, status='active'):
        Enrollment.objects.create(course=self.course, participant=user, status=status)

    def test_create_poll_requires_manager(self):
        """Non-managers cannot create polls — the course is public so the voter can see it and
        gets a real 403, not a 404 for a node they cannot even view."""
        self.client.force_authenticate(self.voter)
        response = self.client.post(
            f'/api/nodes/course/{self.course.id}/polls/',
            {'question': 'Test?', 'mode': 'single'},
        )
        self.assertEqual(response.status_code, 403)

    def test_create_poll_stranger_on_private_course_gets_404(self):
        """A course a stranger cannot see at all 404s rather than 403 (house rule 4)."""
        private_course = _course(self.manager, title='Private course', visibility='only_you')
        self.client.force_authenticate(self.voter)
        response = self.client.post(
            f'/api/nodes/course/{private_course.id}/polls/',
            {'question': 'Test?', 'mode': 'single'},
        )
        self.assertEqual(response.status_code, 404)

    def test_create_poll_success(self):
        """Manager can create a poll."""
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.id}/polls/',
            {'question': 'Test?', 'mode': 'single', 'eligibility': 'members'},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['status'], 'draft')

    def test_open_requires_two_options(self):
        """Opening a poll with fewer than two options is a 409 no_options."""
        poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id, question='Test?',
            status='draft', eligibility='members',
        )
        PollOption.objects.create(poll=poll, text='Only one', order=1)

        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/polls/{poll.id}/open/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'no_options')

    def test_vote_success(self):
        """User can vote in an open poll."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            mode='single',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)

        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.post(
            f'/api/polls/{poll.id}/vote/',
            {'options': [opt.id]},
        )
        self.assertEqual(response.status_code, 201)

        # Check ballot was created, and carries the voter (not anonymous)
        ballot = Ballot.objects.filter(poll=poll, user=self.voter).first()
        self.assertIsNotNone(ballot)
        vote = Vote.objects.get(poll=poll, option=opt)
        self.assertEqual(vote.ballot_id, ballot.id)

        # A second vote is refused — the world moved.
        response = self.client.post(f'/api/polls/{poll.id}/vote/', {'options': [opt.id]})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'already_voted')

    def test_anonymous_poll_vote_has_no_ballot_link(self):
        """An anonymous poll's Vote rows carry `ballot=NULL` — nobody can trace a choice back to a
        person (house rule 9), even though the Ballot row (who took part) still exists."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            mode='single',
            eligibility='members',
            anonymous=True,
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.post(f'/api/polls/{poll.id}/vote/', {'options': [opt.id]})
        self.assertEqual(response.status_code, 201)

        self.assertTrue(Ballot.objects.filter(poll=poll, user=self.voter).exists())
        vote = Vote.objects.get(poll=poll, option=opt)
        self.assertIsNone(vote.ballot_id)

    def test_results_hidden_until_closed_for_non_manager(self):
        """A non-manager cannot see results while the poll is still open (§3.E: "results hidden
        until closed for non-managers"), but the manager always can."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        PollOption.objects.create(poll=poll, text='Yes', order=1)
        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.get(f'/api/polls/{poll.id}/results/')
        self.assertEqual(response.status_code, 403)

        self.client.force_authenticate(self.manager)
        response = self.client.get(f'/api/polls/{poll.id}/results/')
        self.assertEqual(response.status_code, 200)

    def test_results_visible_when_closed(self):
        """Results are visible to anyone eligible once the poll is closed."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='closed',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        ballot = Ballot.objects.create(poll=poll, user=self.voter)
        Vote.objects.create(poll=poll, option=opt, ballot=ballot)
        # "Anyone eligible" is what this test is about, so the voter has to actually BE eligible —
        # `_enroll` was missing here and the test passed anyway until §17BI.H made `visible_polls`
        # check membership rather than only the word `members`.
        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.get(f'/api/polls/{poll.id}/results/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['options'][0]['count'], 1)
        # A non-manager's results carry no ballot list — only the manager sees who voted.
        self.assertEqual(response.data['ballots'], [])

    def test_poll_serializer_does_not_leak_vote_counts_before_close(self):
        """The plain poll representation (list/detail) never embeds a live tally — only
        `/results/`, gated by `can_see_results`, does (house rule 4)."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        ballot = Ballot.objects.create(poll=poll, user=self.voter)
        Vote.objects.create(poll=poll, option=opt, ballot=ballot)
        # Enrolled, because this test is about what the SERIALIZER carries to somebody who may read
        # the poll at all — see `test_results_visible_when_closed` for the same missing line.
        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        response = self.client.get(f'/api/polls/{poll.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('count', response.data['options'][0])

    def test_has_voted_reflects_the_requesting_user_only(self):
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        opt = PollOption.objects.create(poll=poll, text='Yes', order=1)
        self._enroll(self.voter)

        self.client.force_authenticate(self.voter)
        self.assertFalse(self.client.get(f'/api/polls/{poll.id}/').data['has_voted'])
        self.client.post(f'/api/polls/{poll.id}/vote/', {'options': [opt.id]})
        self.assertTrue(self.client.get(f'/api/polls/{poll.id}/').data['has_voted'])

        self.client.force_authenticate(self.manager)
        self.assertFalse(self.client.get(f'/api/polls/{poll.id}/').data['has_voted'])

    def test_patch_and_delete_blocked_once_not_draft(self):
        """PATCH/DELETE on a non-draft poll is 409 not_draft (house rule 6: a word, not a bare
        403/400)."""
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        self.client.force_authenticate(self.manager)
        response = self.client.patch(f'/api/polls/{poll.id}/', {'question': 'Changed?'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'not_draft')

        response = self.client.delete(f'/api/polls/{poll.id}/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'not_draft')

    def test_close_records_decision_note(self):
        poll = Poll.objects.create(
            content_type=self.content_type,
            object_id=self.course.id,
            question='Test?',
            status='open',
            eligibility='members',
        )
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/polls/{poll.id}/close/', {'decision_note': "We're going with Tuesday."}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'closed')
        self.assertEqual(response.data['decision_note'], "We're going with Tuesday.")
        self.assertEqual(response.data['closed_by_id'], self.manager.id)


class VisibilityRegressionTests(APITestCase):
    """The three things `events/test_permission_matrix.py` found when the management rows landed
    (§17BI.H). Each of these was a real answer this app gave, not an expectation that was wrong.

    They live together because they are one question asked three ways: *who is this poll for*. A
    poll's question is as much of a decision as its count — "shall we drop Tomek from the rota?"
    is not a thing a public course page may say to a passer-by — so the eligibility rule has to be
    a rule about people, not about the word `members`.
    """

    def setUp(self):
        self.manager = make_user('vis-manager@test.example')
        self.member = make_user('vis-member@test.example')
        self.stranger = make_user('vis-stranger@test.example')
        self.course = _course(self.manager, title='A public course')
        self.content_type = _course_content_type()
        Enrollment.objects.create(course=self.course, participant=self.member, status='active')
        self.poll = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id,
            question='Shall we move the deadline?', status='open', eligibility='members',
            created_by=self.manager,
        )
        self.option = PollOption.objects.create(poll=self.poll, text='Yes', order=0)
        PollOption.objects.create(poll=self.poll, text='No', order=1)

    def _list(self):
        return self.client.get(f'/api/nodes/course/{self.course.id}/polls/')

    def test_a_stranger_on_a_public_course_is_shown_no_members_poll(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._list().data, [])
        self.assertEqual(self.client.get(f'/api/polls/{self.poll.id}/').status_code, 404)

    def test_an_anonymous_reader_is_shown_none_either(self):
        self.assertEqual(self._list().data, [])
        self.assertEqual(self.client.get(f'/api/polls/{self.poll.id}/').status_code, 404)

    def test_the_room_it_was_put_to_sees_it(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(len(self._list().data), 1)
        self.assertEqual(self.client.get(f'/api/polls/{self.poll.id}/').status_code, 200)

    def test_a_closed_polls_results_are_not_public_either(self):
        """`/results/` carries the option texts AND the tally, so it needs the same gate the
        detail route has — it used to ask only whether the NODE was visible."""
        self.poll.status = 'closed'
        self.poll.save(update_fields=['status'])
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(f'/api/polls/{self.poll.id}/results/').status_code, 404)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(f'/api/polls/{self.poll.id}/results/').status_code, 200)

    def test_an_option_with_no_order_appends_rather_than_colliding(self):
        """`(poll, order)` is unique and the model default is 0, so `POST {"text": …}` — which is
        the whole of what §3.E's API line promises — raised IntegrityError on the second option."""
        draft = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id,
            question='Which day?', status='draft', eligibility='members', created_by=self.manager,
        )
        self.client.force_authenticate(self.manager)
        first = self.client.post(f'/api/polls/{draft.id}/options/', {'text': 'Saturday'})
        second = self.client.post(f'/api/polls/{draft.id}/options/', {'text': 'Sunday'})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(
            list(draft.options.order_by('order').values_list('text', 'order')),
            [('Saturday', 0), ('Sunday', 1)],
        )

    def test_a_caller_that_names_an_order_still_gets_it(self):
        draft = Poll.objects.create(
            content_type=self.content_type, object_id=self.course.id,
            question='Which day?', status='draft', eligibility='members', created_by=self.manager,
        )
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/polls/{draft.id}/options/', {'text': 'Sunday', 'order': 5})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(draft.options.get().order, 5)
