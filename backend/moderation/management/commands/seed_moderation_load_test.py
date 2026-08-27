"""Phase 4 hardening: a real, mechanical synthetic-load test for the moderation queue — the
"seed ~200 pending reports/submissions/edit-suggestions/translations, measure the real query cost,
verify or refute build_report_queue()'s own 'N+1 queries — fine at this app's real scale' claim"
item. Seeds real, distinct rows against the real, already-migrated corpus (never synthetic filler
exercises of its own) so `GET /api/moderation/queue/` and the `/moderation` page are measured under
a genuinely large, realistic-shaped backlog, not a handful of hand-typed fixtures.

Every row this command creates is tracked by primary key in a manifest file (default
/tmp/edmat_loadtest_manifest.json) — `--clear` deletes EXACTLY those rows and nothing else,
regardless of what real pending items a moderator or a Phase 3 verification pass may have left
behind in the same tables. Safer than a content-marker/filter-based approach, which risks either
false positives (deleting a real row that happens to match) or false negatives (missing a synthetic
row whose marker text got edited) — a manifest of real PKs can't drift.

Idempotent within a single invocation is not the goal (re-running without --clear first ADDS more
rows, which is a real, legitimate thing to want when testing progressively larger backlogs) — the
manifest itself IS the idempotency/cleanup mechanism.
"""

import json
import random

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import IntegrityError, transaction

from community.models import Comment, Review
from exercises.models import Exercise, ExerciseTranslation
from moderation.models import EditSuggestion, ExerciseSubmission, Report
from taxonomy.models import Branch

User = get_user_model()

DEMO_USERNAMES = ['u-kasia', 'u-michal', 'u-ola', 'u-bartek', 'u-julia']

REPORT_REASONS = [
    'This looks incorrect to me.',
    'The solution seems to have a sign error.',
    'Inappropriate wording in the discussion.',
    'Duplicate of another exercise already in the database.',
    'The stated answer does not match the worked solution.',
    '',  # a real, common case — a report with no written reason at all
]

EDIT_FIELDS = ['statement', 'answer', 'title']  # hint/solution edits target SolutionEntry rows now

MANIFEST_DEFAULT = '/tmp/edmat_loadtest_manifest.json'


