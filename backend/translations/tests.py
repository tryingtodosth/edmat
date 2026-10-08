"""Tests for `translations` (`test.md`'s shape: the resolution rule first, then the refusals, then
the happy path).

**The resolution first**, because it is the part that would be hardest to notice going wrong. "An
English reader was quietly served the Polish" and "a reader was told the Polish is 4 minutes newer
when both were written in the same breath" are both silent, and both are a table of rows and
timestamps rather than a request.

The node under test is an **organisation**, because that is the surface the owner was looking at
when they asked for this (`/about` is the EdMat organisation's page) and because its roster gives
the three-way split the authority rules need: a manager, a member who is not one, and an outsider.
"""

from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from decisions.models import Poll, PollOption
from needs.models import Need
from organizations.models import Organization, OrganizationMember
from plans.models import Plan, PlanStep
from tasks.models import Task
from telemetry.routers import all_log_shards
from testing.factories import make_user

from . import resolve
from .models import TextVersion
from .services import TranslationWriteError, write_versions


#: The row's own two columns, for the rule table below. `resolve.pick` takes them as plain values,
#: which is why these tests need no model, no registry entry and no database — an earlier draft
#: faked a model instead and got an empty heading, because `targets.own_text` asks the registry what
#: a row's text columns are called and a fake is in no registry.
OWN_HEADING = 'the original column'
OWN_BODY = 'the original body'


class _StubRow:
    """Only `versions_payload` needs a row-shaped thing: it reads the relation and nothing else."""

    def __init__(self, versions):
        self.text_versions = self
        self._versions = versions

    def all(self):
        return self._versions


class _Version:
    is_original = False

    def __init__(self, locale, heading, body, updated_at, is_original=False):
        self.locale = locale
        self.heading = heading
        self.body = body
        self.updated_at = updated_at
        self.is_original = is_original


class ResolutionTests(APITestCase):
    """`resolve.pick` as a table. No database and no models — see this module's docstring."""

    def setUp(self):
        self.now = timezone.now()

    def pick(self, versions, locale):
        return resolve.pick(versions, OWN_HEADING, OWN_BODY, locale)

    def test_a_row_with_no_versions_reads_its_own_columns_and_says_nothing_else(self):
        """Every management row written before this app existed lands here, which is what makes the
        change additive: nothing was migrated and nothing guessed a language."""
        reading = self.pick([], 'en')
        self.assertEqual(reading['heading'], OWN_HEADING)
        self.assertEqual(reading['body'], OWN_BODY)
        self.assertEqual(reading['locale'], '')
        self.assertEqual(reading['available'], [])
        self.assertIsNone(reading['newer_elsewhere'])
        self.assertFalse(reading['is_fallback'])

    def test_a_reader_gets_their_own_language_when_it_exists(self):
        reading = self.pick(
            [
                _Version('pl', 'Zadanie', 'Opis', self.now, is_original=True),
                _Version('en', 'A task', 'A description', self.now),
            ],
            'en',
        )
        self.assertEqual(reading['heading'], 'A task')
        self.assertEqual(reading['locale'], 'en')
        self.assertFalse(reading['is_fallback'])
        self.assertEqual(reading['available'], ['en', 'pl'])
        self.assertEqual(reading['original_locale'], 'pl')

    def test_a_reader_whose_language_nobody_wrote_gets_the_original_and_is_told(self):
        reading = self.pick([_Version('pl', 'Zadanie', 'Opis', self.now, is_original=True)], 'en')
        self.assertEqual(reading['heading'], 'Zadanie')
        self.assertEqual(reading['locale'], 'pl')
        # The frontend says "this is the Polish" rather than pretending it is the English.
        self.assertTrue(reading['is_fallback'])

    def test_two_languages_written_together_report_nothing_newer(self):
        """The property the owner asked for in as many words: *"so that if a user translates and
        edit/update/new content, there's no sth like “newer in PL by 4 minutes”"*. It holds
        because `write_versions` stamps one timestamp, which is why `updated_at` is not
        `auto_now`."""
        reading = self.pick(
            [
                _Version('pl', 'Zadanie', 'Opis', self.now, is_original=True),
                _Version('en', 'A task', 'A description', self.now),
            ],
            'en',
        )
        self.assertIsNone(reading['newer_elsewhere'])

    def test_a_newer_version_in_another_language_says_how_much_newer(self):
        reading = self.pick(
            [
                _Version('pl', 'Zadanie', 'Opis', self.now, is_original=True),
                _Version('en', 'A task', 'A description', self.now - timedelta(minutes=4)),
            ],
            'en',
        )
        self.assertEqual(reading['heading'], 'A task')
        self.assertEqual(reading['newer_elsewhere'], {'locale': 'pl', 'seconds': 240})

    def test_the_reader_on_the_newest_language_is_told_nothing(self):
        reading = self.pick(
            [
                _Version('pl', 'Zadanie', 'Opis', self.now - timedelta(minutes=4), is_original=True),
                _Version('en', 'A task', 'A description', self.now),
            ],
            'en',
        )
        self.assertIsNone(reading['newer_elsewhere'])

    def test_versions_payload_puts_the_original_first(self):
        """The editor draws the original in its left-hand column."""
        payload = resolve.versions_payload(
            _StubRow(
                [
                    _Version('en', 'A task', '', self.now),
                    _Version('pl', 'Zadanie', '', self.now, is_original=True),
                ]
            )
        )
        self.assertEqual([entry['locale'] for entry in payload], ['pl', 'en'])
        self.assertTrue(payload[0]['is_original'])


class TranslationsTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.manager = make_user('tr-manager')
        self.member = make_user('tr-member')
        self.outsider = make_user('tr-outsider')

        self.org = Organization.objects.create(
            name='Test circle', slug='tr-circle', kind='circle', created_by=self.manager
        )
        OrganizationMember.objects.create(organization=self.org, user=self.manager, role='owner')
        OrganizationMember.objects.create(organization=self.org, user=self.member, role='member')
        self.node_ct = ContentType.objects.get_for_model(Organization)

        self.task = Task.objects.create(
            content_type=self.node_ct,
            object_id=self.org.pk,
            title='Glued title / Sklejony tytul',
            description='Glued body',
            created_by=self.manager,
        )
        self.plan = Plan.objects.create(
            content_type=self.node_ct,
            object_id=self.org.pk,
            title='A plan',
            created_by=self.manager,
        )
        self.step = PlanStep.objects.create(plan=self.plan, title='A step', order=0)
        self.need = Need.objects.create(
            content_type=self.node_ct,
            object_id=self.org.pk,
            title='A need',
            kind='expertise',
            created_by=self.manager,
        )
        self.poll = Poll.objects.create(
            content_type=self.node_ct,
            object_id=self.org.pk,
            question='A question',
            created_by=self.manager,
        )
        self.option = PollOption.objects.create(poll=self.poll, text='An option', order=0)

    def url(self, kind, pk):
        return reverse('text-versions-write', args=[kind, pk])

    BOTH = {
        'original_locale': 'pl',
        'versions': {
            'pl': {'heading': 'Polski tytul', 'body': 'Polski opis'},
            'en': {'heading': 'English title', 'body': 'English body'},
        },
    }

    # ---- refusals ----

    def test_an_outsider_gets_a_404_rather_than_a_403(self):
        """The root CLAUDE.md's API convention: writes are owner-scoped, so a non-owner's write
        attempt is a 404 — for them the thing they are writing to does not exist."""
        self.client.force_authenticate(self.outsider)
        response = self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_anonymous_visitor_is_refused(self):
        response = self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_an_unknown_kind_is_a_404(self):
        self.client.force_authenticate(self.manager)
        response = self.client.put(self.url('exercise', 1), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_open_poll_refuses_with_its_reason_and_a_409(self):
        """Not this app's invention: `decisions/views.py` already refuses a PATCH to a poll that
        has left `draft`, because its question is what people have voted on."""
        self.poll.status = 'open'
        self.poll.save(update_fields=['status'])
        self.client.force_authenticate(self.manager)
        response = self.client.put(self.url('poll', self.poll.pk), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'poll_not_draft')

    def test_an_original_language_that_is_not_in_the_payload_is_refused(self):
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            self.url('task', self.task.pk),
            {'original_locale': 'de', 'versions': {'pl': {'heading': 'x'}}},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'original_locale_not_in_versions')

    def test_an_empty_original_heading_is_refused(self):
        """A row has to say what it is in at least the language it was written in."""
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            self.url('task', self.task.pk),
            {'original_locale': 'pl', 'versions': {'pl': {'heading': '   ', 'body': 'x'}}},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'original_heading_empty')

    # ---- the happy paths ----

    def test_writing_both_languages_at_once_leaves_nothing_newer_anywhere(self):
        self.client.force_authenticate(self.manager)
        response = self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['text']['newer_elsewhere'])
        self.assertEqual(sorted(response.data['text']['available']), ['en', 'pl'])
        stamps = {version.updated_at for version in TextVersion.objects.all()}
        self.assertEqual(len(stamps), 1, 'both languages must carry the one write timestamp')

    def test_the_original_is_mirrored_onto_the_rows_own_column(self):
        """What keeps every existing reader of `Task.title` correct — the work dashboard, the feed,
        a notification body, Django admin, none of which knows this app exists."""
        self.client.force_authenticate(self.manager)
        self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Polski tytul')
        self.assertEqual(self.task.description, 'Polski opis')

    def test_a_reader_gets_their_own_language_through_the_tasks_own_endpoint(self):
        """End to end: the mixin really does make `title` answer in `?lang=`."""
        self.client.force_authenticate(self.manager)
        self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        listing = self.client.get(
            reverse('node-tasks', args=['organization', self.org.pk]) + '?lang=en'
        )
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        row = next(entry for entry in listing.data if entry['id'] == self.task.pk)
        self.assertEqual(row['title'], 'English title')
        self.assertEqual(row['language']['locale'], 'en')
        self.assertFalse(row['language']['is_fallback'])

    def test_a_reader_whose_language_is_missing_is_told_it_is_a_fallback(self):
        self.client.force_authenticate(self.manager)
        self.client.put(
            self.url('task', self.task.pk),
            {'original_locale': 'pl', 'versions': {'pl': {'heading': 'Tylko polski'}}},
            format='json',
        )
        listing = self.client.get(
            reverse('node-tasks', args=['organization', self.org.pk]) + '?lang=en'
        )
        row = next(entry for entry in listing.data if entry['id'] == self.task.pk)
        self.assertEqual(row['title'], 'Tylko polski')
        self.assertTrue(row['language']['is_fallback'])

    def test_editing_one_language_afterwards_is_what_produces_the_staleness_reading(self):
        self.client.force_authenticate(self.manager)
        self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        # Backdate the English so the next Polish-only write is genuinely newer.
        TextVersion.objects.filter(locale='en').update(
            updated_at=timezone.now() - timedelta(minutes=4)
        )
        response = self.client.put(
            self.url('task', self.task.pk),
            {'original_locale': 'pl', 'versions': {'pl': {'heading': 'Nowy tytul', 'body': 'x'}}},
            format='json',
        )
        listing = self.client.get(
            reverse('node-tasks', args=['organization', self.org.pk]) + '?lang=en'
        )
        row = next(entry for entry in listing.data if entry['id'] == self.task.pk)
        self.assertEqual(row['title'], 'English title')
        self.assertEqual(row['language']['newer_elsewhere']['locale'], 'pl')
        self.assertGreater(row['language']['newer_elsewhere']['seconds'], 0)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_blanked_translation_is_deleted_and_an_unmentioned_one_is_left_alone(self):
        self.client.force_authenticate(self.manager)
        self.client.put(
            self.url('task', self.task.pk),
            {
                'original_locale': 'pl',
                'versions': {
                    'pl': {'heading': 'Polski'},
                    'en': {'heading': 'English'},
                    'de': {'heading': 'Deutsch'},
                },
            },
            format='json',
        )
        # Blank the English; say nothing at all about the German.
        response = self.client.put(
            self.url('task', self.task.pk),
            {
                'original_locale': 'pl',
                'versions': {'pl': {'heading': 'Polski'}, 'en': {'heading': '', 'body': ''}},
            },
            format='json',
        )
        self.assertEqual(sorted(response.data['text']['available']), ['de', 'pl'])

    def test_changing_which_language_is_the_original_does_not_trip_the_constraint(self):
        """The partial unique index is enforced immediately, so the previous original has to stop
        being one BEFORE the new one is written — which an earlier draft of the service got wrong."""
        self.client.force_authenticate(self.manager)
        self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        response = self.client.put(
            self.url('task', self.task.pk),
            {
                'original_locale': 'en',
                'versions': {
                    'pl': {'heading': 'Polski'},
                    'en': {'heading': 'English now the original'},
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['text']['original_locale'], 'en')
        self.assertEqual(TextVersion.objects.filter(is_original=True).count(), 1)
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'English now the original')

    def test_a_task_assignee_may_translate_the_thing_they_are_carrying(self):
        """`tasks.rules.can_edit`'s third party, asked rather than re-implemented: a person who may
        not fix the words of the thing they are doing keeps the real version somewhere else."""
        from tasks.models import TaskAssignee

        TaskAssignee.objects.create(task=self.task, user=self.member, assigned_by=self.manager)
        self.client.force_authenticate(self.member)
        response = self.client.put(self.url('task', self.task.pk), self.BOTH, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_every_kind_in_the_registry_can_be_written(self):
        self.client.force_authenticate(self.manager)
        for kind, pk in (
            ('task', self.task.pk),
            ('plan', self.plan.pk),
            ('plan_step', self.step.pk),
            ('need', self.need.pk),
            ('poll', self.poll.pk),
        ):
            response = self.client.put(self.url(kind, pk), self.BOTH, format='json')
            self.assertEqual(response.status_code, status.HTTP_200_OK, kind)
            self.assertEqual(response.data['heading'], 'Polski tytul', kind)

    def test_a_poll_option_has_a_heading_and_no_body(self):
        """The one target with a single text field — whatever `body` arrives is simply not read."""
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            self.url('poll_option', self.option.pk),
            {
                'original_locale': 'pl',
                'versions': {
                    'pl': {'heading': 'Opcja', 'body': 'ignored'},
                    'en': {'heading': 'Option'},
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.option.refresh_from_db()
        self.assertEqual(self.option.text, 'Opcja')

    def test_the_service_refuses_an_empty_payload(self):
        with self.assertRaises(TranslationWriteError):
            write_versions(self.task, original_locale='pl', versions={}, user=self.manager)

    # ---- the organisation: a body and no heading ----

    def test_an_organisation_is_translated_by_its_description_alone(self):
        """The mirror image of a poll option. Its `name` is a registered name and the same in every
        language, so the heading pane does not exist — and the "say something in the language you
        wrote it in" rule falls on the body instead."""
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            self.url('organization', self.org.pk),
            {
                'original_locale': 'pl',
                'versions': {'pl': {'body': 'Polski opis'}, 'en': {'body': 'An English blurb'}},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['body'], 'Polski opis')
        self.org.refresh_from_db()
        self.assertEqual(self.org.description, 'Polski opis')
        # The name is untouched.
        self.assertEqual(self.org.name, 'Test circle')

    def test_an_organisation_with_an_empty_body_is_refused(self):
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            self.url('organization', self.org.pk),
            {'original_locale': 'pl', 'versions': {'pl': {'body': '  '}}},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'original_body_empty')

    def test_an_organisations_description_answers_in_the_readers_language(self):
        self.client.force_authenticate(self.manager)
        self.client.put(
            self.url('organization', self.org.pk),
            {
                'original_locale': 'pl',
                'versions': {'pl': {'body': 'Polski opis'}, 'en': {'body': 'An English blurb'}},
            },
            format='json',
        )
        detail = self.client.get(f'/api/organizations/{self.org.pk}/?lang=en')
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data['description'], 'An English blurb')
        self.assertEqual(detail.data['language']['locale'], 'en')

    def test_the_mirrored_column_is_sanitized_like_the_version_row(self):
        """House rule 8, and the reason the mirror copies the SAVED row rather than the payload: a
        `Task` sanitizes in its serializer, not in `save()`, so the ORM is a second entry point."""
        self.client.force_authenticate(self.manager)
        self.client.put(
            self.url('task', self.task.pk),
            {
                'original_locale': 'pl',
                'versions': {
                    'pl': {'heading': 'Tytul', 'body': '<script>alert(1)</script><b>ok</b>'}
                },
            },
            format='json',
        )
        self.task.refresh_from_db()
        self.assertNotIn('<script>', self.task.description)
        self.assertEqual(self.task.description, TextVersion.objects.get(locale='pl').body)


class KeepEditedTests(APITestCase):
    """`write_versions(keep_edited=True)` — the rule that lets `seed_edmat_project` be re-run after
    every deployment without eating the owner's own words.

    The hazard was real and the owner named it (2026-10-08): *"wdym? each time we apply on server we
    will rerun the seed script?! its going to overwrite my edits i do on production on the desc of
    edmat"*. The seed refreshes text on every run, the bilingual editor now makes that text editable
    on production, and the runbook was about to say "re-run it after every bundle".

    `written_by` is what tells the two apart: null for a row the seed wrote, set for one a person
    saved. Nothing has to remember a flag.
    """

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.owner = make_user('keep-owner')
        self.org = Organization.objects.create(
            name='Keep circle', slug='keep-circle', kind='circle', created_by=self.owner
        )
        OrganizationMember.objects.create(organization=self.org, user=self.owner, role='owner')
        self.task = Task.objects.create(
            content_type=ContentType.objects.get_for_model(Organization),
            object_id=self.org.pk,
            title='Seeded title',
            description='Seeded body',
            created_by=self.owner,
        )

    def seed(self):
        """What the seed does: writes with no user, and refuses to overwrite a person."""
        return write_versions(
            self.task,
            original_locale='pl',
            versions={
                'pl': {'heading': 'Seeded PL', 'body': 'Seeded PL body'},
                'en': {'heading': 'Seeded EN', 'body': 'Seeded EN body'},
            },
            user=None,
            keep_edited=True,
        )

    def test_the_seed_fills_in_what_nobody_has_written(self):
        self.seed()
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Seeded PL')
        self.assertEqual(TextVersion.objects.filter(object_id=self.task.pk).count(), 2)

    def test_a_persons_edit_survives_the_seed_for_ever(self):
        self.seed()
        # The owner edits, through the editor — `keep_edited` is False there, and `user` is real.
        write_versions(
            self.task,
            original_locale='pl',
            versions={
                'pl': {'heading': 'MY TITLE', 'body': 'MY BODY'},
                'en': {'heading': 'MY EN TITLE', 'body': 'MY EN BODY'},
            },
            user=self.owner,
        )
        # Every later deployment re-runs the seed.
        for _ in range(3):
            self.seed()
        rows = {v.locale: v for v in TextVersion.objects.filter(object_id=self.task.pk)}
        self.assertEqual(rows['pl'].heading, 'MY TITLE')
        self.assertEqual(rows['en'].heading, 'MY EN TITLE')
        self.assertEqual(rows['pl'].written_by, self.owner)
        # And the row's own column follows the PERSON, not the seed — otherwise the two halves of
        # the same text drift apart, which is how the column was found stale on the dev VM.
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'MY TITLE')

    def test_one_edited_language_does_not_freeze_the_other(self):
        """A half-translated row is the ordinary case: the owner rewrote the Polish and left the
        English to the seed."""
        self.seed()
        write_versions(
            self.task, original_locale='pl', versions={'pl': {'heading': 'MY PL', 'body': 'x'}},
            user=self.owner,
        )
        self.seed()
        rows = {v.locale: v for v in TextVersion.objects.filter(object_id=self.task.pk)}
        self.assertEqual(rows['pl'].heading, 'MY PL')
        self.assertEqual(rows['en'].heading, 'Seeded EN')
        self.assertIsNone(rows['en'].written_by)

    def test_deleting_the_row_is_the_way_back_to_the_seeded_text(self):
        """The documented undo, and the only one — stated in `write_versions`' own docstring and in
        the deployment runbook."""
        self.seed()
        write_versions(
            self.task, original_locale='pl', versions={'pl': {'heading': 'MY PL', 'body': 'x'}},
            user=self.owner,
        )
        TextVersion.objects.filter(object_id=self.task.pk).delete()
        self.seed()
        rows = {v.locale: v for v in TextVersion.objects.filter(object_id=self.task.pk)}
        self.assertEqual(rows['pl'].heading, 'Seeded PL')

    def test_without_the_flag_a_write_still_overwrites(self):
        """The editor's own path: saving again replaces what you saved before."""
        write_versions(
            self.task, original_locale='pl', versions={'pl': {'heading': 'first', 'body': ''}},
            user=self.owner,
        )
        write_versions(
            self.task, original_locale='pl', versions={'pl': {'heading': 'second', 'body': ''}},
            user=self.owner,
        )
        self.assertEqual(TextVersion.objects.get(object_id=self.task.pk).heading, 'second')


class HeadingIsPlainTextTests(APITestCase):
    """A heading is NOT run through `config.sanitize`, and that is load-bearing.

    `bleach` entity-escapes rather than strips: `i18n & content` became `i18n &amp; content`, which
    a reader sees literally — and, because the seed looks its rows up by title and the mirrored
    title no longer matched the file's, a second seed run created a DUPLICATE of every plan step
    whose heading contained an `&`. Ten of them, found by running the seed twice on the dev VM.
    """

    databases = set(all_log_shards()) | {'default'}

    def test_an_ampersand_in_a_heading_survives_a_round_trip(self):
        owner = make_user('amp-owner')
        org = Organization.objects.create(
            name='Amp circle', slug='amp-circle', kind='circle', created_by=owner
        )
        task = Task.objects.create(
            content_type=ContentType.objects.get_for_model(Organization),
            object_id=org.pk,
            title='x',
            created_by=owner,
        )
        write_versions(
            task,
            original_locale='pl',
            versions={'pl': {'heading': 'i18n & content-translation', 'body': 'a & b'}},
            user=owner,
        )
        version = TextVersion.objects.get(object_id=task.pk)
        self.assertEqual(version.heading, 'i18n & content-translation')
        task.refresh_from_db()
        self.assertEqual(task.title, 'i18n & content-translation')
        # The BODY is still sanitized — house rule 8 is unchanged for the half that is real HTML.
        self.assertIn('&amp;', version.body)


class SeedDeGluingTests(APITestCase):
    """The EdMat seed's own de-gluing (`work/edmat_project.py`, 2026-10-08).

    The seed keeps writing `_pl_en(...)` and `'PL / EN'`, which is a good way to keep a bilingual
    source readable in one file; what changed is that it now SPLITS that on the way in. These are
    the two splits and the one thing that would have broken quietly: a second run against a
    database seeded before the change duplicating every row, because the title it looks rows up by
    is no longer the title it wrote.
    """

    def test_a_body_splits_on_the_rule_and_survives_not_having_one(self):
        from work.edmat_project import _pl_en, _split_body

        self.assertEqual(_split_body(_pl_en('Polskie', 'English')), ('Polskie', 'English'))
        self.assertEqual(_split_body('Only one language'), ('Only one language', ''))

    def test_a_title_splits_on_the_separator_and_survives_not_having_one(self):
        from work.edmat_project import _split_title

        self.assertEqual(
            _split_title('Wskaźnik „z pomocą AI” / The “AI-assisted” score'),
            ('Wskaźnik „z pomocą AI”', 'The “AI-assisted” score'),
        )
        # The real case that made a naive split risky: a slash with no spaces round it is not a
        # separator.
        self.assertEqual(
            _split_title('liczba 0–1 czy tak/nie? / a number 0–1 or yes/no?'),
            ('liczba 0–1 czy tak/nie?', 'a number 0–1 or yes/no?'),
        )
        self.assertEqual(_split_title('Zebranie Zalozycielskie'), ('Zebranie Zalozycielskie', ''))

    def test_every_title_in_the_seed_splits_into_exactly_two_halves(self):
        """The claim `_TITLE_RULE`'s own comment makes, asserted rather than trusted: if somebody
        writes a title with two ` / ` in it, this fails here rather than filing half of it as
        English."""
        import re
        from pathlib import Path

        import work.edmat_project as seed

        source = Path(seed.__file__).read_text()
        titles = re.findall(r"'(?:title|question)': '((?:[^'\\]|\\.)*)'", source)
        self.assertGreater(len(titles), 40, 'the regex stopped matching the file')
        two_or_none = [t for t in titles if t.count(seed._TITLE_RULE) <= 1]
        self.assertEqual(
            len(two_or_none), len(titles), [t for t in titles if t.count(seed._TITLE_RULE) > 1]
        )


class SeedLookupTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_a_row_left_glued_by_an_earlier_run_is_found_not_duplicated(self):
        from work.edmat_project import _find_by_title

        owner = make_user('seed-owner')
        org = Organization.objects.create(
            name='Seed circle', slug='seed-circle', kind='circle', created_by=owner
        )
        node = {
            'content_type': ContentType.objects.get_for_model(Organization),
            'object_id': org.pk,
        }
        glued = 'Polski tytul / An English title'
        Task.objects.create(**node, title=glued, created_by=owner)
        self.assertIsNotNone(_find_by_title(Task, node, glued))

        # And once this run has rewritten it to the Polish half alone, the NEXT run still finds it.
        Task.objects.filter(**node).update(title='Polski tytul')
        self.assertIsNotNone(_find_by_title(Task, node, glued))
        self.assertEqual(Task.objects.filter(**node).count(), 1)
