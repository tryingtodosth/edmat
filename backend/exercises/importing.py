"""The exercise file format, read — one module both ways of getting a batch in ask (root CLAUDE.md
boundary 2).

`manage.py import_exercises` (the operator's command, idempotent by `(branch, number)`) and the
user's bulk upload (`exercises/bulk.py`, `POST /api/exercise-imports/`, 2026-10-22) both read files
through `split_text` and `parse_file`, so a file that one accepts the other parses identically. What
each of them may then DO with a parsed file differs, and that difference lives in the caller: the
operator may update by number, name an author and create topics; a user never can.

The format itself is `.claude/skills/import-exercises/reference/format.md`. This module was lifted
unchanged out of the command on 2026-10-22; the command re-exports every name, so existing imports
(`import_concepts`, `test_import_parts`) keep working.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any

import yaml

from config.audience import AUDIENCE_VALUES, DEFAULT_AUDIENCE
from licensing.licences import LICENCE_VALUES, UNKNOWN

from .parts import MAX_PARTS

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


def split_text(raw: str, loader=None) -> tuple[dict[str, Any], dict[str, str], list[tuple[str, dict[str, str]]], list[str]]:
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
    match = FRONT_MATTER.match(raw)
    if not match:
        return {}, {}, [], ['no YAML front matter (the file must start with a `---` line)']
    try:
        meta = (yaml.load(match.group(1), Loader=loader) if loader else yaml.safe_load(match.group(1))) or {}
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


def split_file(path: Path):
    """`split_text` of a file on disk — the operator's path (`import_exercises`)."""
    return split_text(path.read_text(encoding='utf-8'))


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


def parse_file(
    path: Path,
    defaults: dict[str, Any],
    options: dict[str, Any],
    *,
    raw: str | None = None,
    loader=None,
    warn: Callable[[str], None] | None = None,
) -> tuple[Parsed, list[str]]:
    """One file → a `Parsed` and the list of reasons it cannot be imported (empty = it can).

    The one parser both entry points share (root CLAUDE.md boundary 2): `import_exercises` passes
    a path on disk; the user's bulk upload (`exercises/bulk.py`) passes the uploaded text as `raw`
    with `path` a display name only, and a YAML loader that refuses aliases. `warn` receives the
    non-fatal notes (an unrecognised `source.type`)."""
    meta, sections, raw_parts, errors = split_text(raw, loader) if raw is not None else split_file(path)
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
            if warn is not None:
                warn(f'source type {raw_type!r} → "other"')
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
