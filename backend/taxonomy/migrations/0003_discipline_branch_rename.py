"""Field → Discipline, Course → Branch, and every FK that pointed at them.

Renames only — the table contents are untouched here. The row merge (four university-specific
przedmiot rows collapsing into two university-free branches) is 0004, kept separate so that a
failure in the interesting migration doesn't also have to unpick the boring one.

Hand-written rather than autodetected. `makemigrations` asks "did you rename X to Y?" one model at
a time and answers wrongly in exactly this situation — two renamed models, several renamed FKs
between them, and unique_together clauses naming the old field names — where a single wrong guess
produces a DROP plus CREATE and takes 741 exercises' worth of foreign keys with it.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    # Every app that declared an FK to `taxonomy.Course`/`taxonomy.Field` has to have finished
    # creating those columns BEFORE the models get renamed out from under them. Without these,
    # Django is free to schedule this migration first and then hit
    # `ValueError: Related model 'taxonomy.course' cannot be resolved` while replaying, say,
    # `exercises.0001_initial` — the model that FK names no longer exists by then. The migration
    # graph only orders what it is told to order.
    dependencies = [
        ('taxonomy', '0002_subtopic_subtopictranslation'),
        ('accounts', '0008_experienceentry_skillentry'),
        ('classroom', '0001_initial'),
        ('events', '0001_initial'),
        ('exercises', '0001_initial'),
        ('identity', '0001_initial'),
        ('materials', '0001_initial'),
        ('moderation', '0005_materialsubmission'),
        ('services', '0001_initial'),
    ]

    operations = [
        # --- drop every unique_together that names a field about to be renamed ------------------
        # These come off first and go back on at the end. A unique_together references fields by
        # name, so renaming a field out from under a live constraint is what makes Django emit a
        # table rebuild on SQLite instead of a rename.
        migrations.AlterUniqueTogether(name='fieldtranslation', unique_together=set()),
        migrations.AlterUniqueTogether(name='coursetranslation', unique_together=set()),
        migrations.AlterUniqueTogether(name='topic', unique_together=set()),
        migrations.AlterUniqueTogether(name='chapter', unique_together=set()),

        # --- the models themselves ---------------------------------------------------------------
        migrations.RenameModel(old_name='Field', new_name='Discipline'),
        migrations.RenameModel(old_name='FieldTranslation', new_name='DisciplineTranslation'),
        migrations.RenameModel(old_name='Course', new_name='Branch'),
        migrations.RenameModel(old_name='CourseTranslation', new_name='BranchTranslation'),

        # --- the foreign keys between them -------------------------------------------------------
        migrations.RenameField(
            model_name='disciplinetranslation', old_name='field', new_name='discipline'
        ),
        migrations.RenameField(model_name='branch', old_name='field', new_name='discipline'),
        migrations.RenameField(
            model_name='branchtranslation', old_name='course', new_name='branch'
        ),
        migrations.RenameField(model_name='topic', old_name='course', new_name='branch'),
        migrations.RenameField(model_name='chapter', old_name='course', new_name='branch'),

        # --- related_name and ordering, which the renames above do not carry across ---------------
        migrations.AlterField(
            model_name='disciplinetranslation',
            name='discipline',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='translations',
                to='taxonomy.discipline',
            ),
        ),
        migrations.AlterField(
            model_name='branch',
            name='discipline',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='branches',
                to='taxonomy.discipline',
            ),
        ),
        migrations.AlterField(
            model_name='branchtranslation',
            name='branch',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='translations',
                to='taxonomy.branch',
            ),
        ),
        migrations.AlterField(
            model_name='topic',
            name='branch',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='topics',
                to='taxonomy.branch',
            ),
        ),
        migrations.AlterField(
            model_name='chapter',
            name='branch',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='chapters',
                to='taxonomy.branch',
            ),
        ),
        migrations.AlterModelOptions(name='topic', options={'ordering': ['branch', 'order']}),
        migrations.AlterModelOptions(name='chapter', options={'ordering': ['branch', 'number']}),
        migrations.AlterModelOptions(name='branch', options={'ordering': ['order', 'slug']}),

        # --- and the constraints back, naming the new fields ---------------------------------------
        migrations.AlterUniqueTogether(
            name='disciplinetranslation', unique_together={('discipline', 'locale')}
        ),
        migrations.AlterUniqueTogether(
            name='branchtranslation', unique_together={('branch', 'locale')}
        ),
        migrations.AlterUniqueTogether(name='topic', unique_together={('branch', 'slug')}),
        migrations.AlterUniqueTogether(name='chapter', unique_together={('branch', 'number')}),
    ]
