#!/usr/bin/env python3
"""Extracts a curated, stratified slice of the real exercise corpus in
Database-of-Student-Exercise/content/ into frontend/src/lib/mocks/generated-exercises.json.

This is NOT the Phase 2 backend importer (see CLAUDE.md Section 12 for that plan) — it's a
Phase-1-only tool that produces typed mock fixtures for the fully-mocked SvelteKit frontend,
reusing real content instead of inventing synthetic filler data (per CLAUDE.md's own "use real
content, not invented placeholder data" instinct, Section 16). The front-matter/section parsing
logic mirrors Database-of-Student-Exercise/generator/builder.py's own parse_problem() closely on
purpose, since Phase 2's real importer will need the same shape.

Run from anywhere; paths are resolved relative to this file.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / 'Database-of-Student-Exercise' / 'content'
OUT = ROOT / 'frontend' / 'src' / 'lib' / 'mocks' / 'generated-exercises.json'

DIFFICULTY_MAP = {'latwe': 'easy', 'srednie': 'medium', 'trudne': 'hard'}
SOURCE_TYPE_MAP = {'Ćwiczenia': 'exercises', 'Egzamin': 'exam', 'Kolokwium': 'midterm'}

SECTION_ALIASES = {
    'treść': 'statement', 'tresc': 'statement',
    'wskazówka': 'hint', 'wskazowka': 'hint',
    'odpowiedź': 'answer', 'odpowiedz': 'answer',
    'rozwiązanie': 'solution', 'rozwiazanie': 'solution',
}


def yload(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding='utf-8')) or {}


def parse_exercise(path: Path, course_id: str) -> dict[str, Any]:
    raw = path.read_text(encoding='utf-8')
    m = re.match(r'\A---\s*\n(.*?)\n---\s*\n(.*)\Z', raw, re.S)
    if not m:
        raise ValueError(f'No YAML front matter: {path}')
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

    source = meta.get('source') or {}
    return {
        'id': str(meta['id']),
        'courseId': course_id,
        'number': int(meta.get('number', 0)),
        'topics': list(meta.get('topics', [])),
        'difficulty': DIFFICULTY_MAP[meta['difficulty']],
        'source': {
            'type': SOURCE_TYPE_MAP.get(source.get('type'), 'other'),
            'name': source.get('name', ''),
            'collection': source.get('collection', ''),
            'originalProblemNumber': source.get('original_problem_number'),
            'pages': str(source.get('pages', '')) if source.get('pages') is not None else '',
            'chapter': source.get('chapter'),
        },
        'tags': list(meta.get('tags', [])),
        'published': bool(meta.get('published', True)),
        'verified': bool(meta.get('verified', False)),
        'title': str(meta['title']),
        **sections,
    }


def stratified_sample(course_dir: Path, course_id: str, per_bucket: int) -> list[dict[str, Any]]:
    """Picks `per_bucket` exercises from each difficulty bucket, spread across the number range
    (not just the first N) so the sample also spans multiple topics in practice."""
    files = sorted((course_dir / 'zadania').glob('*.md'))
    buckets: dict[str, list[Path]] = {'latwe': [], 'srednie': [], 'trudne': []}
    for f in files:
        raw = f.read_text(encoding='utf-8')
        m = re.match(r'\A---\s*\n(.*?)\n---\s*\n', raw, re.S)
        meta = yaml.safe_load(m.group(1))
        buckets.setdefault(meta['difficulty'], []).append(f)

    picked: list[Path] = []
    for diff, paths in buckets.items():
        if not paths:
            continue
        step = max(1, len(paths) // per_bucket)
        picked.extend(paths[::step][:per_bucket])

    return [parse_exercise(p, course_id) for p in sorted(set(picked), key=lambda p: p.name)]


def main() -> None:
    fields = [yload(p) for p in sorted((CORPUS / 'fields').glob('*.yaml'))]

    course_dirs = {
        'uw-matematyka-am2': 6,
        'uw-matematyka-rp1': 6,
    }
    courses = []
    exercises: list[dict[str, Any]] = []

    for course_id, per_bucket in course_dirs.items():
        cdir = CORPUS / 'courses' / course_id
        course = yload(cdir / 'course.yaml')
        courses.append(course)
        exercises.extend(stratified_sample(cdir, course_id, per_bucket))

    # The two stub fields (informatyka, fizyka) get their one real exercise each, so every field
    # has at least something to browse — matches the source corpus's own current state honestly
    # (Section 3 of CLAUDE.md already documents these as stubs, not full courses).
    for course_id in ['uw-informatyka-am1', 'uw-fizyka-analiza1']:
        cdir = CORPUS / 'courses' / course_id
        course = yload(cdir / 'course.yaml')
        courses.append(course)
        for f in sorted((cdir / 'zadania').glob('*.md')):
            exercises.append(parse_exercise(f, course_id))

    (OUT.parent).mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({'fields': fields, 'courses': courses, 'exercises': exercises}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'Wrote {OUT.relative_to(ROOT)}: {len(fields)} fields, {len(courses)} courses, {len(exercises)} exercises')


if __name__ == '__main__':
    main()
