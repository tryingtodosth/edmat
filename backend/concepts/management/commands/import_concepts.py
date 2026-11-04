"""Imports a batch of concept (wiki) pages from Markdown files — `import_exercises`' counterpart.

One file is one concept page: YAML front matter, then a Markdown body (format: the import-exercises
skill's `reference/concepts.md`). What one file becomes is the whole concepts machine, written
through the app's own service functions rather than by hand — `create_concept` / `create_article` /
`create_revision` / `publish_revision` / `add_link` / `harvest_body_links` — so the supersede-then-
claim order, the sanitizing in `ConceptRevision.save()` and the body-link recount are the ones every
other write path gets (`seed_concepts` makes the same choice for the same reason):

    Concept (slug)            branches (replaced, when the concept is the author's), tags (added)
     └─ ConceptArticle         (audience, locale, created_by=--author), licence
         └─ ConceptRevision    title + summary + the body split into markdown blocks; published
     └─ ConceptLink ×n         prerequisites / related → concepts, exercises → exercises

**Idempotent by `slug`, and by "the author's article for this `(audience, locale)`".** A re-run of an
unchanged file writes nothing: the file's title, summary and blocks are normalised exactly as
`ConceptRevision.save()` would store them and compared with the article's head. A changed file
becomes a NEW revision on the SAME article, published by the same author — the old head is kept as
`superseded` history (house rule 12), never edited or deleted. Somebody else's article in the same
pool is never touched; an existing concept the author did not create gets the author's article as a
peer beside the others (CONCEPTS-BRIEF.md §0: articles for one page are peers).

**What it refuses to overwrite**, each named in the run's output rather than silently skipped: an
article whose head is somebody else's published revision (a community edit landed on top — merge it
by hand), an article the author has an open draft on (`DraftExists`: finish or delete it first), and
a removed or auto-hidden article (an import is not an appeal, the `import_exercises` posture).

**Links are additive and filed in a second pass**, after every concept in the batch exists, so the
order of the files does not matter and a prerequisite may point at a later file. A link the file no
longer lists is NOT removed (never delete; unfile it in the UI). One row per (concept, target) is the
model's rule, so a target that already has a row is reconciled rather than duplicated: the same
relation is left alone; a `body` row (harvested from a `[[slug]]` in the text) for a target the file
lists as a PREREQUISITE is re-filed as a manual prerequisite — otherwise mentioning a prerequisite in
the text would silently erase the relation; a manual row this author filed takes the file's relation;
anybody else's manual row is left and named. Then `harvest_body_links` recounts every batch concept.

**No feed, no mail.** `publish_revision(..., announce=False)` skips the feed row and the "your
article changed" notifications — an import is not something a person did in public (house rule 9),
and `import_exercises` writes no feed row either. `add_link` and `publish_revision` audit only with a
request, and there is none here (house rule 10: an honest skip rather than a faked actor).

**The licence is declared, never assumed** — per file, `batch.yaml`, `--licence`, else `unknown`,
exactly as `import_exercises`. A re-run only WIDENS an article's licence, through
`licensing.rules.change_licence` with the author as the actor (so it is refused, and named, once
somebody else's revision is in the article); a narrower file is warned about and left.

**`--ai-assisted [NOTE]`** makes the author's own AI-assisted mark (`provenance.AuthorMark`,
kind `concept_article`) on every article the batch names — the same row `declare_ai_assisted`
writes. Nothing renders that mark on a concept page yet; the footer line the format requires is the
reader-visible disclosure until it does (`provenance/CLAUDE.md`).

Usage:
    python manage.py import_concepts <dir> --author <username> [--dry-run]
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any

import yaml
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from config.audience import AUDIENCE_VALUES, DEFAULT_AUDIENCE
from config.sanitize import sanitize_content
from exercises.management.commands.import_exercises import FRONT_MATTER, check_math
from licensing.licences import LICENCE_VALUES, UNKNOWN, at_least_as_open

from ...access import can_view, link_block_reason
from ...blocks import MAX_BLOCKS, MAX_MARKDOWN_CHARS, clean_blocks, inherit_ids, sanitize_blocks, without_ids
from ...models import (
    MAX_SUMMARY_LENGTH,
    MAX_TITLE_LENGTH,
    Concept,
    ConceptLink,
    ConceptRevision,
    _flatten,
)
from ...services import (
    Conflict,
    DraftExists,
    Refused,
    Stale,
    add_link,
    create_article,
    create_concept,
    create_revision,
    harvest_body_links,
    head_of,
    publish_revision,
)

#: Front-matter keys this command understands; anything else is a typo until proven otherwise.
KNOWN_KEYS = {
    'slug', 'title', 'summary', 'branches', 'tags', 'audience', 'locale', 'licence',
    'prerequisites', 'related', 'exercises',
}
#: What `batch.yaml` may default. Narrower than the front matter on purpose: a slug, a title or a
#: link list is one page's, never a batch's. `branch: <slug>` is accepted as `branches: [<slug>]`,
#: because it is the key `import_exercises`' own batch.yaml uses and a kit's two files sit side by side.
BATCH_KEYS = {'audience', 'locale', 'licence', 'branches', 'branch'}

#: The `[[slug]]` alphabet (`blocks.WIKI_LINK_RE`) and `Concept.slug`'s length — a slug outside it
#: could never be linked to from another page's text.
SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
SLUG_MAX = 120
EXERCISE_REF_RE = re.compile(r'^(?P<branch>[a-z0-9][a-z0-9-]*)/(?P<number>[1-9][0-9]*)$')
LOCALE_RE = re.compile(r'^[a-z]{2,3}(-[a-z0-9]{2,4})?$')
#: `exercises.Tag.slug` is a 50-character SlugField that in practice holds free text ("baza
#: dualna"); the corpus's 1,026 tags include spaces and Polish letters, so no alphabet is imposed.
TAG_MAX = 50

#: `### ` opens a new markdown block (the format: "### starts a new markdown block"); `#` and `##`
#: are refused — the page draws the title itself, and a body heading above `###` would outrank it.
BLOCK_HEADING_RE = re.compile(r'^###[ \t]')
TOO_HIGH_HEADING_RE = re.compile(r'^#{1,2}[ \t]')
FENCE_RE = re.compile(r'^ {0,3}(```|~~~)')


@dataclass
class Parsed:
    path: Path
    slug: str = ''
    title: str = ''
    summary: str = ''
    branches: list[str] = dataclass_field(default_factory=list)
    tags: list[str] = dataclass_field(default_factory=list)
    audience: str = DEFAULT_AUDIENCE
    locale: str = 'pl'
    licence: str = UNKNOWN
    prerequisites: list[str] = dataclass_field(default_factory=list)
    related: list[str] = dataclass_field(default_factory=list)
    exercises: list[str] = dataclass_field(default_factory=list)
    blocks: list[dict] = dataclass_field(default_factory=list)
    #: Filled during validation: exercise ref -> Exercise pk, for the refs that resolved.
    exercise_ids: dict[str, int] = dataclass_field(default_factory=dict)


def split_body(body: str) -> tuple[list[dict], list[str]]:
    """The body as markdown blocks, split at every `### ` heading outside a code fence.

    Each block keeps its own heading line, so the page reads exactly as the file does; the text
    before the first heading (the definition, usually) is block 1. Returns (blocks, errors).
    """
    errors: list[str] = []
    chunks: list[list[str]] = [[]]
    in_fence = False
    for number, line in enumerate(body.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
        elif not in_fence:
            if BLOCK_HEADING_RE.match(line):
                chunks.append([])
            elif TOO_HIGH_HEADING_RE.match(line):
                errors.append(
                    f'body line {number}: "{line.strip()[:60]}" — section headings in a concept body '
                    'are `###` or deeper (the page draws the title as the top heading)'
                )
        chunks[-1].append(line)
    blocks = [
        {'kind': 'markdown', 'body': text}
        for text in ('\n'.join(chunk).strip() for chunk in chunks)
        if text
    ]
    return blocks, errors


def stored_form(title: str, summary: str, blocks: list[dict]) -> tuple[str, str, list[dict]]:
    """What `ConceptRevision.save()` would store for these three — the comparison key for "is the
    file unchanged since the head?". The same three calls `save()` makes, so a sanitizer
    normalisation (`<line/>` → `<line></line>`) never reads as a change."""
    return (
        sanitize_content(title or '')[:MAX_TITLE_LENGTH],
        _flatten(summary)[:MAX_SUMMARY_LENGTH],
        # Block ids are left OUT of the key (2026-11-04): `save()` allocates a fresh id for every
        # block a file arrives without, so with them in, no file could ever be unchanged.
        without_ids(sanitize_blocks(blocks)),
    )


def stored_key(revision) -> tuple[str, str, list[dict]]:
    """`stored_form`'s counterpart for a row that is already stored."""
    return (revision.title, revision.summary, without_ids(revision.blocks))


