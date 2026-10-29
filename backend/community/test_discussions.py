"""Discussions under the standing pages (`community/discussions.py`).

What is pinned here is the part of the feature that is a RULE rather than a screen: who may write
where, what the page-level row does to the sections under it, that an anonymous comment is held
whatever the location says, and that a held comment is invisible to everybody but its author and
staff. Each of those is a sentence somebody will be tempted to simplify later, and each is argued
in the module's docstring.

`is_feature_enabled` fails OPEN on a missing row (`moderation/services.py`), and migration 0048
seeds `about_discussions` on — so the tests that need it off set the row explicitly rather than
relying on absence.
"""

from io import StringIO

from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.minors import HOLD_REASON, hold_for_review
from community.models import Comment, DiscussionLocation
from community import discussions
from moderation.models import FeatureFlag, Report
from moderation.services import build_report_queue
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

PAGE = 'about/guide/courses'
SECTION = 'enrolling'


def _flag(enabled):
    FeatureFlag.objects.update_or_create(
        key=discussions.FEATURE_KEY, defaults={'is_enabled': enabled}
    )


class KeyParsingTests(APITestCase):
    def test_a_key_round_trips_through_both_halves(self):
        for page, section in [('about', ''), ('about/flashcards', 'why'), (PAGE, SECTION)]:
            key = discussions.location_key(page, section)
            self.assertEqual(discussions.parse_key(key), (page, section))

    def test_it_refuses_a_page_outside_about(self):
        """The whole reason the allowlist is a pattern: `about/...` and nothing else, so a
        well-formed junk key is the worst anybody can produce (module docstring)."""
        for bad in ['courses', 'about/a/b/c', 'About', 'about/../etc', 'about/A', '']:
            with self.subTest(page=bad):
                with self.assertRaises(ValueError):
                    discussions.parse_key(bad)

    def test_it_refuses_a_malformed_section(self):
        with self.assertRaises(ValueError):
            discussions.parse_key('about#Not A Section')


class EffectivePolicyTests(APITestCase):
    """`effective_policy` — the page row is a CEILING over its sections, and where the two
    disagree the narrower wins."""

    def setUp(self):
        _flag(True)

    def test_a_location_with_no_row_gets_the_module_defaults(self):
        policy = discussions.effective_policy(PAGE, SECTION)
        self.assertEqual(policy['audience'], discussions.DEFAULT_AUDIENCE)
        self.assertFalse(policy['moderated'])
        self.assertTrue(policy['is_enabled'])

    def test_the_page_row_narrows_every_section_on_it(self):
        DiscussionLocation.objects.create(page=PAGE, section='', audience='staff')
        self.assertEqual(discussions.effective_policy(PAGE, SECTION)['audience'], 'staff')

    def test_a_section_row_cannot_widen_past_its_page(self):
        """The direction that matters: a moderator closing a chapter down to staff must not be
        undone by a section somebody had already set to `anyone`."""
        DiscussionLocation.objects.create(page=PAGE, section='', audience='staff')
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, audience='anyone')
        self.assertEqual(discussions.effective_policy(PAGE, SECTION)['audience'], 'staff')

    def test_a_section_may_be_narrower_than_its_page(self):
        DiscussionLocation.objects.create(page=PAGE, section='', audience='anyone')
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, audience='verified')
        self.assertEqual(discussions.effective_policy(PAGE, SECTION)['audience'], 'verified')

    def test_switching_the_page_off_switches_its_sections_off(self):
        DiscussionLocation.objects.create(page=PAGE, section='', is_enabled=False)
        self.assertFalse(discussions.effective_policy(PAGE, SECTION)['is_enabled'])

    def test_moderated_is_an_or_across_the_two_rows(self):
        DiscussionLocation.objects.create(page=PAGE, section='', moderated=True)
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, moderated=False)
        self.assertTrue(discussions.effective_policy(PAGE, SECTION)['moderated'])

    def test_the_flag_sits_above_every_row(self):
        _flag(False)
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, is_enabled=True)
        self.assertFalse(discussions.effective_policy(PAGE, SECTION)['is_enabled'])

    def test_an_unknown_audience_value_fails_closed(self):
        """A row written by a newer deploy, or by hand in the admin. Treated as the narrowest thing
        it could mean rather than ignored."""
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, audience='everyone-ever')
        self.assertEqual(discussions.effective_policy(PAGE, SECTION)['audience'], 'staff')


