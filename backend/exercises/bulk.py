"""A user's bulk upload of exercises — the rule `POST /api/exercise-imports/` asks (root CLAUDE.md
boundary 2), 2026-10-22.

Owner: *"empower users to feed the DB with their own exercises in bulk — we do it by uploading .md
and executing a script on them, so it should also work (with a bunch of security checks and
sanitization) for every user"*. Decided the same day: **a verified contributor's files publish at
once; everybody else's become pending `ExerciseSubmission`s in the moderation queue** — exactly the
split `/submit` already has (`moderation/views.py: ExerciseSubmissionViewSet.perform_create`), and
through the same `_apply_submission`, so a bulk-published exercise and a `/submit`-published one
are built by one function.

## The file format is the operator's, the authority is not

Files are read by `exercises/importing.py` — the parser `manage.py import_exercises` uses — so a
file one accepts the other reads identically. What a person may do with it is narrower than what
the operator's command does, and every difference is a refusal or a warning here, never a silent
difference:

| The operator (`import_exercises`) | A person (this module) |
|---|---|
| updates a row by `(branch, number)` | **never updates anything**: `number:` is ignored (warning `number_ignored`) and a number is allocated on publication, the way `/submit` allocates one |
| `--author` credits anybody | the caller is the author, always |
| `--create-topics` | only topics the branch already has (`topic_not_in_branch`) |
| `licence: unknown` (rights unclear) | refused — `unknown` is never a person's choice (`licence_not_selectable`); default `edmat-only` |
| `published: false` stages a hidden row | refused (`published_false`) — a hidden staging state is the operator's tool |
| pinned hint/solution | pinned only if a moderator approved it, exactly as `/submit` |
| any branch | an APPROVED branch (`branch_not_found` otherwise) |
| any new tag slug | a tag the site already has, or a new one through `tags.py`'s own rules (`tag_refused`), at most `MAX_NEW_TAGS` new per upload; a minor reuses tags but mints none |

## What is checked before a byte is parsed

`MAX_FILES` files, `MAX_FILE_BYTES` each, `MAX_TOTAL_BYTES` together, `.md` only (plus at most one
`batch.yaml`), strict UTF-8, a front matter of at most `MAX_FRONT_MATTER_BYTES`, YAML through a
SAFE loader that also refuses anchors and aliases (`_NoAliasLoader` — a "billion laughs" document
is a few hundred bytes of aliases), and values of the type each key means (`value_type`). The
uploaded filename is shown back to the person and used for nothing else: it is reduced to a
basename with control characters stripped (`display_name`) and never touches the filesystem —
nothing an upload sends is stored as a file at all.

## Sanitized on write, here, and again on save

The payload a pending submission carries is passed through `config/sanitize.py` before it is
written (house rule 8) — a moderator reviewing a pending bulk file is already rendering it — and
the rows `_apply_submission` builds sanitize themselves again in `save()`. A body whose HTML the
sanitizer had to cut is reported (`html_removed`) rather than silently changed.

## Preview, then commit — and what "all-or-nothing" means

`preview` parses and validates everything and writes nothing. `commit` runs the SAME validation
again on the files it is sent (a preview is never trusted — the branch or a topic may have gone in
between) and **writes only if every file is clean**; one refusal anywhere refuses the whole upload
with the full report, 400. The writes themselves are one submission per file, each in its own
transaction (`backend/CLAUDE.md` SQLite rule 2 — one atomic block around fifty multi-table applies
would hold the single writer lock for the whole batch); the response lists every row it made.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

import yaml

from config.sanitize import sanitize_content

from .importing import DIFFICULTY_ALIASES, Parsed, parse_file
from .parts import MAX_PARTS

#: Caps per upload. A course's whole problem sheet is 10–40 files of 2–8 KB; the largest file in
#: the real corpus (with inline SVG) is under 60 KB. These leave room and refuse a dump.
MAX_FILES = 50
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_FRONT_MATTER_BYTES = 16 * 1024
MAX_NEW_TAGS = 20
MAX_TAGS_PER_FILE = 15
MAX_NAME_LENGTH = 120

#: `batch.yaml` keys a person may set. `branch` is overridden by the form; `topic_names` is the
#: operator's `--create-topics` vocabulary and is ignored with a warning.
BATCH_KEYS = {'branch', 'locale', 'audience', 'licence', 'difficulty', 'topic_names'}

#: A locale is a language tag, not free text (`pl`, `en`, `pt-BR`); `ExerciseTranslation.locale`
#: is eight characters.
LOCALE_RE = re.compile(r'^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$')

#: The HTML the sanitizer is there to remove — matched only to SAY that it removed something.
_DANGEROUS_HTML = re.compile(
    r'<\s*(?:script|iframe|object|embed|style|link|meta|form|input|foreignobject)\b|\son[a-z]+\s*=|javascript:',
    re.I,
)

#: The refusal words (house rule 6), mirrored in the frontend's `labels.ts:
#: BULK_UPLOAD_REFUSAL_LABELS` — a new word is a change in both files.
UPLOAD_REFUSALS = (
    'no_files', 'too_many_files', 'total_too_large', 'branch_not_found', 'batch_yaml_invalid',
    'batch_yaml_twice', 'too_many_new_tags', 'licence_not_selectable',
)
FILE_REFUSALS = (
    'not_markdown', 'file_too_large', 'not_utf8', 'front_matter_too_large', 'format',
    'value_type', 'licence_not_selectable', 'published_false', 'locale_invalid',
    'topic_not_in_branch', 'tag_refused', 'duplicate_name',
)
WARNINGS = ('number_ignored', 'id_ignored', 'source_type_other', 'html_removed', 'topic_names_ignored')


class _NoAliasLoader(yaml.SafeLoader):
    """`yaml.SafeLoader` (no `!!python/…` tags — those are a `ConstructorError`) that also refuses
    anchors and aliases: a front matter never needs one, and a few hundred bytes of nested aliases
    expand into gigabytes the moment anything walks the result."""

    def compose_node(self, parent, index):
        if self.check_event(yaml.events.AliasEvent):
            event = self.peek_event()
            raise yaml.composer.ComposerError(
                None, None, 'anchors and aliases are not accepted here', event.start_mark
            )
        return super().compose_node(parent, index)


def display_name(raw_name: str) -> str:
    """The uploaded filename as something safe to SHOW: the last path component under either path
    convention (`../../etc/x.md` → `x.md`, `C:\\a\\b.md` → `b.md`), control and format characters
    dropped, trimmed to `MAX_NAME_LENGTH`. Used for nothing but the report."""
    name = PureWindowsPath(PurePosixPath(str(raw_name or '')).name).name
    name = ''.join(ch for ch in name if unicodedata.category(ch)[0] != 'C').strip()
    return name[:MAX_NAME_LENGTH] or 'unnamed'


@dataclass
class FileReport:
    name: str
    title: str = ''
    parts: int = 0
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    payload: dict | None = None

    def refuse(self, code: str, detail: str = '') -> None:
        assert code in FILE_REFUSALS, code
        self.errors.append({'code': code, 'detail': detail})

    def warn(self, code: str, detail: str = '') -> None:
        assert code in WARNINGS, code
        self.warnings.append({'code': code, 'detail': detail})

    def as_dict(self) -> dict:
        return {
            'name': self.name,
            'ok': not self.errors,
            'title': self.title,
            'parts': self.parts,
            'errors': self.errors,
            'warnings': self.warnings,
        }


@dataclass
class UploadReport:
    branch: str = ''
    mode: str = 'queue'  # 'publish' for a verified contributor or staff, 'queue' otherwise
    errors: list[dict] = field(default_factory=list)
    files: list[FileReport] = field(default_factory=list)
    new_tags: list[str] = field(default_factory=list)
    batch_id: str = ''

    @property
    def ok(self) -> bool:
        return not self.errors and bool(self.files) and all(not f.errors for f in self.files)

    def refuse(self, code: str, detail: str = '') -> None:
        assert code in UPLOAD_REFUSALS, code
        self.errors.append({'code': code, 'detail': detail})

    def as_dict(self) -> dict:
        return {
            'ok': self.ok,
            'branch': self.branch,
            'mode': self.mode,
            'errors': self.errors,
            'new_tags': self.new_tags,
            'files': [f.as_dict() for f in self.files],
            'limits': {
                'files': MAX_FILES,
                'file_bytes': MAX_FILE_BYTES,
                'total_bytes': MAX_TOTAL_BYTES,
                'parts': MAX_PARTS,
            },
        }


def publishes_directly(user) -> bool:
    """The same answer `ExerciseSubmissionViewSet.perform_create` gives: a verified contributor's
    new exercise goes live without review. Staff too, as everywhere a moderator acts."""
    if getattr(user, 'is_staff', False):
        return True
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.is_verified_contributor)


def _scalar(value) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _type_problems(meta: dict) -> list[str]:
    """Each front-matter key must hold what it means — a mapping under `title:` would be
    `str()`-ed into the page otherwise."""
    problems = []
    for key in ('title', 'difficulty', 'audience', 'locale', 'licence', 'number', 'id', 'published'):
        if key in meta and not _scalar(meta[key]):
            problems.append(f'`{key}:` must be a single value')
    for key in ('topics', 'tags'):
        value = meta.get(key)
        if value is None or isinstance(value, str):
            continue
        if not isinstance(value, list) or not all(isinstance(v, (str, int)) for v in value):
            problems.append(f'`{key}:` must be a list of names')
    source = meta.get('source')
    if source is not None and not (
        isinstance(source, dict) and all(isinstance(k, str) and _scalar(v) for k, v in source.items())
    ):
        problems.append('`source:` must be a mapping of single values')
    return problems


def _decode(name: str, data: bytes, report: FileReport) -> str | None:
    if len(data) > MAX_FILE_BYTES:
        report.refuse('file_too_large', f'{len(data)} > {MAX_FILE_BYTES}')
        return None
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        report.refuse('not_utf8')
        return None
    if text.startswith('\ufeff'):
        text = text[1:]
    return text.replace('\r\n', '\n').replace('\r', '\n')


def _load_batch_yaml(text: str, report: UploadReport) -> dict:
    try:
        data = yaml.load(text, Loader=_NoAliasLoader) or {}
    except yaml.YAMLError as exc:
        report.refuse('batch_yaml_invalid', str(exc).splitlines()[0][:200])
        return {}
    if not isinstance(data, dict) or not all(isinstance(k, str) and (_scalar(v) or k == 'topic_names') for k, v in data.items()):
        report.refuse('batch_yaml_invalid', 'batch.yaml must be a mapping of single values')
        return {}
    unknown = sorted(set(data) - BATCH_KEYS)
    if unknown:
        report.refuse('batch_yaml_invalid', f'unknown key(s): {", ".join(unknown)}')
        return {}
    return data


def _payload(item: Parsed, topic_ids: list[str], tags: list[str], ai_assisted: bool, batch: str, name: str) -> dict:
    """The submission draft, in the shape `_apply_submission` reads (the `/submit` form's own keys,
    `ExerciseSubmissionDraft` on the frontend), sanitized now so the queue never holds raw HTML."""
    clean = sanitize_content
    source = {k: v for k, v in (item.source or {}).items() if k in (
        'type', 'name', 'collection', 'original_problem_number', 'pages', 'chapter'
    )}
    if source.get('name'):
        source['name'] = clean(str(source['name']))[:300]
    if source.get('collection'):
        source['collection'] = clean(str(source['collection']))[:200]
    if source.get('pages') is not None:
        source['pages'] = str(source['pages'])[:50]
    return {
        'title': clean(item.title)[:300],
        'statement': clean(item.statement),
        'answer': clean(item.answer),
        'hint': clean(item.hint),
        'solution': clean(item.solution),
        'difficulty': item.difficulty,
        'audience': item.audience,
        'locale': item.locale,
        'licence': item.licence,
        'topicIds': topic_ids,
        'tags': tags,
        'source': source,
        'parts': [
            {
                'label': p.label,
                'statement': clean(p.statement),
                'answer': clean(p.answer),
                'hint': clean(p.hint),
                'solution': clean(p.solution),
            }
            for p in item.parts
        ],
        'ai_assisted': bool(ai_assisted),
        'bulk': {'batch': batch, 'file': name},
    }


def _bodies(item: Parsed):
    yield item.title
    yield item.statement
    yield item.answer
    yield item.hint
    yield item.solution
    for part in item.parts:
        yield part.statement
        yield part.answer
        yield part.hint
        yield part.solution


def validate_upload(user, branch_slug: str, files: list[tuple[str, bytes]], *, licence: str = '', ai_assisted: bool = False) -> UploadReport:
    """Everything `preview` and `commit` both say, writing nothing. `files` is `[(uploaded name,
    bytes), …]` as the request carried them."""
    from accounts.minors import is_minor
    from licensing.licences import DEFAULT_LICENCE, licence_validation_error
    from taxonomy.models import Branch

    from .tags import fold, matching_tag, name_refusal

    report = UploadReport(branch=branch_slug or '', mode='publish' if publishes_directly(user) else 'queue')
    batch_id = uuid.uuid4().hex

    if not files:
        report.refuse('no_files')
        return report
    if len(files) > MAX_FILES + 1:  # + one batch.yaml
        report.refuse('too_many_files', f'{len(files)} > {MAX_FILES}')
        return report
    total = sum(len(data) for _name, data in files)
    if total > MAX_TOTAL_BYTES:
        report.refuse('total_too_large', f'{total} > {MAX_TOTAL_BYTES}')
        return report

    branch = Branch.objects.filter(slug=branch_slug or '', status='approved').first()
    if branch is None:
        report.refuse('branch_not_found', branch_slug or '')

    form_licence = (licence or '').strip()
    if form_licence and licence_validation_error(form_licence):
        report.refuse('licence_not_selectable', form_licence)

    defaults: dict[str, Any] = {}
    markdown: list[tuple[str, bytes]] = []
    seen_batch_yaml = False
    for raw_name, data in files:
        name = display_name(raw_name)
        if name.lower() == 'batch.yaml':
            if seen_batch_yaml:
                report.refuse('batch_yaml_twice')
                continue
            seen_batch_yaml = True
            holder = FileReport(name=name)
            text = _decode(name, data, holder)
            if text is None:
                report.refuse('batch_yaml_invalid', holder.errors[0]['code'])
                continue
            defaults = _load_batch_yaml(text, report)
            continue
        markdown.append((name, data))
    if len(markdown) > MAX_FILES:
        report.refuse('too_many_files', f'{len(markdown)} > {MAX_FILES}')
        return report
    if not markdown:
        report.refuse('no_files')
        return report

    topic_names_given = 'topic_names' in defaults
    defaults.pop('branch', None)
    defaults.pop('topic_names', None)
    defaults['licence'] = form_licence or defaults.get('licence') or DEFAULT_LICENCE

    topics = {t.slug: str(t.pk) for t in branch.topics.all()} if branch else {}
    new_tags: dict[str, str] = {}
    minor = is_minor(user)
    names_seen: set[str] = set()

    for name, data in markdown:
        file_report = FileReport(name=name)
        report.files.append(file_report)
        if name in names_seen:
            file_report.refuse('duplicate_name')
        names_seen.add(name)
        if not name.lower().endswith('.md'):
            file_report.refuse('not_markdown')
            continue
        text = _decode(name, data, file_report)
        if text is None:
            continue
        head = text.split('\n---', 1)[0] if text.startswith('---') else ''
        if len(head.encode('utf-8')) > MAX_FRONT_MATTER_BYTES:
            file_report.refuse('front_matter_too_large', f'> {MAX_FRONT_MATTER_BYTES}')
            continue

        notes: list[str] = []
        item, errors = parse_file(
            PurePosixPath(name), defaults, {}, raw=text, loader=_NoAliasLoader, warn=notes.append
        )
        for note in notes:
            file_report.warn('source_type_other', note)
        for error in errors:
            file_report.refuse('format', error)
        file_report.title = item.title
        file_report.parts = len(item.parts)

        meta = _front_matter(text)
        for problem in _type_problems(meta):
            file_report.refuse('value_type', problem)
        if 'number' in meta:
            file_report.warn('number_ignored', str(meta.get('number')))
        if 'id' in meta:
            file_report.warn('id_ignored')
        if meta.get('published') is False or str(meta.get('published')).lower() == 'false':
            file_report.refuse('published_false')
        if not LOCALE_RE.match(item.locale or ''):
            file_report.refuse('locale_invalid', item.locale)
        if item.licence and licence_validation_error(item.licence):
            file_report.refuse('licence_not_selectable', item.licence)
        if item.difficulty and item.difficulty not in DIFFICULTY_ALIASES.values():
            file_report.refuse('format', f'difficulty {item.difficulty!r}')

        if branch is not None:
            for slug in item.topics:
                if slug not in topics:
                    file_report.refuse('topic_not_in_branch', slug)
        tag_slugs: list[str] = []
        if len(item.tags) > MAX_TAGS_PER_FILE:
            file_report.refuse('tag_refused', f'{len(item.tags)} tags > {MAX_TAGS_PER_FILE}')
        for raw_tag in item.tags[:MAX_TAGS_PER_FILE]:
            word = name_refusal(str(raw_tag))
            if word:
                file_report.refuse('tag_refused', f'{raw_tag}: {word}')
                continue
            existing = matching_tag(str(raw_tag))
            if existing is not None:
                if existing.is_removed:
                    file_report.refuse('tag_refused', f'{raw_tag}: tag_removed')
                    continue
                slug = existing.slug
            else:
                if minor:
                    file_report.refuse('tag_refused', f'{raw_tag}: minor_cannot_create_tag')
                    continue
                slug = fold(str(raw_tag))[:50].strip('-')
                new_tags[slug] = slug
            if slug not in tag_slugs:
                tag_slugs.append(slug)

        if any(body and _DANGEROUS_HTML.search(body) for body in _bodies(item)):
            file_report.warn('html_removed')

        if not file_report.errors:
            file_report.payload = _payload(
                item, [topics[s] for s in item.topics if s in topics], tag_slugs, ai_assisted, batch_id, name
            )

    if topic_names_given and report.files:
        report.files[0].warn('topic_names_ignored')
    report.new_tags = sorted(new_tags)
    if len(new_tags) > MAX_NEW_TAGS:
        report.refuse('too_many_new_tags', f'{len(new_tags)} > {MAX_NEW_TAGS}')
    report.batch_id = batch_id
    return report


def _front_matter(text: str) -> dict:
    from .importing import FRONT_MATTER

    match = FRONT_MATTER.match(text)
    if not match:
        return {}
    try:
        meta = yaml.load(match.group(1), Loader=_NoAliasLoader) or {}
    except yaml.YAMLError:
        return {}
    return meta if isinstance(meta, dict) else {}


def commit_upload(user, report: UploadReport) -> list[dict]:
    """Write a CLEAN report (the caller checked `report.ok`): one `ExerciseSubmission` per file,
    applied at once for a verified contributor (the `/submit` fast path, word for word), queued
    otherwise. Returns one row per file: `{name, submission, status, exercise}`."""
    from django.db import transaction
    from taxonomy.models import Branch

    from moderation.models import ExerciseSubmission
    from moderation.views import _apply_submission

    assert report.ok
    branch = Branch.objects.get(slug=report.branch)
    direct = report.mode == 'publish'
    rows = []
    for file_report in report.files:
        with transaction.atomic():
            submission = ExerciseSubmission.objects.create(
                branch=branch,
                submitted_by=user,
                payload=file_report.payload,
                upload_batch=report.batch_id,
            )
            if direct:
                _apply_submission(submission, user)
                submission.status = 'approved'
                submission.review_note = 'Auto-published — bulk upload by a verified contributor.'
                submission.save(update_fields=['status', 'review_note', 'resulting_exercise'])
        rows.append({
            'name': file_report.name,
            'submission': submission.pk,
            'status': submission.status,
            'exercise': submission.resulting_exercise_id,
        })
    return rows
