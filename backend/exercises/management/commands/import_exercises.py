"""Imports a batch of exercises (*zadania*) from Markdown files into the live models.

**Why this exists next to `import_legacy_corpus`.** That command is the one-time migration of
`Database-of-Student-Exercise/content/`, and it has not run since the taxonomy restructure
(`Field` → `Discipline`, `Course` → `Branch`, commit 420bf41): it still writes `field=` and
`university=`, and still globs a `branches/` directory the source corpus does not have. It is kept
as provenance for how the 742 corpus rows got here, not as a tool. This command is the tool: same
file format, current schema, any branch, any batch — one directory of `.md` files in, real
`Exercise` + `ExerciseTranslation` + `SolutionEntry` rows out.

**Idempotent by `(branch, number)`**, the exercise's own natural key and its `unique_together`. A
file that carries `number:` can be re-imported forever and only ever updates its row. A file without
one gets the next free number allocated and — unless `--no-write-back` — that number written back
into its front matter, because a batch whose numbers live only in the database is a batch that
duplicates itself the second time somebody runs it.

**What it deliberately does not do**, each for a reason the rest of the codebase already holds:

- `verified` is never read from a file. It is DERIVED (`exercises/signals.py:recount_verified` —
  "a published solution that is pinned, reviewed, or written by a verified contributor"), so the
  importer writes the solution and then asks for the recount. A `verified:` key in the front matter
  is a validation error rather than a silently ignored line.
- No activity row (house rule 9: the feed records what a person did in public, and an import is not
  that) and no tag-follower notification (an import would mail everybody at once).
- Tags are **added, never replaced** — any authenticated user may apply a tag, so `.set()` from a
  file would quietly undo the community's work on every re-run. Topics ARE replaced: they are the
  structural claim the file is making. Dropping a tag from a file therefore does not drop it from
  the exercise; do that in the UI.
- Nothing here sanitizes anything, and nothing here needs to: `ExerciseTranslation.save()` and
  `SolutionEntry.save()` both run `config.sanitize.sanitize_content` themselves — the one choke
  point every write path shares (house rule 8). So the stored body is the file's Markdown + allowed
  raw HTML + literal `\\( … \\)` / `\\[ … \\]`, with disallowed HTML dropped; maths is stashed before
  bleach sees it, so `\\(p<\\infty\\)` survives intact. A `<script>` in a source file is simply gone
  from the row, not refused — if you need to know that happened, diff the file against the row.

Usage:
    python manage.py import_exercises <dir> --branch <branch-slug> [--dry-run]

See `.claude/skills/import-exercises/SKILL.md` for the file format and the whole procedure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any

import yaml
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from config.audience import AUDIENCE_VALUES, DEFAULT_AUDIENCE
from taxonomy.models import Branch, Topic, TopicTranslation

from ...models import (
    Exercise,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExerciseTranslation,
    SolutionEntry,
    Tag,
)
from ...signals import recount_verified

#: Polish is what the corpus and every real contributor writes; English is accepted so a batch
#: translated by a tool does not have to be translated back before it can be imported.
DIFFICULTY_ALIASES = {
    'łatwe': 'easy', 'latwe': 'easy', 'easy': 'easy',
    'średnie': 'medium', 'srednie': 'medium', 'medium': 'medium',
    'trudne': 'hard', 'hard': 'hard',
}
SOURCE_TYPE_ALIASES = {
    'ćwiczenia': 'exercises', 'cwiczenia': 'exercises', 'exercises': 'exercises',
    'kolokwium': 'midterm', 'midterm': 'midterm',
    'egzamin': 'exam', 'exam': 'exam',
    'inne': 'other', 'other': 'other',
}
SECTION_ALIASES = {
    'treść': 'statement', 'tresc': 'statement', 'statement': 'statement',
    'wskazówka': 'hint', 'wskazowka': 'hint', 'hint': 'hint',
    'odpowiedź': 'answer', 'odpowiedz': 'answer', 'answer': 'answer',
    'rozwiązanie': 'solution', 'rozwiazanie': 'solution', 'solution': 'solution',
}
SECTION_NAMES = sorted({k for k in SECTION_ALIASES})

#: Front-matter keys this command understands. Anything else is a typo until proven otherwise — a
#: silently ignored `tag:` or `dificulty:` is exactly the kind of loss a batch import must not have.
KNOWN_KEYS = {
    'id', 'number', 'title', 'topics', 'difficulty', 'audience', 'source', 'tags',
    'published', 'locale',
}

FRONT_MATTER = re.compile(r'\A---\s*\n(.*?)\n---\s*\n(.*)\Z', re.S)
HEADING = re.compile(r'^##\s+(.+?)\s*$')


@dataclass
class Parsed:
    """One source file, already split and normalised. `number=None` means "allocate me one"."""

    path: Path
    number: int | None = None
    title: str = ''
    topics: list[str] = dataclass_field(default_factory=list)
    difficulty: str = ''
    audience: str = DEFAULT_AUDIENCE
    source: dict[str, Any] = dataclass_field(default_factory=dict)
    tags: list[str] = dataclass_field(default_factory=list)
    published: bool = True
    locale: str = 'pl'
    statement: str = ''
    hint: str = ''
    answer: str = ''
    solution: str = ''


def split_file(path: Path) -> tuple[dict[str, Any], dict[str, str], list[str]]:
    """Front matter + `##`-delimited sections. Returns (meta, sections, errors)."""
    errors: list[str] = []
    raw = path.read_text(encoding='utf-8')
    match = FRONT_MATTER.match(raw)
    if not match:
        return {}, {}, ['no YAML front matter (the file must start with a `---` line)']
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        return {}, {}, [f'front matter is not valid YAML: {exc}']
    if not isinstance(meta, dict):
        return {}, {}, ['front matter must be a mapping of keys to values']

    buckets: dict[str, list[str]] = {}
    current: str | None = None
    for line in match.group(2).splitlines():
        heading = HEADING.match(line)
        if heading:
            name = heading.group(1).strip().lower()
            current = SECTION_ALIASES.get(name)
            if current is None:
                errors.append(
                    f'unknown section heading "## {heading.group(1).strip()}" — its text would be '
                    f'dropped; allowed: {", ".join(SECTION_NAMES)}'
                )
            else:
                buckets.setdefault(current, [])
            continue
        if current is not None and current in buckets:
            buckets[current].append(line)
    return meta, {k: '\n'.join(v).strip() for k, v in buckets.items()}, errors


def check_math(label: str, body: str) -> list[str]:
    """Unbalanced LaTeX delimiters are the one content defect that survives every other check and
    then renders as literal backslashes on the page (root CLAUDE.md "Content pipeline"). Counting is
    enough to catch the real failure — a `\\(` whose `\\)` was lost to a copy/paste."""
    problems = []
    for open_delim, close_delim in (('\\(', '\\)'), ('\\[', '\\]')):
        if body.count(open_delim) != body.count(close_delim):
            problems.append(
                f'{label}: {body.count(open_delim)}× "{open_delim}" but '
                f'{body.count(close_delim)}× "{close_delim}" — unbalanced maths'
            )
    return problems


class Command(BaseCommand):
    help = 'Imports a directory of exercise Markdown files into a branch (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('directory', help='Directory of *.md exercise files (searched recursively).')
        parser.add_argument('--branch', help='Target branch slug. Overrides batch.yaml.')
        parser.add_argument('--locale', help='Original locale of these bodies (default: pl).')
        parser.add_argument('--audience', help=f'Audience band for rows that do not name one. One of: {", ".join(AUDIENCE_VALUES)}.')
        parser.add_argument('--author', help='Username to credit as submitter/solution author (default: nobody, as for corpus rows).')
        parser.add_argument('--create-topics', action='store_true', help='Create topic rows the files reference but the branch lacks.')
        parser.add_argument('--no-write-back', action='store_true', help='Do not write allocated numbers back into the source files.')
        parser.add_argument('--dry-run', action='store_true', help='Validate and roll back; changes nothing.')

    # ---- reading ---------------------------------------------------------------------------

    def collect_files(self, directory: Path) -> list[Path]:
        files = [
            p for p in sorted(directory.rglob('*.md'))
            if not p.name.startswith('_') and p.name.lower() != 'readme.md'
        ]
        if not files:
            raise CommandError(f'No *.md exercise files under {directory}')
        return files

    def load_batch_defaults(self, directory: Path) -> dict[str, Any]:
        """`batch.yaml` beside the files: `branch`, `locale`, `audience`, `difficulty`,
        `topic_names: {slug: name}`. Optional — everything in it can be given as a flag instead,
        and a flag wins."""
        path = directory / 'batch.yaml'
        if not path.exists():
            return {}
        data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
        if not isinstance(data, dict):
            raise CommandError(f'{path} must be a mapping')
        return data

    def parse(self, path: Path, defaults: dict[str, Any], options: dict[str, Any]) -> tuple[Parsed, list[str]]:
        meta, sections, errors = split_file(path)
        item = Parsed(path=path)
        if errors and not meta:
            return item, errors

        for key in meta:
            if key not in KNOWN_KEYS:
                if key == 'verified':
                    errors.append(
                        '`verified:` is not an input — Exercise.verified is derived from the '
                        'solution pool (exercises/signals.py:recount_verified). Remove the key; '
                        'a published, pinned `## Rozwiązanie` is what makes a row verified.'
                    )
                else:
                    errors.append(f'unknown front-matter key `{key}:` (allowed: {", ".join(sorted(KNOWN_KEYS))})')

        raw_number = meta.get('number')
        if raw_number is not None:
            try:
                item.number = int(raw_number)
            except (TypeError, ValueError):
                errors.append(f'`number: {raw_number!r}` is not an integer')
            else:
                if item.number < 1:
                    errors.append('`number:` must be 1 or greater')

        item.title = str(meta.get('title') or '').strip()
        if not item.title:
            errors.append('`title:` is required')

        raw_difficulty = str(meta.get('difficulty') or '').strip().lower()
        if not raw_difficulty:
            raw_difficulty = str(defaults.get('difficulty') or '').strip().lower()
        item.difficulty = DIFFICULTY_ALIASES.get(raw_difficulty, '')
        if not item.difficulty:
            errors.append(
                f'`difficulty:` is required and must be one of {", ".join(sorted(DIFFICULTY_ALIASES))} '
                f'(got {raw_difficulty!r})'
            )

        audience = str(
            meta.get('audience') or options.get('audience') or defaults.get('audience') or DEFAULT_AUDIENCE
        ).strip()
        if audience not in AUDIENCE_VALUES:
            errors.append(f'`audience: {audience}` is not one of {", ".join(AUDIENCE_VALUES)}')
        else:
            item.audience = audience

        item.locale = str(
            meta.get('locale') or options.get('locale') or defaults.get('locale') or 'pl'
        ).strip()

        topics = meta.get('topics') or []
        if isinstance(topics, str):
            topics = [topics]
        item.topics = [str(t).strip() for t in topics if str(t).strip()]

        tags = meta.get('tags') or []
        if isinstance(tags, str):
            tags = [tags]
        item.tags = [str(t).strip() for t in tags if str(t).strip()]

        item.published = bool(meta.get('published', True))

        source = meta.get('source') or {}
        if source and not isinstance(source, dict):
            errors.append('`source:` must be a mapping, e.g. `source: {type: Egzamin, name: ...}`')
            source = {}
        if source:
            raw_type = str(source.get('type') or '').strip()
            resolved = SOURCE_TYPE_ALIASES.get(raw_type.lower())
            if resolved is None and raw_type:
                # Deliberately not an error: the real corpus carries free-text source types
                # ("Materiały dodatkowe") that have no code, and `other` is what that means.
                self.stdout.write(
                    self.style.WARNING(f'  {path.name}: source type {raw_type!r} → "other"')
                )
            item.source = dict(source)
            item.source['type'] = resolved or 'other'

        item.statement = sections.get('statement', '')
        item.hint = sections.get('hint', '')
        item.answer = sections.get('answer', '')
        item.solution = sections.get('solution', '')
        if not item.statement.strip():
            errors.append('`## Treść` (statement) is empty — an exercise is its statement')

        for label, body in (
            ('title', item.title), ('statement', item.statement), ('hint', item.hint),
            ('answer', item.answer), ('solution', item.solution),
        ):
            errors.extend(check_math(label, body))

        return item, errors

    # ---- writing ---------------------------------------------------------------------------

    def resolve_branch(self, slug: str | None) -> Branch:
        if not slug:
            raise CommandError(
                'No target branch: pass --branch <slug> or put `branch: <slug>` in batch.yaml. '
                'Existing: ' + ', '.join(Branch.objects.values_list('slug', flat=True))
            )
        branch = Branch.objects.filter(slug=slug).first()
        if branch is None:
            raise CommandError(
                f'No branch with slug {slug!r}. Existing: '
                + ', '.join(Branch.objects.values_list('slug', flat=True))
                + '. A new branch is a taxonomy decision — create it in the UI or the admin, not here.'
            )
        if branch.status != 'approved':
            self.stdout.write(self.style.WARNING(
                f'Branch {branch.slug} is still {branch.status}; its exercises will import but the '
                'branch itself is not approved yet.'
            ))
        return branch

    def resolve_topics(self, branch: Branch, slugs: set[str], names: dict[str, str], create: bool, stats: dict) -> dict[str, Topic]:
        existing = {t.slug: t for t in branch.topics.all()}
        missing = sorted(slugs - set(existing))
        if missing and not create:
            raise CommandError(
                f'Topics not in branch {branch.slug}: {", ".join(missing)}. Either fix the slugs or '
                'pass --create-topics (and give their Polish names in batch.yaml under `topic_names:`).'
            )
        next_order = (branch.topics.count() or 0)
        for slug in missing:
            topic, created = Topic.objects.get_or_create(
                branch=branch, slug=slug, defaults={'order': next_order, 'status': 'approved'}
            )
            TopicTranslation.objects.get_or_create(
                topic=topic, locale='pl', defaults={'name': names.get(slug) or slug.replace('-', ' ')}
            )
            existing[slug] = topic
            next_order += 1
            if created:
                stats['topics'] += 1
        return existing

    def apply(self, item: Parsed, number: int, branch: Branch, topics: dict[str, Topic], author, stats: dict) -> Exercise:
        # No sanitizing step here on purpose — both target models do it in their own save().
        bodies = {
            'statement': item.statement, 'answer': item.answer,
            'hint': item.hint, 'solution': item.solution,
        }

        defaults = {
            'difficulty': item.difficulty,
            'audience': item.audience,
            'published': item.published,
            'original_locale': item.locale,
            'submitted_by': author,
        }
        # An import never RAISES visibility on a row that already exists. `published=False` on a live
        # exercise is somebody's decision — a moderator's removal, or community reports crossing the
        # auto-hide threshold (`auto_hidden_at`) — and a re-run of the batch it came from is not an
        # appeal. It can still hide a row (`published: false` in the file), because that direction
        # takes nothing away from anyone.
        existing = Exercise.objects.filter(branch=branch, number=number).first()
        if existing is not None and not existing.published and item.published:
            del defaults['published']
            reason = 'auto-hidden by reports' if existing.auto_hidden_at else 'unpublished'
            self.stdout.write(self.style.WARNING(
                f'  {item.path.name}: #{number} is {reason} — left hidden. Republish it in the '
                'moderation UI if that is what you mean.'
            ))

        exercise, created = Exercise.objects.update_or_create(
            branch=branch, number=number, defaults=defaults
        )
        stats['created' if created else 'updated'] += 1

        exercise.topics.set([topics[s] for s in item.topics if s in topics])
        if item.tags:
            tag_rows = [Tag.objects.get_or_create(slug=slug)[0] for slug in item.tags]
            # add(), not set() — see this module's docstring: a tag may have come from a reader.
            exercise.tags.add(*tag_rows)

        if item.source:
            source, _ = ExerciseSource.objects.update_or_create(
                exercise=exercise,
                defaults={
                    'type': item.source.get('type', 'other'),
                    'collection': str(item.source.get('collection') or ''),
                    'original_problem_number': item.source.get('original_problem_number'),
                    'pages': str(item.source.get('pages')) if item.source.get('pages') is not None else '',
                    'chapter': item.source.get('chapter'),
                },
            )
            if item.source.get('name'):
                ExerciseSourceTranslation.objects.update_or_create(
                    source=source, locale=item.locale, defaults={'name': str(item.source['name'])}
                )

        # The original is a row in the translation table like any other (root CLAUDE.md "Shapes
        # that repeat"), keyed with status='published' because the partial unique constraint allows
        # exactly one of those per locale — a pending or rejected row for the same locale is legal
        # and must not be touched.
        ExerciseTranslation.objects.update_or_create(
            exercise=exercise,
            locale=item.locale,
            status='published',
            defaults={
                'title': item.title,
                'statement': bodies['statement'],
                'answer': bodies['answer'],
                'translated_by': None,
            },
        )

        for kind in ('hint', 'solution'):
            body = bodies[kind]
            if body.strip():
                SolutionEntry.objects.update_or_create(
                    exercise=exercise,
                    kind=kind,
                    locale=item.locale,
                    pinned=True,
                    defaults={'body': body, 'author': author, 'status': 'published'},
                )
                stats['entries'] += 1
        # The entry signals already recount, but an import that wrote no entry at all still needs
        # `verified` to be right for this row — and the recount is two cheap COUNTs (house rule 5).
        recount_verified(exercise.pk)
        return exercise

    def write_back(self, path: Path, number: int) -> None:
        raw = path.read_text(encoding='utf-8')
        match = FRONT_MATTER.match(raw)
        if not match or re.search(r'^number:', match.group(1), re.M):
            return
        path.write_text(f'---\nnumber: {number}\n{match.group(1)}\n---\n{match.group(2)}', encoding='utf-8')

    # ---- the run ---------------------------------------------------------------------------

    def handle(self, *args, **options):
        directory = Path(options['directory']).expanduser()
        if not directory.is_dir():
            raise CommandError(f'Not a directory: {directory}')
        defaults = self.load_batch_defaults(directory)
        files = self.collect_files(directory)

        parsed: list[Parsed] = []
        failures: list[str] = []
        for path in files:
            item, errors = self.parse(path, defaults, options)
            if errors:
                failures.extend(f'{path}: {e}' for e in errors)
            else:
                parsed.append(item)

        # Numbers that collide inside the batch itself: two files claiming one row would make the
        # second silently overwrite the first, which looks like a successful import.
        claimed: dict[int, Path] = {}
        for item in parsed:
            if item.number is None:
                continue
            if item.number in claimed:
                failures.append(f'{item.path}: `number: {item.number}` is also claimed by {claimed[item.number]}')
            claimed[item.number] = item.path

        if failures:
            self.stderr.write(self.style.ERROR(f'{len(failures)} problem(s); nothing was imported:'))
            for line in failures:
                self.stderr.write(f'  - {line}')
            raise CommandError('Fix the files above and run again.')

        branch = self.resolve_branch(options.get('branch') or defaults.get('branch'))
        author = None
        if options.get('author'):
            author = get_user_model().objects.filter(username=options['author']).first()
            if author is None:
                raise CommandError(f'No user named {options["author"]!r} to credit.')

        stats = {'created': 0, 'updated': 0, 'entries': 0, 'topics': 0}
        dry_run = options['dry_run']
        allocated: list[tuple[Path, int]] = []

        with transaction.atomic():
            topics = self.resolve_topics(
                branch,
                {s for item in parsed for s in item.topics},
                dict(defaults.get('topic_names') or {}),
                options['create_topics'],
                stats,
            )
            highest = (
                Exercise.objects.filter(branch=branch).order_by('-number')
                .values_list('number', flat=True).first() or 0
            )
            # From the branch's own highest number upwards, stepping over anything a file in this
            # batch claimed explicitly — an imported sheet that numbers itself 9001 should not push
            # every unnumbered sibling into the 9000s.
            next_free = highest + 1
            for item in parsed:
                number = item.number
                if number is None:
                    while next_free in claimed:
                        next_free += 1
                    number = next_free
                    claimed[number] = item.path
                    next_free += 1
                    allocated.append((item.path, number))
                exercise = self.apply(item, number, branch, topics, author, stats)
                if options['verbosity'] >= 1:
                    self.stdout.write(f'  {item.path.name} → {branch.slug} #{exercise.number} "{item.title}"')
            if dry_run:
                self.stdout.write(self.style.WARNING('--dry-run: rolling the transaction back.'))
                transaction.set_rollback(True)

        if allocated and not dry_run and not options['no_write_back']:
            for path, number in allocated:
                self.write_back(path, number)
            self.stdout.write(
                f'Wrote `number:` back into {len(allocated)} file(s) — that is what makes a re-run '
                'update these rows instead of adding new ones.'
            )
        elif allocated and (dry_run or options['no_write_back']):
            self.stdout.write(self.style.WARNING(
                f'{len(allocated)} file(s) have no `number:`; their numbers were not written back, '
                'so a re-run would create NEW exercises for them.'
            ))

        self.stdout.write(self.style.SUCCESS(
            '{created} created, {updated} updated, {entries} hint/solution row(s), '
            '{topics} new topic(s).'.format(**stats)
        ))
        if not dry_run:
            self.stdout.write(
                'Now re-run the content sweep: `manage.py dump_text_fields` then '
                '`npm run check:katex` in frontend/.'
            )
