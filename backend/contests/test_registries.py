"""A contest in every registry a course or an event is in — step B of the contests cycle.

`CONTESTS-BRIEF.md` §3.B lists nine: comments, reports, discussions, galleries, translations,
flashcard placements, the activity feed, the work dashboard, the learning record. Each is one line
in another app plus, where the registry has a rule module, a dispatch into `contests/access.py`.

**The shape of every test here is the one the neighbours have**, because that is what makes a
registry entry trustworthy rather than merely present:

- a **stranger gets 404** on everything hung off a DRAFT contest (house rule 4 — for them it does
  not exist), and the same thing opens once it is announced;
- the **activity row appears on announce only if the contest is public at that instant**, and is
  forgotten on cancellation (house rule 9);
- a registry that is **behind the `contests` switch** closes with it and leaves its neighbours
  working (house rule 3).

One module rather than a block in each of nine apps' `tests.py`: all nine assertions are about the
same row, the brief owns them as one deliverable, and `manage.py test contests` is what the board
entry quotes. The apps' own suites keep pinning their own rules.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.targets import PRIVATE_TARGET_TYPES, TARGET_TYPE_BY_MODEL
from contests.models import Contest, ContestStaff
from flashcards.models import PLACEABLE_NODE_KINDS, Deck
from galleries.models import GALLERY_TARGETS
from moderation.models import FeatureFlag
from moderation.services import REPORT_KIND_MODELS
from telemetry.routers import all_log_shards
from testing.factories import make_user
from translations.targets import TRANSLATABLE_KIND_MODELS


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class RegistryBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        for key in ('contests', 'about_discussions', 'flashcards', 'galleries', 'learning_record'):
            _flag(key, True)
        self.organiser = make_user('registry-organiser')
        self.stranger = make_user('registry-stranger')
        self.draft = Contest.objects.create(
            title='Konkurs w przygotowaniu', preset_key='challenge', organiser=self.organiser
        )
        self.live = Contest.objects.create(
            title='Konkurs ogłoszony',
            preset_key='challenge',
            organiser=self.organiser,
            status='announced',
            visibility='public',
        )


class TableTests(APITestCase):
    """The lines themselves, read off the registries — the cheapest possible regression guard on a
    line somebody deletes in a merge."""

    def test_a_comment_can_hang_off_a_contest(self):
        self.assertEqual(TARGET_TYPE_BY_MODEL[('contests', 'contest')], 'contest')
        # A contest's visibility is a PER-ROW answer in the same shape a draft exercise's is, so it
        # is not in the per-TYPE private table; `visible_contests` is what 404s a stranger.
        self.assertNotIn('contest', PRIVATE_TARGET_TYPES)

    def test_a_contest_can_be_reported(self):
        self.assertIs(REPORT_KIND_MODELS['contest'], Contest)

    def test_a_contest_can_have_a_gallery(self):
        self.assertEqual(GALLERY_TARGETS[('contests', 'contest')], 'contest')

    def test_a_contests_title_and_description_are_translatable(self):
        model, heading, body = TRANSLATABLE_KIND_MODELS['contest']
        self.assertIs(model, Contest)
        self.assertEqual((heading, body), ('title', 'description'))

    def test_a_deck_can_be_placed_on_a_contest(self):
        self.assertIn('contest', PLACEABLE_NODE_KINDS)

    def test_a_contest_is_a_discussion_location(self):
        from community import discussions

        self.assertEqual(discussions.management_kind('contests/7'), 'contests')
        self.assertEqual(discussions.MANAGEMENT_KINDS['contests'][2], 'contests')
        # By pk, not by slug — `/contests/7` is the route.
        self.assertNotIn('contests', discussions.SLUG_KINDS)
        # And it IS a node, which is what keeps `management_rows` from prefetching a relation a
        # contest does not have.
        self.assertIn('contests', discussions.NODE_KINDS_HERE)

    def test_the_work_dashboard_has_the_four_contest_sections(self):
        from work import providers

        for kind in (
            'contest_registration',
            'contest_judging',
            'contest_complaint',
            'contest_stage',
        ):
            self.assertIn(kind, providers._REGISTRY, kind)
            self.assertEqual(providers._REGISTRY[kind][0], 'contests')
            self.assertIn(kind, providers._SECTION_ORDER, kind)

    def test_the_learning_record_has_a_placement_provider(self):
        from contests.record import placements_for
        from identity.record import PLACEMENT_PROVIDERS

        self.assertIn(placements_for, PLACEMENT_PROVIDERS)


class DiscussionTests(RegistryBase):
    def _thread(self, contest):
        return self.client.get(reverse('discussion-thread'), {'page': f'contests/{contest.pk}'})

    def test_a_stranger_404s_on_a_drafts_thread(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._thread(self.draft).status_code, status.HTTP_404_NOT_FOUND)

    def test_its_staff_can_read_it(self):
        self.client.force_authenticate(self.organiser)
        self.assertEqual(self._thread(self.draft).status_code, status.HTTP_200_OK)

    def test_anybody_can_read_an_announced_ones(self):
        response = self._thread(self.live)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['comments'], [])

    def test_a_contest_that_does_not_exist_is_a_404_and_not_a_400(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.get(reverse('discussion-thread'), {'page': 'contests/999999'})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_contests_switch_closes_the_thread(self):
        """House rule 3: a killed board must not keep a live thread under rows nobody can reach.
        Asked as a NON-staff reader, because `feature_gate` has a staff bypass and this is not it —
        `effective_policy` folds the row's own switch in for everybody."""
        from community import discussions

        _flag('contests', False)
        policy = discussions.effective_policy(f'contests/{self.live.pk}', '')
        self.assertFalse(policy['is_enabled'])
        # A neighbour keeps working while returning nothing for the killed one.
        self.assertTrue(discussions.effective_policy('about', '')['is_enabled'])