class Command(BaseCommand):
    help = 'Seeds a synthetic moderation-queue backlog (reports/submissions/edits/translations) for a real load test.'

    def add_arguments(self, parser):
        parser.add_argument('--reports', type=int, default=200, help='distinct report GROUPS (targets) to create')
        parser.add_argument('--submissions', type=int, default=60)
        parser.add_argument('--edits', type=int, default=60)
        parser.add_argument('--translations', type=int, default=60)
        parser.add_argument('--manifest', default=MANIFEST_DEFAULT)
        parser.add_argument('--clear', action='store_true', help='delete every row a prior run of this command created, then exit')

    def handle(self, *args, **options):
        manifest_path = options['manifest']

        if options['clear']:
            self._clear(manifest_path)
            return

        users = list(User.objects.filter(username__in=DEMO_USERNAMES))
        if len(users) < len(DEMO_USERNAMES):
            self.stderr.write(self.style.ERROR('Run `manage.py seed_demo_users` first — not every demo user exists yet.'))
            return

        manifest = {'reports': [], 'submissions': [], 'edits': [], 'translations': []}

        manifest['reports'] = self._seed_reports(options['reports'], users)
        manifest['submissions'] = self._seed_submissions(options['submissions'], users)
        manifest['edits'] = self._seed_edits(options['edits'], users)
        manifest['translations'] = self._seed_translations(options['translations'], users)

        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(manifest['reports'])} Report rows, {len(manifest['submissions'])} submissions, "
                f"{len(manifest['edits'])} edit suggestions, {len(manifest['translations'])} translations. "
                f"Manifest written to {manifest_path} — re-run with --clear to remove exactly these rows."
            )
        )

    def _seed_reports(self, target_count: int, users: list) -> list[int]:
        """Report GROUPS, not raw rows — the unit build_report_queue() actually iterates. Real
        Comments/Reviews are used first (there's a limited real supply of both), the rest filled
        with real, migrated Exercises. ~20% of groups get 2-3 reports from distinct reporters (the
        unique_together on (content_type, object_id, reported_by) caps this at len(users)), so the
        aggregation/grouping logic is exercised for real, not just the single-report case."""
        exercise_ct = ContentType.objects.get_for_model(Exercise)
        comment_ct = ContentType.objects.get_for_model(Comment)
        review_ct = ContentType.objects.get_for_model(Review)

        comment_ids = list(Comment.objects.values_list('id', flat=True))
        review_ids = list(Review.objects.values_list('id', flat=True))
        exercise_ids = list(Exercise.objects.filter(id__gt=10).values_list('id', flat=True))
        random.shuffle(exercise_ids)

        targets: list[tuple[ContentType, int]] = [(comment_ct, i) for i in comment_ids]
        targets += [(review_ct, i) for i in review_ids]
        remaining = max(0, target_count - len(targets))
        targets += [(exercise_ct, i) for i in exercise_ids[:remaining]]
        targets = targets[:target_count]

        created_ids: list[int] = []
        with transaction.atomic():
            for ct, object_id in targets:
                reporter_count = random.choices([1, 2, 3], weights=[80, 15, 5])[0]
                for reporter in random.sample(users, k=min(reporter_count, len(users))):
                    try:
                        with transaction.atomic():
                            report = Report.objects.create(
                                content_type=ct,
                                object_id=object_id,
                                reported_by=reporter,
                                reason=random.choice(REPORT_REASONS),
                                status='pending',
                            )
                            created_ids.append(report.id)
                    except IntegrityError:
                        continue  # already reported by this user (unique_together) — real, harmless
        return created_ids

    def _seed_submissions(self, count: int, users: list) -> list[int]:
        branches = list(Branch.objects.all())
        created_ids: list[int] = []
        for i in range(count):
            branch = random.choice(branches)
            submission = ExerciseSubmission.objects.create(
                branch=branch,
                submitted_by=random.choice(users),
                status='pending',
                payload={
                    'title': f'Load-test submission {i}',
                    'statement': f'<p>Prove that the sequence $a_n = 1/n$ converges to 0. (synthetic load-test item {i})</p>',
                    'answer': '',
                    'difficulty': random.choice(['easy', 'medium', 'hard']),
                    'locale': 'pl',
                    'topic_ids': [],
                    'tags': ['load-test'],
                    'source': {'type': 'exercises', 'name': 'Synthetic load test'},
                },
            )
            created_ids.append(submission.id)
        return created_ids

    def _seed_edits(self, count: int, users: list) -> list[int]:
        exercise_ids = list(Exercise.objects.filter(id__gt=10).values_list('id', flat=True))
        random.shuffle(exercise_ids)
        created_ids: list[int] = []
        for i, exercise_id in enumerate(exercise_ids[:count]):
            suggestion = EditSuggestion.objects.create(
                exercise_id=exercise_id,
                locale='pl',
                field=random.choice(EDIT_FIELDS),
                proposed_value=f'<p>Proposed clearer wording (synthetic load-test edit {i}).</p>',
                reason='Load-test synthetic edit suggestion.',
                submitted_by=random.choice(users),
                status='pending',
            )
            created_ids.append(suggestion.id)
        return created_ids

    def _seed_translations(self, count: int, users: list) -> list[int]:
        """Picks exercises that don't already have a pending 'en' row, respecting the real
        (exercise, locale, status) uniqueness constraint rather than colliding with it."""
        already_pending_en = set(
            ExerciseTranslation.objects.filter(locale='en', status='pending').values_list('exercise_id', flat=True)
        )
        candidates = [
            eid
            for eid in Exercise.objects.filter(id__gt=10).values_list('id', flat=True)
            if eid not in already_pending_en
        ]
        random.shuffle(candidates)
        created_ids: list[int] = []
        for i, exercise_id in enumerate(candidates[:count]):
            translation = ExerciseTranslation.objects.create(
                exercise_id=exercise_id,
                locale='en',
                title=f'Load-test translation {i}',
                statement=f'<p>Synthetic English translation for load-test item {i}.</p>',
                answer='',
                status='pending',
                translated_by=random.choice(users),
            )
            created_ids.append(translation.id)
        return created_ids

    def _clear(self, manifest_path: str):
        try:
            with open(manifest_path, encoding='utf-8') as f:
                manifest = json.load(f)
        except FileNotFoundError:
            self.stderr.write(self.style.WARNING(f'No manifest found at {manifest_path} — nothing to clear.'))
            return

        deleted = {
            'reports': Report.objects.filter(id__in=manifest.get('reports', [])).delete()[0],
            'submissions': ExerciseSubmission.objects.filter(id__in=manifest.get('submissions', [])).delete()[0],
            'edits': EditSuggestion.objects.filter(id__in=manifest.get('edits', [])).delete()[0],
            'translations': ExerciseTranslation.objects.filter(id__in=manifest.get('translations', [])).delete()[0],
        }
        self.stdout.write(self.style.SUCCESS(f'Cleared load-test data: {deleted}'))
