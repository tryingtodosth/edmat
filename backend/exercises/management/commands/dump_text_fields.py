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
                    'hint': t.hint,
                    'answer': t.answer,
                    'solution': t.solution,
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
        with open(options['out'], 'w', encoding='utf-8') as f:
            json.dump(fields, f)
        self.stdout.write(self.style.SUCCESS(f'Wrote {len(fields)} translation rows to {options["out"]}'))
