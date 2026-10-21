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
- **The licence is declared, never assumed** (licensing/, 2026-10-14). `licence:` per file, in
  `batch.yaml`, or `--licence`; absent everywhere means `unknown` — "rights not yet clarified",
  shown with a "for study only" line — because an import is somebody else's material more often
  than not (LEGAL.md §3) and the person running the command is not its author. A key the registry
  does not know is refused. A re-run only ever WIDENS an existing row's licence
  (`licensing.licences.at_least_as_open`), recording the change; a narrower file is warned about
  and left, since a Creative Commons grant cannot be taken back.
- Nothing here sanitizes anything, and nothing here needs to: `ExerciseTranslation.save()` and
  `SolutionEntry.save()` both run `config.sanitize.sanitize_content` themselves — the one choke
  point every write path shares (house rule 8). So the stored body is the file's Markdown + allowed
  raw HTML + literal `\\( … \\)` / `\\[ … \\]`, with disallowed HTML dropped; maths is stashed before
  bleach sees it, so `\\(p<\\infty\\)` survives intact. A `<script>` in a source file is simply gone
  from the row, not refused — if you need to know that happened, diff the file against the row.

**Parts** (`SUBEXERCISES-BRIEF.md` §4, 2026-10-21). A set-shaped exercise — one shared statement,
several items each with its own answer, hints and solutions — is written with `## Podpunkt <label>`
/ `## Part <label>` headings AFTER the whole-exercise sections; every section that follows a part
heading belongs to that part, until the next one. Parts are keyed by `(exercise, order)`, so a
re-run updates a part's text in place and never duplicates it. **For a file with parts the file is
the truth for the set**: parts beyond the file's count are deleted with their entries, and a pinned
entry this command wrote earlier (same `--author`) for a section the file no longer has — the whole
exercise's or a part's — is deleted too, which is what turns an old one-solution-for-all-four row
into four parts without leaving the old solution beside them. A file WITHOUT part sections leaves
an exercise's existing parts alone (additive, like tags).

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
from licensing.licences import LICENCE_VALUES, UNKNOWN, at_least_as_open
from taxonomy.models import Branch, Topic, TopicTranslation

from ...models import (
    Exercise,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExercisePart,
    ExercisePartTranslation,
    ExerciseTranslation,
    SolutionEntry,
    Tag,
)
from ...parts import MAX_PARTS
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

#: `## Podpunkt a` / `## Part a` opens part "a" (SUBEXERCISES-BRIEF.md §4). The label is the free
#: text after the keyword, shown to readers as written, so its case is kept; `ExercisePart.label`
#: is 20 characters.
PART_HEADING = re.compile(r'^(?:podpunkt|part)(?:\s+(?P<label>.*))?$', re.I)
PART_LABEL_MAX = 20

#: Front-matter keys this command understands. Anything else is a typo until proven otherwise — a
#: silently ignored `tag:` or `dificulty:` is exactly the kind of loss a batch import must not have.
KNOWN_KEYS = {
    'id', 'number', 'title', 'topics', 'difficulty', 'audience', 'source', 'tags',
    'published', 'locale', 'licence',
}

FRONT_MATTER = re.compile(r'\A---\s*\n(.*?)\n---\s*\n(.*)\Z', re.S)
HEADING = re.compile(r'^##\s+(.+?)\s*$')


@dataclass
class ParsedPart:
    """One `## Podpunkt <label>` block: its sub-statement (required) and its own answer, hint and
    solution. Its position in `Parsed.parts`, from 1, becomes `ExercisePart.order` — the key a
    re-run updates by."""

    label: str
    statement: str = ''
    hint: str = ''
    answer: str = ''
    solution: str = ''


@dataclass
class Parsed:
    """One source file, already split and normalised. `number=None` means "allocate me one"."""

    path: Path
    number: int | None = None
    title: str = ''
    topics: list[str] = dataclass_field(default_factory=list)
    difficulty: str = ''
    audience: str = DEFAULT_AUDIENCE
    licence: str = UNKNOWN
    source: dict[str, Any] = dataclass_field(default_factory=dict)
    tags: list[str] = dataclass_field(default_factory=list)
    published: bool = True
    locale: str = 'pl'
    statement: str = ''
    hint: str = ''
    answer: str = ''
    solution: str = ''
    parts: list[ParsedPart] = dataclass_field(default_factory=list)