class PostBlockReasonTests(APITestCase):
    """Every refusal is a word, and each word is a different sentence to a reader (house rule 6)."""

    def setUp(self):
        _flag(True)
        self.plain = make_user('disc-plain')
        self.verified = make_user('disc-verified', is_verified_contributor=True)
        self.staff = make_user('disc-staff', is_staff=True)

    def _reason(self, user, **row):
        if row:
            DiscussionLocation.objects.update_or_create(
                page=PAGE, section=SECTION, defaults=row
            )
        policy = discussions.effective_policy(PAGE, SECTION)
        return discussions.post_block_reason(user, policy)

    def test_off_when_the_location_is_switched_off(self):
        self.assertEqual(self._reason(self.plain, is_enabled=False), 'off')

    def test_off_beats_even_staff(self):
        """A moderator bypasses the AUDIENCE, not the switch: a closed location is closed, or
        `is_enabled` would mean nothing to the person using it."""
        self.assertEqual(self._reason(self.staff, is_enabled=False), 'off')

    def test_anonymous_where_an_account_is_wanted(self):
        self.assertEqual(self._reason(None, audience='users'), 'anonymous')

    def test_anonymous_may_write_where_the_audience_is_anyone(self):
        self.assertIsNone(self._reason(None, audience='anyone'))

    def test_verification_required(self):
        self.assertEqual(self._reason(self.plain, audience='verified'), 'verification_required')
        self.assertIsNone(self._reason(self.verified, audience='verified'))

    def test_staff_only(self):
        self.assertEqual(self._reason(self.plain, audience='staff'), 'staff_only')
        self.assertIsNone(self._reason(self.staff, audience='staff'))

    def test_staff_pass_every_audience(self):
        for audience in ['anyone', 'users', 'verified', 'staff']:
            with self.subTest(audience=audience):
                self.assertIsNone(self._reason(self.staff, audience=audience))

    def test_a_minor_may_not_write_where_strangers_can_read_and_reply(self):
        """The one rule here no moderator can lift (`accounts/minors.py`, GDPR Art. 8), and it
        applies ONLY to `anyone` — a minor takes part in a discussion among accounts, as they
        already do in every other thread on this site."""
        minor = make_user('disc-minor')
        minor.profile.is_minor = True
        minor.profile.save()
        self.assertEqual(self._reason(minor, audience='anyone'), 'minor')
        self.assertIsNone(self._reason(minor, audience='users'))


class HeldForTests(APITestCase):
    def setUp(self):
        _flag(True)
        self.plain = make_user('held-plain')
        self.staff = make_user('held-staff', is_staff=True)

    def _policy(self, **row):
        DiscussionLocation.objects.update_or_create(page=PAGE, section=SECTION, defaults=row)
        return discussions.effective_policy(PAGE, SECTION)

    def test_anonymous_is_always_held_even_on_an_unmoderated_location(self):
        self.assertTrue(discussions.held_for(None, self._policy(audience='anyone', moderated=False)))

    def test_a_signed_in_writer_is_held_only_where_the_location_says_so(self):
        self.assertFalse(discussions.held_for(self.plain, self._policy(moderated=False)))
        self.assertTrue(discussions.held_for(self.plain, self._policy(moderated=True)))

    def test_staff_are_never_held(self):
        """The person who would approve it is the person writing it."""
        self.assertFalse(discussions.held_for(self.staff, self._policy(moderated=True)))


