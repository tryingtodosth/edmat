"""Every exercise, translation and hint/solution gets a licence (licensing/, 2026-10-14).

Classification, and why it is honest rather than generous:

- An exercise is `edmat-only` only if a person demonstrably SUBMITTED it through the site — an
  `ExerciseSubmission` whose `resulting_exercise` it is (submissions are kept, house rule 12).
  Everything else is `unknown` (LEGAL.md §3): the seeded corpus, `import_exercises` batches, and —
  the reason `submitted_by` is NOT the test — corpus rows that `seed_demo_content` attributed to
  demo accounts so the credit lines have something to show. Under the terms a submitter accepted,
  their content was only ever licensed to EdMat to host it, and nothing they did not choose is
  opened now.
- A translation takes its exercise's licence (it is a derivative).
- A hint/solution is `unknown` when its exercise is and it is a corpus original — no author, or
  pinned (the migrated originals are pinned, and the same seed attributed some of them). Every
  other entry was written through the site's composer: `edmat-only`. A staff-pinned community
  solution on a corpus exercise is therefore labelled `unknown` too — the conservative error, and
  its author can declare a licence from there.

Reverse is a no-op: the columns go with the schema reversal.
"""

from django.db import migrations, models



def classify(apps, schema_editor):
    Exercise = apps.get_model('exercises', 'Exercise')
    ExerciseTranslation = apps.get_model('exercises', 'ExerciseTranslation')
    SolutionEntry = apps.get_model('exercises', 'SolutionEntry')
    ExerciseSubmission = apps.get_model('moderation', 'ExerciseSubmission')
    from django.db.models import OuterRef, Q, Subquery

    submitted = ExerciseSubmission.objects.filter(resulting_exercise__isnull=False).values(
        'resulting_exercise_id'
    )
    Exercise.objects.update(licence='unknown')
    Exercise.objects.filter(pk__in=submitted).update(licence='edmat-only')
    ExerciseTranslation.objects.update(
        licence=Subquery(Exercise.objects.filter(pk=OuterRef('exercise_id')).values('licence')[:1])
    )
    SolutionEntry.objects.update(licence='edmat-only')
    SolutionEntry.objects.filter(exercise__licence='unknown').filter(
        Q(author__isnull=True) | Q(pinned=True)
    ).update(licence='unknown')


class Migration(migrations.Migration):

    dependencies = [
        ('exercises', '0014_solutionentryattachment'),
        # `classify` reads ExerciseSubmission to tell a submitted exercise from the corpus.
        ('moderation', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='exercise',
            name='licence',
            field=models.CharField(choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='edmat-only', max_length=20),
        ),
        migrations.AddField(
            model_name='exercisetranslation',
            name='licence',
            field=models.CharField(blank=True, choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='solutionentry',
            name='licence',
            field=models.CharField(choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='edmat-only', max_length=20),
        ),
        migrations.RunPython(classify, migrations.RunPython.noop),
    ]