def split_file(path: Path) -> tuple[dict[str, Any], dict[str, str], list[tuple[str, dict[str, str]]], list[str]]:
    """Front matter + `##`-delimited sections. Returns (meta, sections, parts, errors).

    `sections` are the whole-exercise ones — everything before the first part heading. `parts` is
    `[(label, sections), …]` in file order, one per `## Podpunkt <label>` / `## Part <label>`;
    every section after a part heading belongs to that part until the next one, so the order is
    "whole first, then parts" and the file reads like the page.

    A section named twice in one scope (twice at the top, or twice inside one part) is refused:
    the second body would otherwise be glued onto the first without a word, and inside a part it
    is the shape of the one mistake this layout invites — a whole-exercise `## Odpowiedź` written
    at the END of the file, after the parts, which can only ever be read as the last part's. None
    of the 1,974 corpus files names a section twice (checked 2026-10-21), so this refuses nothing
    that used to import.
    """
    errors: list[str] = []
    raw = path.read_text(encoding='utf-8')
    match = FRONT_MATTER.match(raw)
    if not match:
        return {}, {}, [], ['no YAML front matter (the file must start with a `---` line)']
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        return {}, {}, [], [f'front matter is not valid YAML: {exc}']
    if not isinstance(meta, dict):
        return {}, {}, [], ['front matter must be a mapping of keys to values']

    whole: dict[str, list[str]] = {}
    parts: list[tuple[str, dict[str, list[str]]]] = []
    scope = whole           # the bucket set the next section opens in
    scope_name = 'the whole exercise'
    current: str | None = None
    for line in match.group(2).splitlines():
        heading = HEADING.match(line)
        if heading:
            text = heading.group(1).strip()
            part = PART_HEADING.match(text)
            if part:
                label = (part.group('label') or '').strip()
                current = None
                if not label:
                    errors.append(
                        f'"## {text}" has no label — write the label after the keyword, '
                        'e.g. "## Podpunkt a" or "## Part 1"'
                    )
                elif len(label) > PART_LABEL_MAX:
                    errors.append(
                        f'part label "{label}" is {len(label)} characters; the most is '
                        f'{PART_LABEL_MAX} — a label is "a", "1", "ii", not a sentence'
                    )
                scope = {}
                parts.append((label, scope))
                scope_name = f'part "{label}"'
                continue
            name = text.lower()
            current = SECTION_ALIASES.get(name)
            if current is None:
                errors.append(
                    f'unknown section heading "## {text}" — its text would be '
                    f'dropped; allowed: {", ".join(SECTION_NAMES)}, or '
                    '"Podpunkt <label>" / "Part <label>" to open a part'
                )
            elif current in scope:
                errors.append(
                    f'"## {text}" appears twice in {scope_name} — the second body would be glued '
                    'onto the first. Every section after a part heading belongs to that part; '
                    'whole-exercise sections go before the first part.'
                )
                current = None
            else:
                scope[current] = []
            continue
        if current is not None and current in scope:
            scope[current].append(line)
        elif scope is not whole and line.strip() and '_loose' not in scope:
            # Text straight under a part heading is the natural way to write a sub-statement and
            # would be dropped without a word; the statement section is required inside a part.
            scope['_loose'] = []
            errors.append(
                f'text directly under the heading of {scope_name} is outside any section and '
                'would be dropped — put the sub-statement under "## Treść" inside the part'
            )

    def joined(buckets: dict[str, list[str]]) -> dict[str, str]:
        return {k: '\n'.join(v).strip() for k, v in buckets.items() if k != '_loose'}

    return meta, joined(whole), [(label, joined(b)) for label, b in parts], errors


