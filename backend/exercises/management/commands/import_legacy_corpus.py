"""CLAUDE.md Section 12 — the one-time (repeatable/idempotent) import from
Database-of-Student-Exercise/content/ into the real Django models. Reuses the exact parsing LOGIC
already proven in generator/builder.py's parse_problem() and scripts/extract_mock_exercises.py's
parse_exercise() (front-matter + `##`-section split, the same difficulty/source-type Polish→English
maps) — not the code itself, since the target here is Django ORM objects, not a JSON catalog.

Idempotent by design: every model is upserted by its real natural key (field slug, course slug,
(course, topic slug), (course, chapter number), (course, exercise number), (course, material slug))
via update_or_create, so re-running against updated source content never duplicates rows — Section
12's own "the source repo may keep receiving edits during a parallel-run period" requirement.

Usage:
    python manage.py import_legacy_corpus [--corpus-dir PATH] [--dry-run]
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import yaml
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from materials.models import Material, MaterialCoverage, MaterialTranslation
from taxonomy.models import Chapter, ChapterTranslation, Course, CourseTranslation, Field, FieldTranslation, Topic, TopicTranslation

from ...models import Exercise, ExerciseSource, ExerciseSourceTranslation, ExerciseTranslation, Tag

DIFFICULTY_MAP = {'latwe': 'easy', 'srednie': 'medium', 'trudne': 'hard'}
SOURCE_TYPE_MAP = {'Ćwiczenia': 'exercises', 'Egzamin': 'exam', 'Kolokwium': 'midterm'}
MATERIAL_TYPE_MAP = {
    'skrypt': 'script',
    'egzaminy': 'exam_collection',
    'kolokwia': 'midterm_collection',
    'zbior-zadan': 'exercise_collection',
}

# The source corpus's own material.yaml `topics:` list has no per-topic depth/subtopic data at
# all — just a flat slug list (confirmed by direct inspection of every material.yaml in the real
# corpus). MaterialCoverage needs a `level` (1-100), so migrated legacy materials get this neutral
# midpoint placeholder rather than a guessed number — flagged honestly, same "flag it, don't fake
# it" discipline this command already applies elsewhere (e.g. its own material-id collision note
# below), pending real community-submitted/voted levels replacing it over time.
DEFAULT_LEGACY_COVERAGE_LEVEL = 50

SECTION_ALIASES = {
    'treść': 'statement',
    'tresc': 'statement',
    'wskazówka': 'hint',
    'wskazowka': 'hint',
    'odpowiedź': 'answer',
    'odpowiedz': 'answer',
    'rozwiązanie': 'solution',
    'rozwiazanie': 'solution',
}

ORIGINAL_LOCALE = 'pl'  # every existing exercise/course/field/material is authored in Polish


def yload(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    if not isinstance(data, dict):
        raise CommandError(f'YAML must be a mapping: {path}')
    return data


def parse_exercise_file(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding='utf-8')
    m = re.match(r'\A---\s*\n(.*?)\n---\s*\n(.*)\Z', raw, re.S)
    if not m:
        raise CommandError(f'No YAML front matter: {path}')
    meta = yaml.safe_load(m.group(1)) or {}
    body = m.group(2)

    parts: dict[str, list[str]] = {v: [] for v in SECTION_ALIASES.values()}
    current: str | None = None
    for line in body.splitlines():
        h = re.match(r'^##\s+(.+?)\s*$', line)
        if h:
            current = SECTION_ALIASES.get(h.group(1).lower())
        elif current:
            parts[current].append(line)
    sections = {k: '\n'.join(v).strip() for k, v in parts.items()}

    return {
        'number': int(meta.get('number', 0)),
        'title': str(meta['title']),
        'topics': list(meta.get('topics', [])),
        'difficulty': DIFFICULTY_MAP[meta['difficulty']],
        'source': meta.get('source') or {},
        'tags': list(meta.get('tags', [])),
        'published': bool(meta.get('published', True)),
        'verified': bool(meta.get('verified', False)),
        **sections,
    }


class Command(BaseCommand):
    help = 'Imports the real corpus from Database-of-Student-Exercise/content/ into the DB (idempotent).'

    def add_arguments(self, parser):
        default_corpus = Path(settings.BASE_DIR).parent / 'Database-of-Student-Exercise' / 'content'
        parser.add_argument('--corpus-dir', default=str(default_corpus))
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        corpus = Path(options['corpus_dir'])
        if not corpus.exists():
            raise CommandError(f'Corpus directory not found: {corpus}')
        dry_run = options['dry_run']

        stats = {'fields': 0, 'courses': 0, 'topics': 0, 'chapters': 0, 'exercises': 0, 'materials': 0}

        with transaction.atomic():
            field_by_slug = self._import_fields(corpus, stats)
            for course_dir in sorted((corpus / 'courses').glob('*')):
                if not course_dir.is_dir() or not (course_dir / 'course.yaml').exists():
                    continue
                self._import_course(course_dir, field_by_slug, stats)

            if dry_run:
                self.stdout.write(self.style.WARNING('--dry-run: rolling back transaction.'))
                transaction.set_rollback(True)

        self.stdout.write(
            self.style.SUCCESS(
                'Imported: {fields} fields, {courses} courses, {topics} topics, {chapters} chapters, '
                '{exercises} exercises, {materials} materials'.format(**stats)
            )
        )

    def _import_fields(self, corpus: Path, stats: dict) -> dict[str, Field]:
        field_by_slug: dict[str, Field] = {}
        for path in sorted((corpus / 'fields').glob('*.yaml')):
            data = yload(path)
            slug = data['id']
            field, _ = Field.objects.update_or_create(
                slug=slug, defaults={'published': bool(data.get('published', True))}
            )
            FieldTranslation.objects.update_or_create(
                field=field,
                locale=ORIGINAL_LOCALE,
                defaults={'name': data.get('name', slug), 'description': data.get('description', '')},
            )
            field_by_slug[slug] = field
            stats['fields'] += 1
        return field_by_slug

    def _import_course(self, course_dir: Path, field_by_slug: dict[str, Field], stats: dict):
        data = yload(course_dir / 'course.yaml')
        slug = data['id']
        if slug != course_dir.name:
            raise CommandError(f'Course id must match directory name: {course_dir}')
        field = field_by_slug.get(data['field'])
        if field is None:
            raise CommandError(f'Unknown field {data["field"]!r} for course {slug}')

        course, _ = Course.objects.update_or_create(
            slug=slug,
            defaults={
                'field': field,
                'university': data.get('university', ''),
                'published': bool(data.get('published', True)),
            },
        )
        CourseTranslation.objects.update_or_create(
            course=course,
            locale=ORIGINAL_LOCALE,
            defaults={'name': data.get('name', slug), 'description': data.get('description', '')},
        )
        stats['courses'] += 1

        topic_by_slug: dict[str, Topic] = {}
        for order, t in enumerate(data.get('topics', [])):
            topic, _ = Topic.objects.update_or_create(
                course=course, slug=t['id'], defaults={'order': order}
            )
            TopicTranslation.objects.update_or_create(
                topic=topic, locale=ORIGINAL_LOCALE, defaults={'name': t.get('name', t['id'])}
            )
            topic_by_slug[t['id']] = topic
            stats['topics'] += 1

        chapters_path = course_dir / 'mapa_rozdzialow.yaml'
        if chapters_path.exists():
            chapters_data = yload(chapters_path)
            for c in chapters_data.get('chapters', []):
                chapter, _ = Chapter.objects.update_or_create(
                    course=course,
                    number=c['number'],
                    defaults={'start_page': c.get('start_page')},
                )
                ChapterTranslation.objects.update_or_create(
                    chapter=chapter,
                    locale=ORIGINAL_LOCALE,
                    defaults={'title': c.get('title', f'Chapter {c["number"]}')},
                )
                chapter.topics.set([topic_by_slug[t] for t in c.get('topics', []) if t in topic_by_slug])
                stats['chapters'] += 1

        exercises_dir = course_dir / 'zadania'
        if exercises_dir.exists():
            for path in sorted(exercises_dir.glob('*.md')):
                self._import_exercise(path, course, topic_by_slug, stats)

        materials_dir = course_dir / 'materialy'
        if materials_dir.exists():
            for mdir in sorted(materials_dir.glob('*')):
                if not mdir.is_dir() or not (mdir / 'material.yaml').exists():
                    continue
                self._import_material(mdir, course, topic_by_slug, stats)

    def _import_exercise(
        self, path: Path, course: Course, topic_by_slug: dict[str, Topic], stats: dict
    ):
        item = parse_exercise_file(path)
        exercise, _ = Exercise.objects.update_or_create(
            course=course,
            number=item['number'],
            defaults={
                'difficulty': item['difficulty'],
                'published': item['published'],
                'verified': item['verified'],
                'original_locale': ORIGINAL_LOCALE,
                'submitted_by': None,  # migrated legacy content, matching Section 9's own note
            },
        )
        exercise.topics.set([topic_by_slug[t] for t in item['topics'] if t in topic_by_slug])
        tags = [Tag.objects.get_or_create(slug=slug)[0] for slug in item['tags']]
        exercise.tags.set(tags)

        source_meta = item['source']
        if source_meta:
            source, _ = ExerciseSource.objects.update_or_create(
                exercise=exercise,
                defaults={
                    'type': SOURCE_TYPE_MAP.get(source_meta.get('type'), 'other'),
                    'collection': source_meta.get('collection', '') or '',
                    'original_problem_number': source_meta.get('original_problem_number'),
                    'pages': str(source_meta.get('pages', '')) if source_meta.get('pages') is not None else '',
                    'chapter': source_meta.get('chapter'),
                },
            )
            ExerciseSourceTranslation.objects.update_or_create(
                source=source, locale=ORIGINAL_LOCALE, defaults={'name': source_meta.get('name', '')}
            )

        ExerciseTranslation.objects.update_or_create(
            exercise=exercise,
            locale=ORIGINAL_LOCALE,
            status='published',
            defaults={
                'title': item['title'],
                'statement': item['statement'],
                'hint': item['hint'],
                'answer': item['answer'],
                'solution': item['solution'],
                'translated_by': None,  # the original, not a translation of anything
            },
        )
        stats['exercises'] += 1

    def _import_material(
        self, mdir: Path, course: Course, topic_by_slug: dict[str, Topic], stats: dict
    ):
        data = yload(mdir / 'material.yaml')
        # The directory name, not material.yaml's own `id:` field, is the natural unique key here —
        # a real, found-during-import data-quality bug in the source corpus itself: two distinct
        # materials under uw-matematyka-am2 (analiza-matematyczna-ii-cwiczenia/ and
        # am2-skrypt-dla-debila/, genuinely different title/type/file) share the exact same
        # copy-pasted `id:` value. Keying on `data['id']` silently collapsed them into one DB row on
        # the first import run (7 files processed, only 6 Material rows resulted) — a directory name
        # can't collide with a sibling directory's name, so it's the honest unique key, not the
        # free-text id a source file happens to claim.
        slug = mdir.name
        pdf_name = data['file']
        pdf_path = mdir / pdf_name
        if not pdf_path.exists():
            raise CommandError(f'Missing PDF: {pdf_path}')

        material, _ = Material.objects.update_or_create(
            course=course,
            slug=slug,
            defaults={
                'type': MATERIAL_TYPE_MAP.get(data.get('type'), 'other'),
                'author': data.get('author', ''),
                'published': bool(data.get('published', True)),
                'featured': bool(data.get('featured', False)),
            },
        )
        # A MaterialCoverage row per topic, subtopic=None (the source data has no subtopic
        # granularity to migrate, see DEFAULT_LEGACY_COVERAGE_LEVEL's own note above),
        # get_or_create'd (not update_or_create) on the (material, topic, subtopic=None) key —
        # deliberately so a re-run stays idempotent (no duplicate row) WITHOUT ever clobbering a
        # `level` the community has since discussed/voted away from the neutral default; `defaults=`
        # only ever applies on the initial creation.
        for topic_slug in data.get('topics', []):
            topic = topic_by_slug.get(topic_slug)
            if topic is None:
                continue
            MaterialCoverage.objects.get_or_create(
                material=material,
                topic=topic,
                subtopic=None,
                defaults={'level': DEFAULT_LEGACY_COVERAGE_LEVEL},
            )

        # Re-upload the PDF into MEDIA_ROOT/materials/ under a stable, collision-free name — copying
        # the file directly rather than going through Django's FieldFile.save() (which would append
        # a random suffix on every re-run) is what keeps this step idempotent too.
        media_dest = Path(settings.MEDIA_ROOT) / 'materials' / f'{course.slug}-{slug}{pdf_path.suffix}'
        media_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pdf_path, media_dest)
        material.file.name = f'materials/{media_dest.name}'
        material.save(update_fields=['file'])

        MaterialTranslation.objects.update_or_create(
            material=material,
            locale=ORIGINAL_LOCALE,
            defaults={'title': data.get('title', slug), 'description': data.get('description', '')},
        )
        stats['materials'] += 1