class DiscussionEndpointTests(APITestCase):
    # The request-logging middleware writes to its own shards; a view test that does not declare
    # them fails on Django's cross-database guard rather than on anything under test.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        _flag(True)
        self.plain = make_user('ep-plain')
        self.staff = make_user('ep-staff', is_staff=True)
        self.policies_url = reverse('discussion-policies')
        self.thread_url = reverse('discussion-thread')

    def _post(self, body='Hello', **extra):
        payload = {'page': PAGE, 'section': SECTION, 'body': body}
        payload.update(extra)
        return self.client.post(self.thread_url, payload, format='json')

    def _set(self, **row):
        DiscussionLocation.objects.update_or_create(page=PAGE, section=SECTION, defaults=row)

    def test_the_policies_endpoint_answers_one_row_per_section_plus_the_page(self):
        response = self.client.get(
            self.policies_url, {'page': PAGE, 'sections': 'enrolling,certificates'}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        sections = [row['section'] for row in response.data['locations']]
        self.assertEqual(sections, ['', 'enrolling', 'certificates'])

    def test_the_policies_endpoint_still_answers_with_the_flag_off(self):
        """House rule 3 from the other side: the frontend has to be able to learn that there is no
        discussion here, so that it draws nothing rather than a button that fails on click."""
        _flag(False)
        response = self.client.get(self.policies_url, {'page': PAGE, 'sections': SECTION})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(all(not row['is_enabled'] for row in response.data['locations']))

    def test_a_page_outside_about_is_a_400_not_a_500(self):
        response = self.client.get(self.policies_url, {'page': 'courses'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reading_a_location_with_no_row_creates_nothing(self):
        """A crawler walking the manual must not populate the moderation list."""
        self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(DiscussionLocation.objects.count(), 0)

    def test_a_signed_in_comment_appears_at_once(self):
        self.client.force_authenticate(self.plain)
        response = self._post('A real question')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['is_held'])

        self.client.force_authenticate(None)
        thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(len(thread.data['comments']), 1)
        self.assertEqual(thread.data['comments'][0]['body'], 'A real question')

    def test_an_anonymous_comment_is_accepted_held_and_invisible(self):
        self._set(audience='anyone')
        response = self._post('From a visitor', anon_name='Kasia')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['is_held'])

        comment = Comment.objects.get()
        self.assertIsNone(comment.author)
        self.assertEqual(comment.anon_name, 'Kasia')
        self.assertTrue(comment.anon_ip_hash)
        self.assertIsNotNone(comment.auto_hidden_at)

        thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(thread.data['comments'], [])

    def test_an_anonymous_comment_reaches_the_existing_moderation_queue(self):
        """The whole reason this feature needed no second queue: `hold_for_review` files a report,
        and the queue already knows how to show, restore and remove anything with one."""
        self._set(audience='anyone')
        self._post('From a visitor')
        comment = Comment.objects.get()
        report = Report.objects.get(
            content_type=ContentType.objects.get_for_model(Comment), object_id=comment.pk
        )
        self.assertEqual(report.reason, HOLD_REASON)
        self.assertIsNone(report.reported_by)

    def test_staff_see_a_held_comment_and_a_stranger_does_not(self):
        self._set(audience='anyone')
        self._post('From a visitor')

        self.client.force_authenticate(self.staff)
        staff_thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(len(staff_thread.data['comments']), 1)

        self.client.force_authenticate(self.plain)
        other_thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(other_thread.data['comments'], [])

    def test_an_author_sees_their_own_held_comment(self):
        self._set(moderated=True)
        self.client.force_authenticate(self.plain)
        self._post('Waiting for a moderator')
        thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(len(thread.data['comments']), 1)

    def test_a_refusal_carries_its_word(self):
        self._set(audience='verified')
        self.client.force_authenticate(self.plain)
        response = self._post()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'verification_required')

    def test_a_reply_inside_the_same_thread_is_fine(self):
        self.client.force_authenticate(self.plain)
        self._post('First')
        parent = Comment.objects.get()
        response = self._post('Reply', parent=parent.pk)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_a_thread_is_readable_even_where_only_staff_may_write(self):
        """The audience governs writing. The prose is public and so is the talk about it."""
        self._set(audience='staff')
        self.client.force_authenticate(self.staff)
        self._post('A note from a moderator')
        self.client.force_authenticate(None)
        thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(len(thread.data['comments']), 1)
        self.assertEqual(thread.data['post_block_reason'], 'staff_only')

    def test_the_body_is_sanitized_on_write(self):
        self.client.force_authenticate(self.plain)
        self._post('<img src=x onerror=alert(1)>Fine text')
        self.assertNotIn('onerror', Comment.objects.get().body)

    # --- a row is created by a write that SUCCEEDS (`discussions.py`'s own heading) -------------

    def test_a_refused_write_creates_no_location_row(self):
        """A 403 must leave nothing behind, or anybody who is not even allowed to write here can
        manufacture a row in the moderator's list by trying.

        The page's own row carries the refusal (it is the ceiling over every section on it), so
        the SECTION is the one that must still not exist afterwards."""
        DiscussionLocation.objects.create(page=PAGE, section='', audience='staff')
        self.client.force_authenticate(self.plain)
        response = self._post()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(DiscussionLocation.objects.filter(page=PAGE, section=SECTION).count(), 0)

    def test_a_refused_write_at_a_location_with_no_row_creates_none(self):
        _flag(False)
        self.client.force_authenticate(self.plain)
        response = self._post()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(DiscussionLocation.objects.count(), 0)

    def test_a_reply_into_another_thread_creates_no_row_for_the_section_it_named(self):
        """The check `community/CLAUDE.md` says every new comment surface must repeat, and the
        regression it exists for: the row used to be created one line above the
        parent check, so a refused reply left a location nobody had written at."""
        self.client.force_authenticate(self.plain)
        self._post('First')
        parent = Comment.objects.get()
        response = self.client.post(
            self.thread_url,
            {'page': PAGE, 'section': 'a-different-section', 'body': 'Reply', 'parent': parent.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            DiscussionLocation.objects.filter(page=PAGE, section='a-different-section').count(), 0
        )

    def test_a_malformed_body_creates_no_row(self):
        self.client.force_authenticate(self.plain)
        response = self._post('   ')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(DiscussionLocation.objects.count(), 0)

    def test_a_held_write_does_create_its_row(self):
        """The other half of the same rule, so nobody "fixes" it into refusing to create one: a
        held comment is stored, and a stored comment needs the row it hangs off."""
        self._set(moderated=True)
        self.client.force_authenticate(self.plain)
        self.assertEqual(self._post('Held').status_code, status.HTTP_201_CREATED)
        self.assertEqual(DiscussionLocation.objects.filter(page=PAGE, section=SECTION).count(), 1)

    # --- what "N comments" counts (`discussions.py`) ---------------------------------------------

    def test_the_count_excludes_a_tombstone_and_a_held_comment(self):
        """The number the collapsed line prints. A tombstone is a placeholder, not a comment, and
        a held comment has never been public — so deleting what it wrote brings the count back to
        exactly where it was, which is what lets `e2e/about-discussions.mjs` assert `===`."""
        self.client.force_authenticate(self.plain)
        self._post('Public')
        self._post('Will be deleted')
        self._post('Will be held')

        doomed = Comment.objects.get(body='Will be deleted')
        doomed.is_removed = True
        doomed.removed_by_author = True
        doomed.save(update_fields=['is_removed', 'removed_by_author'])
        hold_for_review(Comment.objects.get(body='Will be held'), None)

        self.client.force_authenticate(None)
        policies = self.client.get(self.policies_url, {'page': PAGE, 'sections': SECTION})
        row = [r for r in policies.data['locations'] if r['section'] == SECTION][0]
        self.assertEqual(row['comment_count'], 1)

        # And the thread still CARRIES the tombstone, which is why the component cannot simply
        # take `comments.length` (house rule 12 keeps the thread's shape).
        thread = self.client.get(self.thread_url, {'page': PAGE, 'section': SECTION})
        self.assertEqual(len(thread.data['comments']), 2)
        self.assertEqual(
            sum(
                1
                for c in thread.data['comments']
                if not c['is_removed'] and not c['is_auto_hidden']
            ),
            1,
        )


class DiscussionLocationAdminTests(APITestCase):
    # The request-logging middleware writes to its own shards; a view test that does not declare
    # them fails on Django's cross-database guard rather than on anything under test.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        _flag(True)
        self.plain = make_user('loc-plain')
        self.staff = make_user('loc-staff', is_staff=True)
        self.list_url = reverse('discussion-location-list')

    def test_the_list_is_staff_only(self):
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_401_UNAUTHORIZED)
        self.client.force_authenticate(self.plain)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_200_OK)

    def test_staff_can_create_and_narrow_a_location(self):
        self.client.force_authenticate(self.staff)
        created = self.client.post(
            self.list_url,
            {'page': PAGE, 'section': SECTION, 'audience': 'verified'},
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data['key'], f'{PAGE}#{SECTION}')
        row = DiscussionLocation.objects.get()
        self.assertEqual(row.updated_by, self.staff)

        patched = self.client.patch(
            reverse('discussion-location-detail', args=[row.pk]),
            {'is_enabled': False},
            format='json',
        )
        self.assertEqual(patched.status_code, status.HTTP_200_OK)
        self.assertFalse(patched.data['is_enabled'])

    def test_a_page_level_row_is_created_with_an_empty_section(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(self.list_url, {'page': PAGE, 'audience': 'staff'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['key'], PAGE)
        self.assertEqual(response.data['section'], '')

    def test_it_refuses_a_junk_page_and_an_unknown_audience(self):
        self.client.force_authenticate(self.staff)
        bad_page = self.client.post(self.list_url, {'page': 'courses'}, format='json')
        self.assertEqual(bad_page.status_code, status.HTTP_400_BAD_REQUEST)
        bad_audience = self.client.post(
            self.list_url, {'page': PAGE, 'audience': 'friends'}, format='json'
        )
        self.assertEqual(bad_audience.status_code, status.HTTP_400_BAD_REQUEST)

    def test_there_is_no_delete(self):
        """Closing a location is `is_enabled=false`; deleting the row would return it to the
        module defaults while its comments stayed attached to a row that no longer exists."""
        self.client.force_authenticate(self.staff)
        row = DiscussionLocation.objects.create(page=PAGE, section=SECTION)
        response = self.client.delete(reverse('discussion-location-detail', args=[row.pk]))
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_the_counts_separate_what_is_public_from_what_is_waiting(self):
        self.client.force_authenticate(self.staff)
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, audience='anyone')
        self.client.force_authenticate(None)
        self.client.post(
            reverse('discussion-thread'),
            {'page': PAGE, 'section': SECTION, 'body': 'held'},
            format='json',
        )
        self.client.force_authenticate(self.staff)
        self.client.post(
            reverse('discussion-thread'),
            {'page': PAGE, 'section': SECTION, 'body': 'public'},
            format='json',
        )
        row = self.client.get(self.list_url).data[0]
        self.assertEqual(row['comment_count'], 1)
        self.assertEqual(row['held_count'], 1)


class DiscussionReportRowTests(APITestCase):
    """The one additive field `moderation/services.py` carries for this app.

    It lives here rather than in `moderation/tests.py` because the rule it pins is this app's:
    `community.discussions.report_location_key` decides what a key looks like, and the queue only
    prints what that function returns (house rule 13 — mirrored, said in both files). What the
    field buys is the link in `DiscussionLocationsPanel.svelte`: `/moderation?tab=reports&
    location=<key>` filters the Reports tab to one standing page's held comments.
    """

    # The request-logging middleware writes to its own shards; a view test that does not declare
    # them fails on Django's cross-database guard rather than on anything under test.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        _flag(True)
        self.thread_url = reverse('discussion-thread')

    def _row_for(self, comment):
        content_type = ContentType.objects.get_for_model(Comment)
        for row in build_report_queue():
            if row['kind'] == 'comment' and row['object_id'] == comment.pk:
                return row
        self.fail(f'no queue row for comment {comment.pk} (ct {content_type.pk})')

    def test_a_held_standing_page_comment_carries_its_location(self):
        DiscussionLocation.objects.create(page=PAGE, section=SECTION, audience='anyone')
        response = self.client.post(
            self.thread_url, {'page': PAGE, 'section': SECTION, 'body': 'From a visitor'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        comment = Comment.objects.get()
        self.assertEqual(self._row_for(comment)['discussion_location'], f'{PAGE}#{SECTION}')

    def test_a_page_level_location_has_no_hash_in_its_key(self):
        DiscussionLocation.objects.create(page='about', section='', audience='anyone')
        self.client.post(
            self.thread_url, {'page': 'about', 'body': 'From a visitor'}, format='json'
        )
        comment = Comment.objects.get()
        self.assertEqual(self._row_for(comment)['discussion_location'], 'about')

    def test_a_comment_anywhere_else_carries_null(self):
        """`None`, not a missing key: the frontend reads the field on every report row, and a
        report on a comment under an exercise is by far the common case."""
        branch = make_branch()
        exercise = make_exercise(branch, 1)
        author = make_user('rr-author')
        comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(type(exercise)),
            object_id=exercise.pk,
            author=author,
            body='An ordinary comment',
        )
        hold_for_review(comment, author)
        self.assertIsNone(self._row_for(comment)['discussion_location'])


class SweepDiscussionLocationsTests(APITestCase):
    """`manage.py sweep_discussion_locations` — the junk-key bullet of `todo.md`.

    Three conditions have to hold together before a row is a candidate, and three of these four
    tests are one condition each failing. That is the whole argument that this is not a hole in
    house rule 12: every row somebody decided something about is kept.
    """

    def _sweep(self, *args):
        out = StringIO()
        call_command('sweep_discussion_locations', *args, stdout=out)
        return out.getvalue()

    def test_dry_run_lists_a_junk_row_and_removes_nothing(self):
        DiscussionLocation.objects.create(page='about/nonsense', section='whatever')
        output = self._sweep('--dry-run')
        self.assertIn('about/nonsense#whatever', output)
        self.assertIn('1 candidate', output)
        self.assertEqual(DiscussionLocation.objects.count(), 1)

    def test_without_the_flag_it_removes_them(self):
        DiscussionLocation.objects.create(page='about/nonsense', section='whatever')
        DiscussionLocation.objects.create(page='about/other', section='')
        self._sweep()
        self.assertEqual(DiscussionLocation.objects.count(), 0)

    def test_a_row_with_a_comment_is_never_a_candidate(self):
        """Any comment at all, including a tombstone: a tombstone is the record that something was
        said here and removed, and the row under it is what that record hangs off."""
        row = DiscussionLocation.objects.create(page='about/nonsense', section='whatever')
        Comment.objects.create(
            content_type=ContentType.objects.get_for_model(DiscussionLocation),
            object_id=row.pk,
            author=make_user('sweep-author'),
            body='Something',
            is_removed=True,
        )
        self._sweep()
        self.assertEqual(DiscussionLocation.objects.count(), 1)

    def test_a_row_somebody_touched_or_changed_is_never_a_candidate(self):
        moderator = make_user('sweep-mod', is_staff=True)
        DiscussionLocation.objects.create(page='about/one', section='', updated_by=moderator)
        DiscussionLocation.objects.create(page='about/two', section='', audience='staff')
        DiscussionLocation.objects.create(page='about/three', section='', is_enabled=False)
        DiscussionLocation.objects.create(page='about/four', section='', moderated=True)
        output = self._sweep()
        self.assertIn('0 candidate', output)
        self.assertEqual(DiscussionLocation.objects.count(), 4)