def count_delimiters(body: str) -> dict[str, int]:
    """Count the four maths delimiters, stepping over `\\\\` — which is a LaTeX line break, not an
    escaped delimiter.

    `body.count('\\[')` cannot be used for this, and that is not a nicety: `\\\\[3mm]` (a line break
    asking for 3mm of extra leading) is ordinary punctuation inside a `cases` or `aligned` block,
    and a plain count reads the `\\[` inside it as display maths that never closes — the `]` is a
    bare bracket. Of the 954 files in the 2026-10-13 batch, 73 use it, including 11 that had to be
    imported; every one of them "failed" a check that nothing was wrong with. Walking the string
    and consuming both characters of a `\\\\` keeps the scan aligned on real escape boundaries, so a
    genuine `\\(` with no `\\)` is still counted exactly once.
    """
    counts = {'\\(': 0, '\\)': 0, '\\[': 0, '\\]': 0}
    index = 0
    while index < len(body) - 1:
        if body[index] != '\\':
            index += 1
            continue
        pair = body[index:index + 2]
        if pair in counts:
            counts[pair] += 1
        # Two characters either way: for `\\\\` that is the whole line break, leaving `[3mm]` as the
        # plain text it is; for any other escape it is the escape and the character it escapes.
        index += 2
    return counts


def check_math(label: str, body: str) -> list[str]:
    """Unbalanced LaTeX delimiters are the one content defect that survives every other check and
    then renders as literal backslashes on the page (root CLAUDE.md "Content pipeline"). Counting is
    enough to catch the real failure — a `\\(` whose `\\)` was lost to a copy/paste."""
    problems = []
    counts = count_delimiters(body)
    for open_delim, close_delim in (('\\(', '\\)'), ('\\[', '\\]')):
        if counts[open_delim] != counts[close_delim]:
            problems.append(
                f'{label}: {counts[open_delim]}× "{open_delim}" but '
                f'{counts[close_delim]}× "{close_delim}" — unbalanced maths'
            )
    return problems


#: The concept importer's directory inside a kit (`import_concepts`, its reference/concepts.md).
#: Skipped by `collect_files` at any depth below the directory given.
CONCEPT_PAGES_DIR = 'pojecia'