def _as_list(value) -> tuple[list[str], bool]:
    """A front-matter list: a YAML list, a single scalar, or absent. Returns (items, ok)."""
    if value is None:
        return [], True
    if isinstance(value, (str, int)):
        value = [value]
    if not isinstance(value, list) or any(isinstance(v, (list, dict)) for v in value):
        return [], False
    out: list[str] = []
    for v in value:
        text = str(v).strip()
        if text and text not in out:
            out.append(text)
    return out, True


class Command(BaseCommand):
    help = 'Imports a directory of concept-page Markdown files (idempotent by slug).'

    def add_arguments(self, parser):
        parser.add_argument('directory', help='Directory of *.md concept files (searched recursively).')
        parser.add_argument('--author', required=True, help='Username who writes (and owns) every article. Required: an article is somebody\'s.')
        parser.add_argument('--locale', help='Locale for files that do not name one (default: pl).')
        parser.add_argument('--audience', help=f'Audience for files that do not name one. One of: {", ".join(AUDIENCE_VALUES)}.')
        parser.add_argument('--licence', help=f'Licence for files that do not name one (default: {UNKNOWN}). One of: {", ".join(LICENCE_VALUES)}.')
        parser.add_argument('--skip-missing-exercises', action='store_true', help='An `exercises:` entry that does not resolve to a published exercise is a warning and is skipped, instead of an error.')
        parser.add_argument('--ai-assisted', nargs='?', const='', default=None, metavar='NOTE', help='Make the author\'s AI-assisted mark (provenance) on every article in the batch, with this note.')
        parser.add_argument('--dry-run', action='store_true', help='Validate, write, and roll back; changes nothing.')

    # ---- reading ---------------------------------------------------------------------------

    def collect_files(self, directory: Path) -> list[Path]:
        files = [
            p for p in sorted(directory.rglob('*.md'))
            if not p.name.startswith('_') and p.name.lower() != 'readme.md'
        ]
        if not files:
            raise CommandError(f'No *.md concept files under {directory}')
        return files

    def batch_defaults(self, path: Path, root: Path, cache: dict, failures: list[str]) -> dict[str, Any]:
        """The nearest `batch.yaml` from the file's own directory up to `<dir>` — so one run over a
        kit with several `<branch>/pojecia/batch.yaml` gives each page its own directory's
        defaults. Unknown keys in it are refused like unknown front-matter keys."""
        directory = path.parent
        while True:
            if directory not in cache:
                candidate = directory / 'batch.yaml'
                data: dict[str, Any] | None = None
                if candidate.exists():
                    try:
                        loaded = yaml.safe_load(candidate.read_text(encoding='utf-8')) or {}
                    except yaml.YAMLError as exc:
                        failures.append(f'{candidate}: not valid YAML: {exc}')
                        loaded = {}
                    if not isinstance(loaded, dict):
                        failures.append(f'{candidate}: must be a mapping of keys to values')
                        loaded = {}
                    for key in loaded:
                        if key not in BATCH_KEYS:
                            failures.append(
                                f'{candidate}: unknown key `{key}:` (allowed: {", ".join(sorted(BATCH_KEYS))})'
                            )
                    if 'branch' in loaded:
                        if 'branches' in loaded:
                            failures.append(f'{candidate}: give `branch:` or `branches:`, not both')
                        else:
                            loaded = dict(loaded)
                            loaded['branches'] = [loaded.pop('branch')]
                    data = loaded
                cache[directory] = data
            if cache[directory] is not None:
                return cache[directory]
            if directory == root or root not in directory.parents:
                return {}
            directory = directory.parent

    def parse(self, path: Path, defaults: dict[str, Any], options: dict[str, Any]) -> tuple[Parsed, list[str]]:
        item = Parsed(path=path)
        raw = path.read_text(encoding='utf-8')
        match = FRONT_MATTER.match(raw)
        if not match:
            return item, ['no YAML front matter (the file must start with a `---` line)']
        try:
            meta = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError as exc:
            return item, [f'front matter is not valid YAML: {exc}']
        if not isinstance(meta, dict):
            return item, ['front matter must be a mapping of keys to values']

        errors: list[str] = []
        for key in meta:
            if key not in KNOWN_KEYS:
                errors.append(f'unknown front-matter key `{key}:` (allowed: {", ".join(sorted(KNOWN_KEYS))})')

        item.slug = str(meta.get('slug') or '').strip()
        if not item.slug:
            errors.append('`slug:` is required — it is the concept\'s natural key and what `[[…]]` links to')
        elif not SLUG_RE.match(item.slug) or len(item.slug) > SLUG_MAX:
            errors.append(
                f'`slug: {item.slug}` — a slug is lowercase a–z, 0–9 and hyphens, starting with a letter '
                f'or digit, at most {SLUG_MAX} characters (the `[[slug]]` alphabet)'
            )

        item.title = str(meta.get('title') or '').strip()
        if not item.title:
            errors.append('`title:` is required')
        elif '<' in item.title or '>' in item.title:
            errors.append('`title:` contains `<` or `>` — a title is plain text (write "mniejszy niż" or use the body)')
        elif len(item.title) > MAX_TITLE_LENGTH:
            errors.append(f'`title:` is {len(item.title)} characters; the most is {MAX_TITLE_LENGTH}')

        item.summary = ' '.join(str(meta.get('summary') or '').split())
        if not item.summary:
            errors.append('`summary:` is required — it is what a card, a search result and a queue row show')
        else:
            if len(item.summary) > MAX_SUMMARY_LENGTH:
                errors.append(f'`summary:` is {len(item.summary)} characters; the most is {MAX_SUMMARY_LENGTH}')
            if re.search(r'<[^>]+>', sanitize_content(item.summary)):
                # `ConceptRevision.save()` flattens the summary by stripping tags, so `\(a<b\) … \(c>d\)`
                # would lose everything between the two signs — refuse rather than store a mangled line.
                errors.append(
                    '`summary:` would be cut when stored: a summary is plain text, and a `<` … `>` pair '
                    '(HTML, or `<`/`>` in maths) is stripped as a tag. Rephrase without them'
                )

        for key in ('branches', 'tags', 'prerequisites', 'related', 'exercises'):
            source = meta.get(key) if key in meta else (defaults.get(key) if key == 'branches' else None)
            values, ok = _as_list(source)
            if not ok:
                errors.append(f'`{key}:` must be a list, e.g. `{key}: [a, b]`')
            setattr(item, key, values)

        if not item.branches:
            errors.append('`branches:` is required (in the file or in batch.yaml) — a concept with no branch '
                          'has no governor to review it')
        for slug in item.branches:
            if not SLUG_RE.match(slug):
                errors.append(f'`branches:` entry {slug!r} is not a branch slug')
        for tag in item.tags:
            if len(tag) > TAG_MAX or '<' in tag or '>' in tag:
                errors.append(f'`tags:` entry {tag!r} — at most {TAG_MAX} characters, no `<` or `>`')
        for key in ('prerequisites', 'related'):
            for slug in getattr(item, key):
                if not SLUG_RE.match(slug) or len(slug) > SLUG_MAX:
                    errors.append(f'`{key}:` entry {slug!r} is not a concept slug')
                elif slug == item.slug:
                    errors.append(f'`{key}:` names the concept itself ({slug})')
        both = sorted(set(item.prerequisites) & set(item.related))
        if both:
            errors.append(
                f'{", ".join(both)} is in both `prerequisites:` and `related:` — one link per target, '
                'so pick one (a prerequisite is already related)'
            )
        for ref in item.exercises:
            if not EXERCISE_REF_RE.match(ref):
                errors.append(f'`exercises:` entry {ref!r} — write `branch-slug/number`, e.g. `fale/4`')

        audience = str(
            meta.get('audience') or options.get('audience') or defaults.get('audience') or DEFAULT_AUDIENCE
        ).strip()
        if audience not in AUDIENCE_VALUES:
            errors.append(f'`audience: {audience}` is not one of {", ".join(AUDIENCE_VALUES)}')
        else:
            item.audience = audience

        locale = str(meta.get('locale') or options.get('locale') or defaults.get('locale') or 'pl').strip().lower()
        if not LOCALE_RE.match(locale) or len(locale) > 8:
            errors.append(f'`locale: {locale}` is not a language code like `pl` or `en`')
        else:
            item.locale = locale

        licence = str(
            meta.get('licence') or options.get('licence') or defaults.get('licence') or UNKNOWN
        ).strip()
        if licence not in LICENCE_VALUES:
            errors.append(f'`licence: {licence}` is not one of {", ".join(LICENCE_VALUES)}')
        else:
            item.licence = licence

        body = match.group(2)
        item.blocks, body_errors = split_body(body)
        errors.extend(body_errors)
        if not item.blocks:
            errors.append('the body is empty — a concept page is its text')
        if len(item.blocks) > MAX_BLOCKS:
            errors.append(f'{len(item.blocks)} `###` sections; the most is {MAX_BLOCKS} blocks per article')
        errors.extend(check_math('title', item.title))
        errors.extend(check_math('summary', item.summary))
        for index, block in enumerate(item.blocks, start=1):
            label = f'block {index}'
            first = block['body'].splitlines()[0]
            if first.startswith('###'):
                label += f' ("{first[:50]}")'
            if len(block['body']) > MAX_MARKDOWN_CHARS:
                errors.append(f'{label} is {len(block["body"])} characters; the most is {MAX_MARKDOWN_CHARS}')
            # Per block, not over the whole body: a `###` line inside a display formula would cut
            # it in two, and only a per-block count sees that.
            errors.extend(check_math(label, block['body']))
        if not errors:
            try:
                clean_blocks(item.blocks)  # the API's own validation, so the two cannot disagree
            except DjangoValidationError as exc:
                errors.extend(f'blocks: {m}' for m in exc.messages)
        return item, errors

    # ---- validating against the database ---------------------------------------------------

    def check_references(self, items: list[Parsed], author, skip_missing: bool) -> tuple[list[str], list[str]]:
        """Everything that needs a query: branches, link targets, exercises, the prerequisite DAG,
        slug collisions inside the batch. Returns (failures, warnings)."""
        from exercises.models import Exercise, Tag
        from taxonomy.models import Branch

        failures: list[str] = []
        warnings: list[str] = []

        seen: dict[str, Path] = {}
        for item in items:
            if not item.slug:
                continue
            if item.slug in seen:
                failures.append(f'{item.path}: `slug: {item.slug}` is also used by {seen[item.slug]}')
            seen[item.slug] = item.path
        batch_slugs = set(seen)

        branch_status = dict(Branch.objects.values_list('slug', 'status'))
        for item in items:
            for slug in item.branches:
                if not SLUG_RE.match(slug):
                    continue  # named by the parser
                if slug not in branch_status:
                    failures.append(
                        f'{item.path}: no branch {slug!r}. Existing: {", ".join(sorted(branch_status))}. '
                        'A new branch is a taxonomy decision — not this command\'s'
                    )
                elif branch_status[slug] != 'approved':
                    warnings.append(f'{item.path.name}: branch {slug} is still {branch_status[slug]}')

        removed_tags = set(Tag.objects.filter(is_removed=True).values_list('slug', flat=True))
        for item in items:
            for tag in item.tags:
                if tag in removed_tags:
                    failures.append(f'{item.path}: tag {tag!r} was removed by a moderator — drop it from the file')

        wanted = {s for item in items for s in item.prerequisites + item.related} - batch_slugs
        existing = {c.slug: c for c in Concept.objects.filter(slug__in=wanted).prefetch_related('articles__revisions')}
        for item in items:
            for key in ('prerequisites', 'related'):
                for slug in getattr(item, key):
                    if slug in batch_slugs or not SLUG_RE.match(slug):
                        continue  # in the batch, or malformed and named by the parser
                    concept = existing.get(slug)
                    if concept is None:
                        failures.append(
                            f'{item.path}: `{key}:` {slug!r} is neither in this batch nor an existing concept'
                        )
                    elif not can_view(concept, author):
                        failures.append(
                            f'{item.path}: `{key}:` {slug!r} exists but has no article {author.username} '
                            'can see (nothing published) — it cannot be linked yet'
                        )

        for item in items:
            for ref in item.exercises:
                match = EXERCISE_REF_RE.match(ref)
                if not match:
                    continue  # refused by the parser already
                exercise = (
                    Exercise.objects.filter(branch__slug=match['branch'], number=int(match['number']))
                    .only('pk', 'published', 'auto_hidden_at')
                    .first()
                )
                problem = None
                if exercise is None:
                    problem = f'`exercises:` {ref} does not exist'
                elif not exercise.published:
                    problem = f'`exercises:` {ref} is not published'
                if problem is None:
                    item.exercise_ids[ref] = exercise.pk
                elif skip_missing:
                    warnings.append(f'{item.path.name}: {problem} — skipped (--skip-missing-exercises)')
                else:
                    failures.append(
                        f'{item.path}: {problem} (import the exercise first, fix the reference, or pass '
                        '--skip-missing-exercises)'
                    )

        failures.extend(self.check_cycles(items))
        return failures, warnings

    def check_cycles(self, items: list[Parsed]) -> list[str]:
        """"Know this first" must be a DAG (the format's own rule; `paths.py` survives a cycle, a
        reader does not). The graph is the batch's prerequisites plus every prerequisite already in
        the database — links are additive, so a re-run can only ever add edges."""
        concept_ct = ContentType.objects.get_for_model(Concept)
        slug_of = dict(Concept.objects.values_list('pk', 'slug'))
        graph: dict[str, set[str]] = {}
        for concept_id, target_id in ConceptLink.objects.filter(
            relation='prerequisite', content_type=concept_ct
        ).values_list('concept_id', 'object_id'):
            if concept_id in slug_of and target_id in slug_of:
                graph.setdefault(slug_of[concept_id], set()).add(slug_of[target_id])
        for item in items:
            if item.slug:
                # A self-reference is named by the parser; it is not also a "cycle".
                graph.setdefault(item.slug, set()).update(p for p in item.prerequisites if p != item.slug)

        failures: list[str] = []
        state: dict[str, int] = {}  # 1 = on the stack, 2 = done
        reported: set[frozenset] = set()

        def visit(node: str, stack: list[str]) -> None:
            state[node] = 1
            stack.append(node)
            for nxt in sorted(graph.get(node, ())):
                if state.get(nxt) == 1:
                    cycle = stack[stack.index(nxt):] + [nxt]
                    key = frozenset(cycle)
                    if key not in reported:
                        reported.add(key)
                        failures.append(
                            'prerequisites form a cycle: ' + ' → '.join(cycle)
                            + ' — "know this first" cannot go round in a circle'
                        )
                elif state.get(nxt) is None:
                    visit(nxt, stack)
            stack.pop()
            state[node] = 2

        for node in sorted(graph):
            if state.get(node) is None:
                visit(node, [])
        return failures

    # ---- writing ---------------------------------------------------------------------------

    def apply(self, item: Parsed, author, stats: dict) -> tuple[Concept, Any, str]:
        """Pass 1 for one file: the concept, the author's article, and a published revision when the
        text is new or changed. Returns (concept, article or None, what happened)."""
        from exercises.models import Tag
        from taxonomy.models import Branch

        branches = list(Branch.objects.filter(slug__in=item.branches))
        tags = [Tag.objects.get_or_create(slug=slug)[0] for slug in item.tags]
        concept = Concept.objects.filter(slug=item.slug).first()

        if concept is None:
            concept, article, revision = create_concept(
                author,
                title=item.title,
                summary=item.summary,
                blocks=item.blocks,
                audience=item.audience,
                locale=item.locale,
                branches=branches,
                tags=tags,
                submit=False,
                licence=item.licence,
            )
            # `create_concept` allocates a slug from the title; the file names it. The slug was
            # checked free above, and nothing has seen the allocated one yet (`seed_concepts` does
            # the same, for the same reason). Renamed BEFORE the publish, so the body-link harvest
            # and everything after it see the real slug.
            if concept.slug != item.slug:
                concept.slug = item.slug
                concept.save(update_fields=['slug'])
            publish_revision(revision, author, announce=False)
            stats['created'] += 1
            return concept, article, 'created'

        # An existing concept: its structure first. Branches are the structural claim the file
        # makes (the `topics` of import_exercises) and are REPLACED — but only on a concept this
        # author created; on somebody else's concept the file may add a branch and never take one
        # away. Tags are only ever added: readers apply them (import_exercises' rule).
        if concept.created_by_id == author.pk:
            concept.branches.set(branches)
        else:
            concept.branches.add(*branches)
        if tags:
            concept.tags.add(*tags)

        article = (
            concept.articles.filter(audience=item.audience, locale=item.locale, created_by=author)
            .order_by('pk')
            .first()
        )
        if article is None:
            article, revision = create_article(
                concept,
                author,
                audience=item.audience,
                locale=item.locale,
                title=item.title,
                summary=item.summary,
                blocks=item.blocks,
                change_note=f'import_concepts: {item.path.name}'[:500],
                submit=False,
                licence=item.licence,
            )
            publish_revision(revision, author, announce=False)
            stats['articles_added'] += 1
            owner = concept.created_by.username if concept.created_by else 'nobody'
            return concept, article, f'new article on an existing concept (created by {owner})'

        if article.is_removed or article.auto_hidden_at is not None:
            stats['skipped'] += 1
            reason = 'removed by a moderator' if article.is_removed else 'auto-hidden by reports'
            self.warn(f'  {item.path.name}: the article is {reason} — left as it is; an import is not an appeal.')
            return concept, None, 'skipped (hidden)'

        self.relicense(article, item, author)

        head = head_of(article)
        wanted = stored_form(item.title, item.summary, item.blocks)
        if head is not None and stored_key(head) == wanted:
            stats['unchanged'] += 1
            return concept, article, 'unchanged'

        if head is not None and head.created_by_id != author.pk:
            # A community edit is the page now. If the file is what the author last published, the
            # file has nothing new and there is nothing to say beyond "unchanged"; if it differs,
            # publishing it would silently undo somebody's published work.
            ours = (
                ConceptRevision.objects.filter(
                    article=article, created_by=author, status__in=('published', 'superseded')
                )
                .order_by('-number')
                .first()
            )
            stats['skipped'] += 1
            if ours is not None and stored_key(ours) == wanted:
                return concept, article, (
                    f'unchanged (revision {head.number} by '
                    f'{head.created_by.username if head.created_by else "somebody"} is the head)'
                )
            self.warn(
                f'  {item.path.name}: the head of the article is revision {head.number} by '
                f'{head.created_by.username if head.created_by else "somebody else"}, and the file '
                'differs from it — NOT published over it. Merge the file with that revision by hand.'
            )
            return concept, article, 'skipped (somebody else\'s revision is the head)'

        try:
            revision = create_revision(
                article,
                author,
                title=item.title,
                summary=item.summary,
                # The head's ids, position by position, so a comment on a paragraph of the page
                # stays on that paragraph when the file is re-imported with a typo fixed.
                blocks=inherit_ids(item.blocks, head.blocks if head is not None else []),
                change_note=f'import_concepts: {item.path.name}'[:500],
                based_on=head,
                submit=False,
            )
            publish_revision(revision, author, announce=False)
        except DraftExists as exc:
            stats['skipped'] += 1
            self.warn(
                f'  {item.path.name}: {author.username} has an open draft (revision {exc.draft.number}) '
                'on this article — finish or delete it in the editor first; the file was not published.'
            )
            return concept, article, 'skipped (open draft)'
        except (Conflict, Stale) as exc:  # pragma: no cover - a race with a person in the editor
            stats['skipped'] += 1
            self.warn(f'  {item.path.name}: the article changed while importing ({exc}) — run again.')
            return concept, article, 'skipped (conflict)'
        stats['revised'] += 1
        return concept, article, f'revised (revision {revision.number})'

    def relicense(self, article, item: Parsed, author) -> None:
        """Widen-only, through `licensing.rules.change_licence` with the author as the actor — the
        same rules the article page's own control asks (house boundary #2), so it is refused once
        somebody else's revision is in the article. A narrower file is warned about and left."""
        from licensing.rules import change_licence

        old = article.licence
        if item.licence == old:
            return
        if item.licence == UNKNOWN or not at_least_as_open(item.licence, old):
            self.warn(
                f'  {item.path.name}: the article is licensed {old}; the file says {item.licence}, '
                f'which is narrower — left as {old} (a licence cannot be taken back).'
            )
            return
        reason = change_licence(article, item.licence, author, note=f'import_concepts: {item.path.name}')
        if reason:
            self.warn(f'  {item.path.name}: licence left as {old} ({reason}).')
        else:
            self.stdout.write(f'  {item.path.name}: licence widened {old} → {item.licence}.')

    def link(self, concept: Concept, author, target_type: str, target_id: int, relation: str, label: str, item: Parsed, stats: dict) -> None:
        """One link, filed once — see the module docstring for how an existing row is reconciled."""
        from ...models import LINK_TARGET_MODELS

        content_type = ContentType.objects.get_by_natural_key(*LINK_TARGET_MODELS[target_type])
        existing = ConceptLink.objects.filter(
            concept=concept, content_type=content_type, object_id=target_id
        ).first()
        if existing is None:
            try:
                add_link(concept, author, target_type=target_type, target_id=target_id, relation=relation)
            except (Refused, LookupError, Conflict) as exc:
                self.warn(f'  {item.path.name}: link to {label} refused ({exc}).')
                return
            stats['links_added'] += 1
            return
        if existing.relation == relation:
            stats['links_kept'] += 1
            return
        if existing.origin == 'body' and relation == 'prerequisite':
            # The text mentions it as `[[slug]]`, which harvested a `related` row; the file says it
            # is a prerequisite. Re-filed as a manual row so the relation survives — a `body` row
            # would be recomputed back to `related` (or deleted) by the next harvest.
            ConceptLink.objects.filter(pk=existing.pk).update(
                origin='manual', relation='prerequisite', added_by=author
            )
            stats['links_changed'] += 1
            return
        if existing.origin == 'manual' and existing.added_by_id == author.pk:
            ConceptLink.objects.filter(pk=existing.pk).update(relation=relation)
            stats['links_changed'] += 1
            return
        if existing.origin == 'body':
            stats['links_kept'] += 1  # a related body row for a `related:` entry is the same claim
            return
        self.warn(
            f'  {item.path.name}: {label} is already linked as {existing.relation} by somebody else — '
            f'left (the file says {relation}).'
        )

    def mark_ai_assisted(self, article, author, note: str, stats: dict) -> None:
        from provenance.models import AuthorMark

        content_type = ContentType.objects.get_for_model(type(article))
        mark = AuthorMark.objects.filter(content_type=content_type, object_id=article.pk).first()
        if mark is not None and mark.assisted and mark.note == note:
            stats['ai_kept'] += 1
            return
        AuthorMark.objects.update_or_create(
            content_type=content_type,
            object_id=article.pk,
            defaults={'assisted': True, 'note': note, 'declared_by': author},
        )
        stats['ai_marked'] += 1

    def warn(self, line: str) -> None:
        self.stdout.write(self.style.WARNING(line))

    # ---- the run ---------------------------------------------------------------------------

    def handle(self, *args, **options):
        directory = Path(options['directory']).expanduser().resolve()
        if not directory.is_dir():
            raise CommandError(f'Not a directory: {directory}')

        author = get_user_model().objects.filter(username=options['author']).first()
        if author is None:
            raise CommandError(f'No user named {options["author"]!r} to write the articles.')
        blocked = link_block_reason(author)
        if blocked:
            # `minor`: a minor never publishes without review and never files a link (concepts/access.py).
            raise CommandError(f'{author.username} cannot publish and link concepts directly ({blocked}).')

        files = self.collect_files(directory)
        failures: list[str] = []
        batch_cache: dict = {}
        parsed: list[Parsed] = []
        for path in files:
            defaults = self.batch_defaults(path, directory, batch_cache, failures)
            item, errors = self.parse(path, defaults, options)
            failures.extend(f'{path}: {e}' for e in errors)
            parsed.append(item)

        # The database checks run over EVERY file, including ones the parser already refused, so a
        # single run names every problem in the batch (a malformed entry is skipped there, having
        # been named once above) — fixing one list only to be shown the next is the loop this avoids.
        reference_failures, warnings = self.check_references(
            parsed, author, options['skip_missing_exercises']
        )
        failures.extend(reference_failures)

        if failures:
            self.stderr.write(self.style.ERROR(f'{len(failures)} problem(s); nothing was imported:'))
            for line in failures:
                self.stderr.write(f'  - {line}')
            raise CommandError('Fix the files above and run again.')
        for line in warnings:
            self.warn(f'  {line}')

        stats = {
            'created': 0, 'revised': 0, 'unchanged': 0, 'articles_added': 0, 'skipped': 0,
            'links_added': 0, 'links_changed': 0, 'links_kept': 0, 'ai_marked': 0, 'ai_kept': 0,
        }
        dry_run = options['dry_run']
        ai_note = options['ai_assisted']
        with transaction.atomic():
            done: list[tuple[Parsed, Concept, Any]] = []
            for item in parsed:  # pass 1: every concept and its text
                concept, article, outcome = self.apply(item, author, stats)
                done.append((item, concept, article))
                self.stdout.write(f'  {item.path.name} → {item.slug} [{item.audience}/{item.locale}] {outcome}')

            for item, concept, article in done:  # pass 2: links, now that every target exists
                if article is None:
                    continue  # the author's article is hidden: the file is not acted on at all
                for key, relation in (('prerequisites', 'prerequisite'), ('related', 'related')):
                    for slug in getattr(item, key):
                        target = Concept.objects.get(slug=slug)
                        self.link(concept, author, 'concept', target.pk, relation, f'concept {slug}', item, stats)
                for ref, exercise_id in item.exercise_ids.items():
                    self.link(concept, author, 'exercise', exercise_id, 'related', f'exercise {ref}', item, stats)

            for _item, concept, _article in done:  # pass 3: the body links, recounted
                harvest_body_links(concept)

            if ai_note is not None:
                for _item, _concept, article in done:
                    if article is not None:
                        self.mark_ai_assisted(article, author, ai_note.strip(), stats)

            if dry_run:
                self.warn('--dry-run: rolling the transaction back.')
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            '{created} created, {revised} revised, {unchanged} unchanged, {articles_added} new article(s) '
            'on existing concepts, {skipped} skipped.'.format(**stats)
        ))
        self.stdout.write(self.style.SUCCESS(
            'links: {links_added} added, {links_changed} re-filed, {links_kept} already there.'.format(**stats)
        ))
        if ai_note is not None:
            self.stdout.write(self.style.SUCCESS(
                'AI-assisted: {ai_marked} marked, {ai_kept} already marked.'.format(**stats)
            ))
        if not dry_run:
            self.stdout.write(
                'Nothing was announced (no feed row, no notification). Now re-run the content sweep: '
                '`manage.py dump_text_fields` then `npm run check:katex` in frontend/.'
            )