class ReportTests(RegistryBase):
    def _report(self, contest):
        return self.client.post(
            reverse('report-list'),
            {'kind': 'contest', 'object_id': contest.pk, 'reason': 'Nagrody nie ma'},
            format='json',
        )

    def test_an_announced_contest_can_be_reported(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._report(self.live).status_code, status.HTTP_201_CREATED)

    def test_a_stranger_cannot_report_a_draft(self):
        """A reporting form that confirmed a draft exists would be a way to enumerate drafts by
        id. The refusal is this endpoint's own "no matching content", which is the honest answer."""
        self.client.force_authenticate(self.stranger)
        response = self._report(self.draft)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('object_id', response.data)

    def test_its_own_staff_can_report_a_draft(self):
        """Not a special permission — `visible_contests` admits them, so for them it exists."""
        self.client.force_authenticate(self.organiser)
        self.assertEqual(self._report(self.draft).status_code, status.HTTP_201_CREATED)

    def test_a_moderators_remove_hides_it_rather_than_cancelling_it(self):
        """`cancelled` is the ORGANISER's act and carries the same-channel revocation KC art. 919
        §2 requires. A moderator taking a contest down is not the przyrzekający revoking."""
        from moderation.services import resolve_report_decision

        moderator = make_user('registry-moderator', is_staff=True)
        resolve_report_decision(
            Contest, self.live.pk, 'remove', resolved_by=moderator, note='Brak nagrody'
        )
        self.live.refresh_from_db()
        self.assertEqual(self.live.visibility, 'private')
        self.assertEqual(self.live.status, 'announced')
        resolve_report_decision(Contest, self.live.pk, 'restore', resolved_by=moderator)
        self.live.refresh_from_db()
        self.assertEqual(self.live.visibility, 'public')


class GalleryTests(RegistryBase):
    def _for_target(self, contest):
        return self.client.get(
            reverse('gallery-for-target'), {'target_type': 'contest', 'target_id': contest.pk}
        )

    def test_a_stranger_404s_on_a_drafts_gallery(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._for_target(self.draft).status_code, status.HTTP_404_NOT_FOUND)

    def test_anybody_sees_an_announced_ones(self):
        response = self._for_target(self.live)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['target_type'], 'contest')

    def test_only_its_organisers_may_curate(self):
        from galleries.visibility import can_curate

        juror = make_user('registry-juror')
        ContestStaff.objects.create(contest=self.live, user=juror, role='jury')
        self.assertTrue(can_curate(self.live, self.organiser))
        self.assertFalse(can_curate(self.live, juror))
        self.assertFalse(can_curate(self.live, self.stranger))


