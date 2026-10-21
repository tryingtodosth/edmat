"""Phase 4 hardening: the "real, mechanical LaTeX-compatibility check" Section 11's own ⚠️ has
called for since Phase 1 — dumps every translatable text field in the corpus (every
ExerciseTranslation's title/statement/hint/answer/solution, every MaterialTranslation's title/
description) as one JSON blob, fed to a standalone Node script that runs the EXACT SAME rendering
logic as frontend/src/lib/utils/renderContent.ts and scans for KaTeX errors or leftover, unprocessed
`\\( \\) \\[ \\]` delimiters. Kept as a real, reusable management command (not a one-off script)
since a corpus-wide compatibility check is exactly the kind of thing worth re-running after any
future bulk import or edit.
"""

import json

from django.core.management.base import BaseCommand

from exercises.models import ExerciseTranslation
from materials.models import MaterialTranslation


class Command(BaseCommand):
    help = 'Dumps every translatable text field as JSON, for the KaTeX-compatibility sweep.'

    def add_arguments(self, parser):
        parser.add_argument('--out', default='/tmp/edmat_text_fields.json')

    def handle(self, *args, **options):
        fields = []
        for t in ExerciseTranslation.objects.select_related('exercise').all():
            fields.append(
                {
                    'kind': 'exercise',
                    'id': t.exercise_id,
                    'locale': t.locale,
                    'status': t.status,
                    'ref': str(t.exercise),
                    'title': t.title,
                    'statement': t.statement,
                    'answer': t.answer,
                }
            )
        # A part's sub-statement and answer (`ExercisePartTranslation`, §17CV) are rendered by the
        # same pipeline, so they are swept too — as `exercise` rows, which the sweep already reads.
        from exercises.models import ExercisePartTranslation

        for t in ExercisePartTranslation.objects.select_related('part__exercise').all():
            fields.append(
                {
                    'kind': 'exercise',
                    'id': t.part.exercise_id,
                    'locale': t.locale,
                    'status': t.status,
                    'ref': str(t.part),
                    'title': '',
                    'statement': t.statement,
                    'answer': t.answer,
                }
            )
        from exercises.models import SolutionEntry

        for e in SolutionEntry.objects.select_related('exercise').all():
            fields.append(
                {
                    'kind': 'solution_entry',
                    'id': e.exercise_id,
                    'locale': e.locale,
                    'status': e.status,
                    'ref': str(e.exercise),
                    e.kind: e.body,
                }
            )
        for t in MaterialTranslation.objects.select_related('material').all():
            fields.append(
                {
                    'kind': 'material',
                    'id': t.material_id,
                    'locale': t.locale,
                    'status': 'published',
                    'ref': str(t.material),
                    'title': t.title,
                    'description': t.description,
                }
            )
        # Concept pages (2026-10-21, for `import_concepts`): the head of every article, its markdown
        # blocks joined under `description` — the checker's generic branch renders that key through
        # `renderContent`, which is what the concept page runs a markdown block through. A `latex`
        # block is a bare formula the page wraps in `\[ … \]` itself; it is wrapped here the same
        # way so KaTeX sees what a reader's page does.
        from concepts.models import ConceptRevision

        for r in ConceptRevision.objects.filter(status='published').select_related('article__concept'):
            parts = []
            for block in r.blocks or []:
                if block.get('kind') == 'markdown':
                    parts.append(block.get('body') or '')
                elif block.get('kind') == 'latex':
                    parts.append('\\[' + (block.get('source') or '') + '\\]')
            fields.append(
                {
                    'kind': 'concept',
                    'id': r.article_id,
                    'locale': r.article.locale,
                    'status': r.status,
                    'ref': f'{r.article.concept.slug} [{r.article.audience}/{r.article.locale}] rev {r.number}',
                    'title': r.title,
                    'description': '\n\n'.join(parts),
                }
            )
        with open(options['out'], 'w', encoding='utf-8') as f:
            json.dump(fields, f)
        self.stdout.write(self.style.SUCCESS(f'Wrote {len(fields)} translation rows to {options["out"]}'))
