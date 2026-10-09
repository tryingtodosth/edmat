"""`personalize.apply_preset` — the preset turned into rows on the contest node.

Step B of the contests cycle (`prompts/19-contests-b-personalise.md`), in its own module beside
`tests.py` the way that file's own docstring asks. One class per sentence of the brief's "what
finished means", because each of those sentences is a separate way this could be wrong:

- a `school` contest with every flag on gets the plan, the goal, the tasks, the needs and the poll;
- the plan carries the timeline and real due dates worked out from the contest's own dates;
- the goal's criteria ARE the preset's, and its status is derived rather than written;
- a task carries its citations, their verification markers and "this is not legal advice";
- a second call creates nothing and says so;
- `tasks` switched off puts `'tasks'` in `skipped` and creates everything else;
- a `challenge` creates no prize items, anywhere.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from contests import presets
from contests.models import Contest, ContestStaff
from contests.personalize import ALREADY, NOT_MANAGER, UNKNOWN_PRESET, apply_preset
from decisions.models import Poll
from goals.models import Goal
from moderation.models import FeatureFlag
from needs.models import Need
from plans.models import Plan
from tasks.models import Task
from telemetry.routers import all_log_shards
from testing.factories import make_user

MODULE_FLAGS = ('plans', 'goals', 'tasks', 'needs', 'decisions')


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class PersonalizeBase(APITestCase):
    # The request-log middleware writes to a shard on every request, and a class that did not
    # declare them kills `--parallel` (`backend/CLAUDE.md`, Testing).
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        for key in MODULE_FLAGS:
            _flag(key, True)
        _flag('contests', True)
        self.organiser = make_user('personalise-organiser')
        self.secretary = make_user('personalise-secretary')
        self.stranger = make_user('personalise-stranger')
        self.now = timezone.now()

    def make_contest(self, preset_key='school', **extra):
        # `has_prize` is step A's column (default False); the wizard sets it from the preset on
        # founding, so the factory does the same — a `school` contest promises a prize unless the
        # test says otherwise. Before the merge this module read the preset through `getattr`.
        contest = Contest.objects.create(
            title=extra.pop('title', 'Konkurs matematyczny klas siódmych'),
            preset_key=preset_key,
            has_prize=extra.pop('has_prize', getattr(presets.get(preset_key), 'has_prize', False)),
            organiser=self.organiser,
            starts_at=self.now + timedelta(days=30),
            ends_at=self.now + timedelta(days=60),
            registration_opens_at=self.now + timedelta(days=31),
            registration_closes_at=self.now + timedelta(days=45),
            **extra,
        )
        ContestStaff.objects.create(
            contest=contest, user=self.secretary, role='secretary', added_by=self.organiser
        )
        return contest

    def node_filter(self, contest):
        from config import nodes

        return {'content_type': nodes.node_content_type(contest), 'object_id': contest.pk}


class EverythingOnTests(PersonalizeBase):
    """A `school` contest with every flag on."""

    def setUp(self):
        super().setUp()
        self.contest = self.make_contest()
        self.preset = presets.get('school')
        self.report = apply_preset(self.contest, self.organiser)
        self.node = self.node_filter(self.contest)

    def test_the_report_has_the_shape_the_stub_promised(self):
        """The signature was fixed in advance because step A calls it and the wizard draws it."""
        self.assertEqual(self.report['preset'], 'school')
        self.assertEqual(
            set(self.report['created']), {'plan', 'goal', 'tasks', 'needs', 'polls'}
        )
        self.assertEqual(self.report['skipped'], [])
        self.assertIsNotNone(self.report['created']['plan'])
        self.assertIsNotNone(self.report['created']['goal'])

    def test_one_plan_with_the_timeline(self):
        plan = Plan.objects.get(pk=self.report['created']['plan'], **self.node)
        self.assertEqual(plan.status, 'active')
        self.assertEqual(plan.created_by, self.organiser)
        titles = list(plan.steps.order_by('order').values_list('title', flat=True))
        # Every phase that is not prize-only, plus two steps per stage of the preset's ladder.
        expected = len([p for p in presets.PLAN_PHASES]) + 2 * len(self.preset.stages)
        self.assertEqual(len(titles), expected)
        # The ladder sits between "registration closes" and "judging", which is where a contest
        # stops being administration and starts being a competition.
        closes = titles.index('Zamknięcie zapisów')
        judging = titles.index('Ocenianie')
        self.assertEqual(judging - closes, 1 + 2 * len(self.preset.stages))

    def test_the_steps_carry_due_dates_from_the_contest_dates(self):
        plan = Plan.objects.get(pk=self.report['created']['plan'])
        by_title = {step.title: step for step in plan.steps.all()}
        self.assertEqual(by_title['Ogłoszenie konkursu'].due_at, self.contest.starts_at)
        self.assertEqual(
            by_title['Otwarcie zapisów'].due_at, self.contest.registration_opens_at
        )
        self.assertEqual(
            by_title['Zamknięcie zapisów'].due_at, self.contest.registration_closes_at
        )
        window = self.preset.complaint_window_days
        self.assertEqual(
            by_title['Zamknięcie okna reklamacji'].due_at,
            self.contest.ends_at + timedelta(days=window),
        )
        self.assertEqual(
            by_title['Zamknięcie konkursu'].due_at,
            self.contest.ends_at + timedelta(days=presets.HANDOVER_DAYS_AFTER_END),
        )

    def test_a_stage_becomes_two_steps_at_its_own_offsets(self):
        plan = Plan.objects.get(pk=self.report['created']['plan'])
        by_title = {step.title: step for step in plan.steps.all()}
        stage = self.preset.stages[0]
        opens = by_title[f'Otwarcie: {stage.name_pl}']
        closes = by_title[f'Zamknięcie: {stage.name_pl}']
        self.assertEqual(
            opens.due_at, self.contest.starts_at + timedelta(days=stage.offset_days)
        )
        self.assertEqual(
            closes.due_at,
            self.contest.starts_at + timedelta(days=stage.offset_days + stage.duration_days),
        )

    def test_one_goal_whose_criteria_are_the_presets(self):
        goal = Goal.objects.get(pk=self.report['created']['goal'], **self.node)
        wanted = presets.goal_criteria_for(self.preset, True)
        self.assertEqual(
            list(goal.criteria.order_by('order').values_list('text', flat=True)),
            [pl for _en, pl in wanted],
        )
        # Derived, never written: a goal with open criteria is open because the recount said so.
        self.assertEqual(goal.status, 'open')
        self.assertIsNone(goal.met_at)

    def test_one_task_per_checklist_item_assigned_by_role(self):
        items = presets.checklist_for(self.preset, True)
        self.assertEqual(len(self.report['created']['tasks']), len(items))
        by_key = {item.title_pl: item for item in items}
        for task in Task.objects.filter(pk__in=self.report['created']['tasks']):
            item = by_key[task.title]
            holder = self.secretary if item.role == 'secretary' else self.organiser
            self.assertEqual(
                [a.user_id for a in task.assignees.all()],
                [holder.pk],
                f'{task.title} should be on the {item.role}',
            )

    def test_a_task_description_carries_the_citations_their_markers_and_the_disclaimer(self):
        task = Task.objects.get(**self.node, title=presets.CHECKLIST['claim_deadline'].title_pl)
        self.assertIn('Kodeks cywilny art. 921 §1', task.description)
        # The marker, as a word rather than as a bracketed tag from the research note.
        self.assertIn(presets.MARKER_WORDS['verified'][1], task.description)
        self.assertIn(presets.NOT_LEGAL_ADVICE[1], task.description)

    def test_a_task_due_date_comes_from_its_phase(self):
        before = Task.objects.get(**self.node, title=presets.CHECKLIST['rules_published'].title_pl)
        self.assertEqual(
            before.due_at,
            self.contest.starts_at - timedelta(days=presets.BEFORE_ANNOUNCE_LEAD_DAYS),
        )
        at_results = Task.objects.get(
            **self.node, title=presets.CHECKLIST['results_published'].title_pl
        )
        self.assertEqual(at_results.due_at, self.contest.ends_at)
        after = Task.objects.get(
            **self.node, title=presets.CHECKLIST['complaints_answered'].title_pl
        )
        self.assertEqual(
            after.due_at,
            self.contest.ends_at + timedelta(days=self.preset.complaint_window_days),
        )

    def test_the_needs_are_the_presets(self):
        needs = Need.objects.filter(pk__in=self.report['created']['needs'])
        self.assertEqual(needs.count(), len(self.preset.needs))
        for kind, _en, pl, wanted in self.preset.needs:
            need = needs.get(title=pl)
            self.assertEqual(need.kind, kind)
            self.assertEqual(need.wanted_count, wanted)
            self.assertEqual(need.status, 'open')

    def test_one_draft_poll_for_the_jury(self):
        poll = Poll.objects.get(pk=self.report['created']['polls'][0], **self.node)
        self.assertEqual(poll.status, 'draft')
        self.assertEqual(poll.eligibility, 'staff')
        self.assertEqual(poll.mode, 'single')
        self.assertEqual(
            list(poll.options.order_by('order').values_list('text', flat=True)),
            [pl for _en, pl in presets.POLL_OPTIONS],
        )

    def test_every_row_is_written_in_both_languages_in_one_submission(self):
        """`translations/` — and the identical `updated_at` is the point: a row this created must
        never tell a reader that the Polish is four minutes newer than the English."""
        from translations.resolve import resolve

        plan = Plan.objects.get(pk=self.report['created']['plan'])
        reading_pl = resolve(plan, 'pl')
        reading_en = resolve(plan, 'en')
        self.assertEqual(sorted(reading_pl['available']), ['en', 'pl'])
        self.assertEqual(reading_pl['original_locale'], 'pl')
        self.assertEqual(reading_pl['heading'], presets.PLAN_TITLE[1])
        self.assertEqual(reading_en['heading'], presets.PLAN_TITLE[0])
        self.assertIsNone(reading_pl['newer_elsewhere'])
        self.assertIsNone(reading_en['newer_elsewhere'])


class IdempotenceTests(PersonalizeBase):
    def test_a_second_call_creates_nothing_and_says_so(self):
        contest = self.make_contest()
        first = apply_preset(contest, self.organiser)
        counts = (
            Plan.objects.count(),
            Goal.objects.count(),
            Task.objects.count(),
            Need.objects.count(),
            Poll.objects.count(),
        )
        second = apply_preset(contest, self.organiser)
        self.assertIn(ALREADY, second['skipped'])
        self.assertNotIn(ALREADY, first['skipped'])
        self.assertEqual(
            counts,
            (
                Plan.objects.count(),
                Goal.objects.count(),
                Task.objects.count(),
                Need.objects.count(),
                Poll.objects.count(),
            ),
        )
        # And it still NAMES the rows: the report says what exists, not only what it just made.
        self.assertEqual(second['created']['plan'], first['created']['plan'])
        self.assertEqual(sorted(second['created']['tasks']), sorted(first['created']['tasks']))

    def test_a_module_that_was_off_the_first_time_is_filled_in_on_the_second(self):
        """Per-row idempotence, not a marker flag: switching `needs` back on and re-running is how
        an organiser gets the rows a kill switch cost them."""
        _flag('needs', False)
        contest = self.make_contest()
        first = apply_preset(contest, self.organiser)
        self.assertIn('needs', first['skipped'])
        self.assertEqual(first['created']['needs'], [])

        _flag('needs', True)
        second = apply_preset(contest, self.organiser)
        self.assertNotIn(ALREADY, second['skipped'])
        self.assertEqual(len(second['created']['needs']), len(presets.get('school').needs))


class FlagsOffTests(PersonalizeBase):
    def test_tasks_off_skips_only_the_tasks(self):
        _flag('tasks', False)
        contest = self.make_contest()
        report = apply_preset(contest, self.organiser)
        self.assertEqual(report['skipped'], ['tasks'])
        self.assertEqual(report['created']['tasks'], [])
        self.assertIsNotNone(report['created']['plan'])
        self.assertIsNotNone(report['created']['goal'])
        self.assertTrue(report['created']['needs'])
        self.assertTrue(report['created']['polls'])
        self.assertFalse(Task.objects.exists())

    def test_every_module_off_is_five_words_and_no_exception(self):
        """House rule 10: a switched-off module is a word, never a 500 on founding a contest."""
        for key in MODULE_FLAGS:
            _flag(key, False)
        contest = self.make_contest()
        report = apply_preset(contest, self.organiser)
        self.assertEqual(report['skipped'][:5], list(MODULE_FLAGS))
        self.assertIn(ALREADY, report['skipped'])
        self.assertEqual(report['created'], {
            'plan': None, 'goal': None, 'tasks': [], 'needs': [], 'polls': [],
        })

    def test_each_module_off_on_its_own(self):
        for index, key in enumerate(MODULE_FLAGS):
            with self.subTest(flag=key):
                for other in MODULE_FLAGS:
                    _flag(other, other != key)
                contest = self.make_contest(title=f'Konkurs bez {key} {index}')
                report = apply_preset(contest, self.organiser)
                self.assertEqual([w for w in report['skipped'] if w != ALREADY], [key])


class ChallengeTests(PersonalizeBase):
    """A prize-free challenge — the default preset, and the one the whole of KC art. 919–921 does
    not reach (CONTESTS-LAW.md §13 g)."""

    def setUp(self):
        super().setUp()
        self.contest = self.make_contest('challenge', title='Wyzwanie z analizy')
        self.report = apply_preset(self.contest, self.organiser)
        self.node = self.node_filter(self.contest)

    def test_no_prize_task_anywhere(self):
        titles = set(
            Task.objects.filter(**self.node).values_list('title', flat=True)
        )
        for key in presets.PRIZE_ONLY_CHECKLIST:
            self.assertNotIn(
                presets.CHECKLIST[key].title_pl, titles, f'{key} must not exist without a prize'
            )
        # And the claim deadline above all: without a prize there is no promise to be ineffective.
        self.assertNotIn(presets.CHECKLIST['claim_deadline'].title_pl, titles)

    def test_no_prize_criterion_and_no_prize_step(self):
        goal = Goal.objects.get(pk=self.report['created']['goal'])
        texts = list(goal.criteria.values_list('text', flat=True))
        for _en, pl in presets.PRIZE_ONLY_GOAL_CRITERIA:
            self.assertNotIn(pl, texts)
        plan = Plan.objects.get(pk=self.report['created']['plan'])
        self.assertNotIn(
            'Wydanie nagród', list(plan.steps.values_list('title', flat=True))
        )

    def test_it_still_gets_a_jury_need_a_goal_and_a_poll(self):
        """A challenge is judged and ranked — that is what makes it a contest at all."""
        self.assertTrue(self.report['created']['needs'])
        self.assertIsNotNone(self.report['created']['goal'])
        self.assertTrue(self.report['created']['polls'])


class RefusalTests(PersonalizeBase):
    def test_a_stranger_creates_nothing(self):
        contest = self.make_contest()
        report = apply_preset(contest, self.stranger)
        self.assertEqual(report['skipped'], [NOT_MANAGER])
        self.assertFalse(Plan.objects.exists())
        self.assertFalse(Task.objects.exists())

    def test_a_jury_member_is_not_a_manager(self):
        """`contests/access.py`: jury scores and nothing else. It may still open a task, because
        `tasks.rules.can_create` admits any node staff — so the report says `not_manager` for the
        four that need a manager and creates the tasks."""
        contest = self.make_contest()
        juror = make_user('personalise-juror')
        ContestStaff.objects.create(contest=contest, user=juror, role='jury')
        report = apply_preset(contest, juror)
        self.assertEqual(report['skipped'].count(NOT_MANAGER), 4)
        self.assertIsNone(report['created']['plan'])
        self.assertTrue(report['created']['tasks'])

    def test_an_unknown_preset_is_a_word_not_a_crash(self):
        contest = self.make_contest('nie-ma-takiego')
        report = apply_preset(contest, self.organiser)
        self.assertEqual(report['skipped'], [UNKNOWN_PRESET])
        self.assertFalse(Plan.objects.exists())

    def test_a_contest_with_no_dates_gets_its_rows_without_due_dates(self):
        """An invented deadline on a legal checklist is worse than an open one."""
        contest = Contest.objects.create(
            title='Konkurs bez terminów', preset_key='school', organiser=self.organiser
        )
        report = apply_preset(contest, self.organiser)
        self.assertIsNotNone(report['created']['plan'])
        plan = Plan.objects.get(pk=report['created']['plan'])
        self.assertEqual(list(plan.steps.exclude(due_at=None)), [])
        self.assertEqual(
            Task.objects.filter(pk__in=report['created']['tasks']).exclude(due_at=None).count(), 0
        )


class PresetDataTests(APITestCase):
    """The data itself, with no database behind it — the table `personalize` reads."""

    def test_every_checklist_law_key_is_in_the_law_table(self):
        for item in presets.CHECKLIST.values():
            for key in item.law:
                self.assertIn(key, presets.LAW, f'{item.key} cites unknown {key}')

    def test_every_law_row_has_a_known_marker_and_a_polish_citation(self):
        for key, (_citation, marker) in presets.LAW.items():
            self.assertIn(marker, presets.LAW_MARKERS, key)
            self.assertIn(key, presets.LAW_PL, f'{key} has no Polish citation')

    def test_no_preset_advances_by_chance(self):
        """CONTESTS-LAW.md §2: a draw at any stage makes the whole thing a lottery."""
        self.assertNotIn('draw', presets.ADVANCEMENTS)
        for preset in presets.PRESETS.values():
            for stage in preset.stages:
                self.assertIn(stage.advancement, presets.ADVANCEMENTS, preset.key)

    def test_every_plan_phase_anchor_is_one_personalize_knows(self):
        known = {
            'start', 'start_minus_7', 'registration_opens', 'registration_closes',
            'end', 'complaints_close', 'handover', 'none',
        }
        for phase in presets.PLAN_PHASES:
            self.assertIn(phase.anchor, known, phase.key)
        for phase_name, anchor in presets.TASK_PHASE_ANCHORS.items():
            self.assertIn(anchor, known, phase_name)
        # And every phase a checklist item can carry has an anchor.
        for item in presets.CHECKLIST.values():
            self.assertIn(item.phase, presets.TASK_PHASE_ANCHORS, item.key)

    def test_the_citation_block_says_it_is_not_legal_advice_in_both_languages(self):
        for locale, sentence in (('en', presets.NOT_LEGAL_ADVICE[0]), ('pl', presets.NOT_LEGAL_ADVICE[1])):
            block = presets.citation_block(('kc_919',), locale)
            self.assertIn(sentence, block)

    def test_every_bilingual_pair_has_both_halves(self):
        """House rule 1, applied to the one file on this platform that is allowed to hold copy."""
        pairs = [
            presets.PLAN_TITLE, presets.PLAN_DESCRIPTION, presets.GOAL_TITLE,
            presets.GOAL_DESCRIPTION, presets.POLL_QUESTION, presets.POLL_DESCRIPTION,
            presets.NOT_LEGAL_ADVICE, presets.LAW_HEADING,
            presets.STAGE_STEP_OPENS, presets.STAGE_STEP_CLOSES,
            *presets.POLL_OPTIONS,
            *presets.MARKER_WORDS.values(),
        ]
        for en, pl in pairs:
            self.assertTrue(en.strip(), f'missing English half: {pl}')
            self.assertTrue(pl.strip(), f'missing Polish half: {en}')
            self.assertNotEqual(en, pl, f'untranslated: {en}')
        for phase in presets.PLAN_PHASES:
            self.assertTrue(phase.title_en.strip() and phase.title_pl.strip(), phase.key)
            self.assertTrue(phase.body_en.strip() and phase.body_pl.strip(), phase.key)