class TranslationTests(RegistryBase):
    def _write(self, contest, user=None):
        if user is not None:
            self.client.force_authenticate(user)
        return self.client.put(
            reverse('text-versions-write', args=['contest', contest.pk]),
            {
                'original_locale': 'pl',
                'versions': {
                    'pl': {'heading': 'Konkurs ogłoszony', 'body': 'Opis po polsku.'},
                    'en': {'heading': 'An announced contest', 'body': 'The description.'},
                },
            },
            format='json',
        )

    def test_its_organiser_writes_both_languages_at_once(self):
        response = self._write(self.live, self.organiser)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(sorted(response.data['text']['available']), ['en', 'pl'])
        # Written in one submission, so nothing is newer anywhere.
        self.assertIsNone(response.data['text']['newer_elsewhere'])
        self.live.refresh_from_db()
        self.assertEqual(self.live.title, 'Konkurs ogłoszony')

    def test_a_stranger_gets_404_not_403(self):
        response = self._write(self.live, self.stranger)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_juror_may_not_rename_the_contest(self):
        """Its organisers, not every staff member: a jury member scores and nothing else."""
        juror = make_user('registry-translating-juror')
        ContestStaff.objects.create(contest=self.live, user=juror, role='jury')
        self.assertEqual(self._write(self.live, juror).status_code, status.HTTP_404_NOT_FOUND)

    def test_the_reader_gets_their_own_interface_language(self):
        from translations.resolve import resolve

        self._write(self.live, self.organiser)
        self.live.refresh_from_db()
        self.assertEqual(resolve(self.live, 'en')['heading'], 'An announced contest')
        self.assertEqual(resolve(self.live, 'pl')['heading'], 'Konkurs ogłoszony')


class PlacementTests(RegistryBase):
    def setUp(self):
        super().setUp()
        self.deck = Deck.objects.create(owner=self.organiser, name='Zadania na pierwszy etap')

    def test_the_organiser_can_place_a_deck_on_a_contest(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'contest', 'id': self.live.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_a_stranger_may_not_place_one(self):
        from flashcards import rules

        stranger_deck = Deck.objects.create(owner=self.stranger, name='Czyjaś talia')
        self.assertEqual(
            rules.place_block_reason(self.stranger, stranger_deck, self.live),
            rules.CANNOT_MANAGE,
        )

    def test_a_stranger_404s_on_a_drafts_placements(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'contest', 'id': self.draft.pk},
            format='json',
        )
        self.client.force_authenticate(self.stranger)
        response = self.client.get(reverse('node-decks', args=['contest', self.draft.pk]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_placement_on_an_announced_contest_is_studyable_by_anybody_who_can_see_it(self):
        from flashcards import rules

        self.client.force_authenticate(self.organiser)
        self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'contest', 'id': self.live.pk},
            format='json',
        )
        self.assertTrue(rules.can_study(self.stranger, self.deck))
        response = self.client.get(reverse('node-decks', args=['contest', self.live.pk]))
        self.assertEqual(len(response.data), 1)