class Command(BaseCommand):
    help = 'Imports a directory of exercise Markdown files into a branch (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('directory', help='Directory of *.md exercise files (searched recursively).')
        parser.add_argument('--branch', help='Target branch slug. Overrides batch.yaml.')
        parser.add_argument('--locale', help='Original locale of these bodies (default: pl).')
        parser.add_argument('--audience', help=f'Audience band for rows that do not name one. One of: {", ".join(AUDIENCE_VALUES)}.')
        parser.add_argument('--licence', help=f'Licence for rows that do not name one (default: {UNKNOWN}). One of: {", ".join(LICENCE_VALUES)}.')
        parser.add_argument('--author', help='Username to credit as submitter/solution author (default: nobody, as for corpus rows).')
        parser.add_argument('--create-topics', action='store_true', help='Create topic rows the files reference but the branch lacks.')
        parser.add_argument('--no-write-back', action='store_true', help='Do not write allocated numbers back into the source files.')
        parser.add_argument('--dry-run', action='store_true', help='Validate and roll back; changes nothing.')

    # ---- reading ---------------------------------------------------------------------------

    def collect_files(self, directory: Path) -> list[Path]:
        # A kit's `<branch>/pojecia/` holds CONCEPT pages for `import_concepts` (§17CW), beside
        # `<branch>/zadania/` and the `batch.yaml` this command must be pointed at the branch
        # directory to read — so without this skip a kit carrying both refuses here with every
        # concept page "an exercise with no statement" (found 2026-10-21 on the algebra kit).
        files = [
            p for p in sorted(directory.rglob('*.md'))
            if not p.name.startswith('_') and p.name.lower() != 'readme.md'
            and CONCEPT_PAGES_DIR not in p.relative_to(directory).parts[:-1]
        ]
        if not files:
            raise CommandError(f'No *.md exercise files under {directory}')
        return files

    def load_batch_defaults(self, directory: Path) -> dict[str, Any]:
        """`batch.yaml` beside the files: `branch`, `locale`, `audience`, `licence`, `difficulty`,
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
        meta, sections, raw_parts, errors = split_file(path)
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

        licence = str(
            meta.get('licence') or options.get('licence') or defaults.get('licence') or UNKNOWN
        ).strip()
        if licence not in LICENCE_VALUES:
            errors.append(f'`licence: {licence}` is not one of {", ".join(LICENCE_VALUES)}')
        else:
            item.licence = licence

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
            # `ExerciseSource` keeps these two as integers, and `update_or_create` hands a bad one
            # straight to the database layer: before this check, a `source: {original_problem_number:
            # 11a}` (a sub-problem letter, which the real corpus does carry) came back as a
            # `ValueError` traceback from deep inside the SQL compiler, naming no file — in the
            # middle of the transaction, after the valid rows had already been written and rolled
            # back. A refusal has to carry its reason and its filename (house rule 6).
            for numeric_key in ('original_problem_number', 'chapter'):
                raw_value = source.get(numeric_key)
                if raw_value is None or raw_value == '':
                    item.source.pop(numeric_key, None)
                    continue
                try:
                    item.source[numeric_key] = int(raw_value)
                except (TypeError, ValueError):
                    errors.append(
                        f'`source.{numeric_key}: {raw_value!r}` is not an integer — that column is '
                        'a number. A sub-problem letter belongs in `source.name` '
                        '("..., zadanie 11a"), which is free text.'
                    )

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

        if len(raw_parts) > MAX_PARTS:
            errors.append(
                f'{len(raw_parts)} parts; the most is {MAX_PARTS} (`exercises/parts.py: MAX_PARTS`, '
                'the same cap the edit form has) — a set with more items than the alphabet has '
                'letters is a sheet, and is several exercises'
            )
        seen_labels: set[str] = set()
        for label, part_sections in raw_parts:
            part = ParsedPart(
                label=label,
                statement=part_sections.get('statement', ''),
                hint=part_sections.get('hint', ''),
                answer=part_sections.get('answer', ''),
                solution=part_sections.get('solution', ''),
            )
            item.parts.append(part)
            if not label:
                continue  # already refused by split_file, with its reason
            if label in seen_labels:
                errors.append(
                    f'two parts are labelled "{label}" — a reader could not tell them apart; '
                    'every part label in a file must be different'
                )
            seen_labels.add(label)
            if not part.statement.strip():
                errors.append(
                    f'part "{label}" has no `## Treść` (or it is empty) — a part is its '
                    'sub-statement; the shared statement goes before the first part'
                )
            for section, body in (
                ('statement', part.statement), ('hint', part.hint),
                ('answer', part.answer), ('solution', part.solution),
            ):
                errors.extend(check_math(f'part "{label}" {section}', body))

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
        # In `topic_names:` order, not alphabetical: `order` is what the browse page sorts a
        # branch's topics by, and a syllabus read alphabetically is a syllabus in the wrong order —
        # "Przestrzenie ilorazowe" is the last thing Topologia I teaches and the fourth word of the
        # alphabet's answer. A slug the batch file never named still falls back to alphabetical.
        ordering = list(names)
        missing = sorted(
            slugs - set(existing),
            key=lambda slug: (ordering.index(slug) if slug in ordering else len(ordering), slug),
        )
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

        if existing is None:
            defaults['licence'] = item.licence

        exercise, created = Exercise.objects.update_or_create(
            branch=branch, number=number, defaults=defaults
        )
        stats['created' if created else 'updated'] += 1
        if not created and exercise.licence != item.licence:
            self._relicense(exercise, item)

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
                'licence': exercise.licence,
            },
        )

        for kind in ('hint', 'solution'):
            body = bodies[kind]
            if body.strip():
                # `part=None` is in the key, and must be: without it a part's pinned solution IS a
                # pinned solution of this exercise in this locale, so the whole exercise's would
                # overwrite it — or, with two parts solved, raise MultipleObjectsReturned.
                SolutionEntry.objects.update_or_create(
                    exercise=exercise,
                    part=None,
                    kind=kind,
                    locale=item.locale,
                    pinned=True,
                    defaults={
                        'body': body,
                        'author': author,
                        'status': 'published',
                        'licence': exercise.licence,
                    },
                )
                stats['entries'] += 1
            elif item.parts:
                self._drop_stale_entry(exercise, None, kind, item, author, stats)

        if item.parts:
            self.apply_parts(exercise, item, author, stats)
        # The entry signals already recount, but an import that wrote no entry at all still needs
        # `verified` to be right for this row — and the recount is two cheap COUNTs (house rule 5).
        recount_verified(exercise.pk)
        return exercise

    def apply_parts(self, exercise: Exercise, item: Parsed, author, stats: dict) -> None:
        """The file's parts onto the exercise, by `(exercise, order)`: a part's label, its text in
        the file's locale (the published row of `ExercisePartTranslation`, the original as a row
        like any other), and its hint and solution as pinned published entries with `part=` set.
        Then everything past the file's last part is deleted with its entries — for a set, the file
        is the truth (SUBEXERCISES-BRIEF.md §4).

        Counted as CHANGES, not as writes: a part is "updated" only when its label, its text or one
        of its entries differs from what is stored, so a second run of an unchanged batch says
        `parts: 0 created, 0 updated, 0 removed` — which is the check that the run is idempotent.
        The comparison is against the sanitized file text, because what is stored is that."""
        from config.sanitize import sanitize_content

        existing = {p.order: p for p in exercise.parts.all()}
        for order, parsed in enumerate(item.parts, start=1):
            part = existing.get(order)
            changed = False
            if part is None:
                part = ExercisePart.objects.create(exercise=exercise, order=order, label=parsed.label)
                stats['parts_created'] += 1
            elif part.label != parsed.label:
                part.label = parsed.label
                part.save(update_fields=['label'])
                changed = True

            # One published row per (part, locale) — the partial unique constraint — so this keys on
            # status='published' exactly as the statement's own upsert does; a pending or rejected
            # translation of the part is somebody's work and is not touched.
            text = ExercisePartTranslation.objects.filter(
                part=part, locale=item.locale, status='published'
            ).first()
            statement, answer = sanitize_content(parsed.statement), sanitize_content(parsed.answer)
            if text is None:
                ExercisePartTranslation.objects.create(
                    part=part, locale=item.locale, status='published',
                    statement=parsed.statement, answer=parsed.answer, translated_by=None,
                )
                changed = True
            elif (text.statement, text.answer, text.translated_by_id) != (statement, answer, None):
                text.statement, text.answer, text.translated_by = parsed.statement, parsed.answer, None
                text.save()
                changed = True

            for kind in ('hint', 'solution'):
                body = getattr(parsed, kind)
                if body.strip():
                    changed |= self._upsert_part_entry(exercise, part, kind, body, item, author)
                    stats['entries'] += 1
                else:
                    changed |= self._drop_stale_entry(exercise, part, kind, item, author, stats)

            if changed and order in existing:
                stats['parts_updated'] += 1

        beyond = exercise.parts.filter(order__gt=len(item.parts))
        removed = beyond.count()
        if removed:
            entries = SolutionEntry.objects.filter(part__in=beyond).count()
            labels = ', '.join(beyond.values_list('label', flat=True))
            # CASCADE takes the part's translations and its entries with it (the entry signals
            # recount `verified` for each one as it goes).
            beyond.delete()
            stats['parts_removed'] += removed
            self.stdout.write(self.style.WARNING(
                f'  {item.path.name}: #{exercise.number} had {removed} part(s) beyond the file\'s '
                f'{len(item.parts)} ({labels}) — removed, with {entries} hint/solution row(s).'
            ))

    def _upsert_part_entry(self, exercise: Exercise, part: ExercisePart, kind: str, body: str, item: Parsed, author) -> bool:
        """The pinned published `kind` entry of `part` in the file's locale; True when it was
        created or changed. Keyed exactly like the whole exercise's (`exercise, kind, locale,
        pinned=True`) plus `part` — the key the brief fixes."""
        from config.sanitize import sanitize_content

        entry = SolutionEntry.objects.filter(
            exercise=exercise, part=part, kind=kind, locale=item.locale, pinned=True
        ).first()
        wanted = {
            'body': body, 'author': author, 'status': 'published', 'licence': exercise.licence,
        }
        if entry is None:
            SolutionEntry.objects.create(
                exercise=exercise, part=part, kind=kind, locale=item.locale, pinned=True, **wanted
            )
            return True
        current = (entry.body, entry.author_id, entry.status, entry.licence)
        target = (sanitize_content(body), author.pk if author else None, 'published', exercise.licence)
        if current == target:
            return False
        for key, value in wanted.items():
            setattr(entry, key, value)
        entry.save()
        return True

    def _drop_stale_entry(self, exercise: Exercise, part: ExercisePart | None, kind: str, item: Parsed, author, stats: dict) -> bool:
        """A file with parts has no `kind` section for `part` (None = the whole exercise): delete
        the pinned entry an earlier run of THIS command wrote there, so splitting an exercise's
        one solution into per-part solutions does not leave the old one standing beside them.

        Only a row this command could have written is touched — pinned, in the file's locale, and
        by the same `--author` (nobody, without the flag). Staff and node governors may pin
        anybody's entry (`exercises/entries.py`), and a pinned community solution is not the
        file's to delete: it is left, and the run says so. Nor is one readers have already talked
        about or voted on — house rule 12, a thread must not break — which is left with a warning
        for a moderator to decide."""
        from django.contrib.contenttypes.models import ContentType

        from community.models import Comment

        stale = SolutionEntry.objects.filter(
            exercise=exercise, part=part, kind=kind, locale=item.locale, pinned=True
        )
        if not stale.exists():
            return False
        where = f'part "{part.label}"' if part is not None else 'the whole exercise'
        ours = stale.filter(author=author) if author is not None else stale.filter(author__isnull=True)
        foreign = stale.count() - ours.count()
        if foreign:
            self.stdout.write(self.style.WARNING(
                f'  {item.path.name}: #{exercise.number} has {foreign} pinned {kind}(s) for {where} '
                'by somebody else — the file has none, but that is not the file\'s to delete; left.'
            ))
        entry_type = ContentType.objects.get_for_model(SolutionEntry)
        dropped = 0
        for entry in ours:
            comments = Comment.objects.filter(content_type=entry_type, object_id=entry.pk).count()
            votes = entry.votes.count()
            if comments or votes:
                self.stdout.write(self.style.WARNING(
                    f'  {item.path.name}: #{exercise.number} — the pinned {kind} for {where} that an '
                    f'earlier import wrote has {comments} comment(s) and {votes} vote(s); the file no '
                    'longer has it, but deleting it would break that thread — left. Remove it in '
                    'the moderation UI if that is what you mean.'
                ))
                continue
            entry.delete()  # one by one, so each post_delete recounts `verified`
            dropped += 1
        if dropped:
            stats['stale_entries'] += dropped
            self.stdout.write(self.style.WARNING(
                f'  {item.path.name}: #{exercise.number} — removed the pinned {kind} for {where} '
                'that an earlier import wrote; the file no longer has one there.'
            ))
        return bool(dropped)

    def _relicense(self, exercise: Exercise, item: Parsed) -> None:
        """A re-run whose file declares a different licence: widen and record it, or warn and leave
        a narrowing (see the module docstring). Written straight rather than through
        `licensing.rules.change_licence`, which asks for an author or a staff account the command
        does not have; the record it leaves is the same row."""
        from licensing.models import LicenceChange
        from licensing.targets import content_type_of

        old = exercise.licence
        if item.licence == UNKNOWN or not at_least_as_open(item.licence, old):
            self.stdout.write(self.style.WARNING(
                f'  {item.path.name}: #{exercise.number} is licensed {old}; the file says '
                f'{item.licence}, which is narrower — left as {old} (a licence cannot be taken back).'
            ))
            return
        Exercise.objects.filter(pk=exercise.pk, licence=old).update(licence=item.licence)
        ExerciseTranslation.objects.filter(
            exercise=exercise, locale=exercise.original_locale, licence=old
        ).update(licence=item.licence)
        SolutionEntry.objects.filter(exercise=exercise, pinned=True, licence=old).update(
            licence=item.licence
        )
        LicenceChange.objects.create(
            content_type=content_type_of(exercise),
            object_id=exercise.pk,
            from_licence=old,
            to_licence=item.licence,
            as_staff=True,
            note=f'import_exercises: {item.path.name}'[:500],
        )
        exercise.licence = item.licence

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

        stats = {
            'created': 0, 'updated': 0, 'entries': 0, 'topics': 0,
            'parts_created': 0, 'parts_updated': 0, 'parts_removed': 0, 'stale_entries': 0,
        }
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
        # The fixed shape (prompts/21 "Shapes fixed in advance"): always printed, so a re-run of a
        # set batch can be checked for "0 created, 0 updated, 0 removed" at a glance.
        self.stdout.write(self.style.SUCCESS(
            'parts: {parts_created} created, {parts_updated} updated, {parts_removed} removed.'.format(**stats)
        ))
        if stats['stale_entries']:
            self.stdout.write(self.style.WARNING(
                f'{stats["stale_entries"]} pinned hint/solution row(s) an earlier import wrote were '
                'removed because a file with parts no longer has them (named per file above).'
            ))
        if not dry_run:
            self.stdout.write(
                'Now re-run the content sweep: `manage.py dump_text_fields` then '
                '`npm run check:katex` in frontend/.'
            )
