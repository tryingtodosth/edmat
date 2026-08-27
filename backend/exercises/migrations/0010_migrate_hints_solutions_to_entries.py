# The one-shot move of every hint/solution out of ExerciseTranslation into the new SolutionEntry
# pool (the peer-solutions feature, 2026-08-27 — see SolutionEntry's own model docstring for the
# design). Runs BEFORE 0011 drops the two columns, so the historical model here still carries them.
#
# Mapping, decided with the owner rather than defaulted to:
# - a PUBLISHED translation's hint/solution -> a published, PINNED entry (these are the originals;
#   "the currently attached ones should be pinned"), author = the translation's own translated_by
#   (None for the migrated corpus — the same honesty Exercise.submitted_by already carries).
# - a PENDING translation's hint/solution -> a pending, unpinned entry by the same author. The
#   translation flow itself no longer carries these two fields at all, so text sitting in a pending
#   translation would otherwise be silently lost on approval.
# - a REJECTED translation's are skipped — rejected text was never going to be shown, and the
#   rejection verdict covered the whole translation.
#
# Exercise.verified is then RECOMPUTED under its new, derived meaning (at least one published
# solution that passed review — pinned, reviewed, or by a verified contributor; signals.py's
# recount_verified is the live twin of the bulk pass here). A real, counted consequence, stated
# rather than hidden: 389 corpus exercises carried a full solution while verified=False (the corpus
# author's own stricter hand-attestation bar) — those flip to True here, because the badge now
# asserts "a reviewed/original solution exists", the owner's accepted trade when choosing the
# derived meaning over the manual flag.

from django.db import migrations


def forwards(apps, schema_editor):
    ExerciseTranslation = apps.get_model('exercises', 'ExerciseTranslation')
    SolutionEntry = apps.get_model('exercises', 'SolutionEntry')
    Exercise = apps.get_model('exercises', 'Exercise')

    entries = []
    for t in ExerciseTranslation.objects.exclude(status='rejected').iterator():
        for kind in ('hint', 'solution'):
            body = getattr(t, kind, '') or ''
            if not body.strip():
                continue
            entries.append(
                SolutionEntry(
                    exercise_id=t.exercise_id,
                    kind=kind,
                    locale=t.locale,
                    body=body,
                    author_id=t.translated_by_id,
                    status=t.status,  # 'published' or 'pending'
                    pinned=(t.status == 'published'),
                    reviewed_by_id=t.reviewed_by_id,
                )
            )
    SolutionEntry.objects.bulk_create(entries, batch_size=500)

    # Recompute verified under the derived meaning. Bulk, not per-row saves — signals don't run in
    # migrations anyway (historical models), and two UPDATEs cover the whole table.
    passed_review = SolutionEntry.objects.filter(
        kind='solution',
        status='published',
        is_removed=False,
        auto_hidden_at__isnull=True,
    ).filter(pinned=True) | SolutionEntry.objects.filter(
        kind='solution',
        status='published',
        is_removed=False,
        auto_hidden_at__isnull=True,
        reviewed_by__isnull=False,
    )
    verified_ids = set(passed_review.values_list('exercise_id', flat=True))
    Exercise.objects.filter(pk__in=verified_ids).update(verified=True)
    Exercise.objects.exclude(pk__in=verified_ids).update(verified=False)


def backwards(apps, schema_editor):
    # The columns still exist at this point in the graph (0011 removes them and reverses first);
    # putting the text back is genuinely possible only for the one-entry-per-(kind, locale) shape
    # the forward pass created, which is exactly what a rollback would be rolling back to.
    ExerciseTranslation = apps.get_model('exercises', 'ExerciseTranslation')
    SolutionEntry = apps.get_model('exercises', 'SolutionEntry')
    for entry in SolutionEntry.objects.filter(pinned=True, status='published').iterator():
        ExerciseTranslation.objects.filter(
            exercise_id=entry.exercise_id, locale=entry.locale, status='published'
        ).update(**{entry.kind: entry.body})
    SolutionEntry.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('exercises', '0009_solutionentry_solutionentryvote'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