class ActivityFeedTests(RegistryBase):
    """House rule 9: the feed only ever gets a row for something that was public at that instant,
    and has a forgetting half."""

    def _rows(self, contest, kind=None):
        from activity.models import ActivityEvent

        rows = ActivityEvent.objects.filter(contest=contest)
        return rows.filter(kind=kind) if kind else rows

    def test_a_draft_never_announces_itself(self):
        self.assertEqual(self._rows(self.draft).count(), 0)

    def test_a_contest_created_public_announces_itself_once(self):
        self.assertEqual(self._rows(self.live, 'contest').count(), 1)
        row = self._rows(self.live, 'contest').first()
        self.assertEqual(row.actor, self.organiser)
        self.assertEqual(row.target_label, 'Konkurs ogłoszony')

    def test_the_row_appears_on_the_transition_and_not_on_every_save(self):
        self.draft.status = 'announced'
        self.draft.visibility = 'public'
        self.draft.save()
        self.assertEqual(self._rows(self.draft, 'contest').count(), 1)
        self.draft.save()
        self.draft.save()
        self.assertEqual(self._rows(self.draft, 'contest').count(), 1)

    def test_announcing_a_private_contest_writes_nothing(self):
        """`status` alone is not public: a private announced contest is still its staff's own."""
        self.draft.status = 'announced'
        self.draft.save()
        self.assertEqual(self._rows(self.draft).count(), 0)

    def test_results_published_is_its_own_row(self):
        self.live.status = 'results_published'
        self.live.save()
        self.assertEqual(self._rows(self.live, 'contest_results').count(), 1)
        self.assertEqual(self._rows(self.live, 'contest').count(), 1)
        # And closing it afterwards does not announce the results a second time.
        self.live.status = 'closed'
        self.live.save()
        self.assertEqual(self._rows(self.live, 'contest_results').count(), 1)

    def test_cancelling_forgets_both_rows(self):
        self.live.status = 'results_published'
        self.live.save()
        self.assertEqual(self._rows(self.live).count(), 2)
        self.live.status = 'cancelled'
        self.live.visibility = 'private'
        self.live.save()
        self.assertEqual(self._rows(self.live).count(), 0)

    def test_pulling_it_back_to_private_forgets_them_too(self):
        self.live.visibility = 'private'
        self.live.save()
        self.assertEqual(self._rows(self.live).count(), 0)

    def test_the_feed_endpoint_serves_the_contest_link(self):
        response = self.client.get(reverse('activity-feed'), {'kind': 'contest'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['contest'], self.live.pk)

    def test_a_hard_delete_takes_its_rows_with_it(self):
        from activity.models import ActivityEvent

        content_type = ContentType.objects.get_for_model(Contest)
        pk = self.live.pk
        self.live.delete()
        self.assertEqual(ActivityEvent.objects.filter(contest_id=pk).count(), 0)
        self.assertEqual(
            ActivityEvent.objects.filter(
                source_content_type=content_type, source_object_id=pk
            ).count(),
            0,
        )


class LearningRecordTests(RegistryBase):
    """The third block: the real provider end to end, then a monkeypatched one for the ordering."""

    def setUp(self):
        super().setUp()
        from identity.models import EducationProfile

        self.profile, _ = EducationProfile.objects.get_or_create(user=self.organiser)
        self.profile.share_activity = True
        self.profile.save()

    def test_a_published_result_reaches_the_record_through_the_registered_provider(self):
        """This used to assert `[]` from the step-B days when `placements_for` had no rows to read —
        which held whether or not the provider was wired at all."""
        from django.utils import timezone

        from contests.models import ContestRegistration, ContestResult
        from identity.record import learning_record

        self.assertEqual(learning_record(self.organiser, self.stranger)['placements'], [])
        registration = ContestRegistration.objects.create(
            contest=self.live, user=self.organiser, status='accepted'
        )
        ContestResult.objects.create(
            contest=self.live, registration=registration, rank=1, title='laureate',
            published_at=timezone.now(),
        )
        placements = learning_record(self.organiser, self.stranger)['placements']
        self.assertEqual([(p['title'], p['result_title']) for p in placements],
                         [('Konkurs ogłoszony', 'laureate')])

    def test_a_provider_that_answers_is_shown_newest_first_with_undated_last(self):
        from identity import record as record_module

        rows = [
            {'contest_id': 1, 'title': 'Konkurs A', 'result_title': 'laureate', 'published_at': '2026-03-01T10:00:00Z'},
            {'contest_id': 2, 'title': 'Konkurs B', 'result_title': 'finalist', 'published_at': None},
            {'contest_id': 3, 'title': 'Konkurs C', 'result_title': 'distinction', 'published_at': '2026-06-01T10:00:00Z'},
        ]
        original = list(record_module.PLACEMENT_PROVIDERS)
        record_module.PLACEMENT_PROVIDERS.append(lambda user: rows)
        try:
            record = record_module.learning_record(self.organiser, self.stranger)
            self.assertEqual(
                [row['title'] for row in record['placements']],
                ['Konkurs C', 'Konkurs A', 'Konkurs B'],
            )
        finally:
            record_module.PLACEMENT_PROVIDERS[:] = original

    def test_without_the_consent_it_is_withheld_rather_than_empty(self):
        """`null` and `[]` are two different answers: "not shared" and "shared and empty"."""
        from identity.record import learning_record

        self.profile.share_activity = False
        self.profile.save()
        record = learning_record(self.organiser, self.stranger)
        self.assertIsNone(record)

    def test_a_minors_placements_are_never_public(self):
        from identity.record import learning_record

        minor = make_user('registry-minor')
        # `Profile.is_minor` is a stored flag, not a birth date: the year is asked once at
        # registration purely to branch and then discarded (`accounts/models.py`).
        minor.profile.is_minor = True
        minor.profile.save()
        from identity.models import EducationProfile

        profile, _ = EducationProfile.objects.get_or_create(user=minor)
        profile.share_activity = True
        profile.save()
        record = learning_record(minor, minor)
        self.assertEqual(record['withheld_reason'], 'minor')
        self.assertIsNone(record['placements'])
