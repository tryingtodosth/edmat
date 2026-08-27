# Companion to exercises.0010/0011 (hints/solutions moved off ExerciseTranslation into the
# SolutionEntry pool): a PENDING EditSuggestion against the old 'hint'/'solution' translation
# fields would, after the move, target a column that no longer exists — `_apply_edit_suggestion`
# could never apply it. Retargeted here onto the pinned entry the field's text migrated into
# (same exercise, same kind, same locale), as a 'body' suggestion — the exact row a moderator
# approving it would now be editing. Where no such entry exists (the field was empty, so there is
# nothing the suggestion could be a change TO), the suggestion is rejected with a note saying why,
# rather than left pending forever against a target that cannot be resolved.
#
# Decided suggestions (approved/rejected) keep their historical field names untouched — they are a
# record of what was decided, not something anything will try to apply again.

from django.db import migrations


def forwards(apps, schema_editor):
    EditSuggestion = apps.get_model('moderation', 'EditSuggestion')
    SolutionEntry = apps.get_model('exercises', 'SolutionEntry')

    for suggestion in EditSuggestion.objects.filter(
        status='pending', field__in=('hint', 'solution'), entry__isnull=True
    ).iterator():
        entry = (
            SolutionEntry.objects.filter(
                exercise_id=suggestion.exercise_id,
                kind=suggestion.field,
                locale=suggestion.locale,
                status='published',
                pinned=True,
            )
            .order_by('id')
            .first()
        )
        if entry is not None:
            suggestion.entry_id = entry.pk
            suggestion.field = 'body'
            suggestion.save(update_fields=['entry', 'field'])
        else:
            suggestion.status = 'rejected'
            suggestion.review_note = (
                'Closed during the solutions-and-hints migration: this suggested adding a '
                f'{suggestion.field} where none existed. Hints and solutions are now their own '
                'entries — please submit yours as a new one on the exercise page.'
            )
            suggestion.save(update_fields=['status', 'review_note'])


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0023_editsuggestion_entry'),
        ('exercises', '0010_migrate_hints_solutions_to_entries'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
