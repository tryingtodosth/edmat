# Written by hand, not by `makemigrations` — Django itself refuses to autogenerate a naive
# single-step AddField here ("Callable default on unique field exerciseset.slug will not generate
# unique values upon migrating"), since a callable default is only ever evaluated ONCE for an
# AddField against existing rows, not once per row, which would collide the instant a real
# deployment has more than one existing ExerciseSet (this project's own dev database already has
# 2). The standard, safe pattern for "add a unique field to a table with existing data": add it
# nullable first, backfill a real distinct value per row, then tighten to non-nullable.

import secrets

from django.db import migrations, models

import study.models


def backfill_slugs(apps, schema_editor):
    ExerciseSet = apps.get_model('study', 'ExerciseSet')
    for exercise_set in ExerciseSet.objects.all():
        while True:
            candidate = secrets.token_urlsafe(9)
            if not ExerciseSet.objects.filter(slug=candidate).exists():
                break
        exercise_set.slug = candidate
        exercise_set.save(update_fields=['slug'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('study', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='exerciseset',
            name='is_public',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='exerciseset',
            name='slug',
            field=models.SlugField(max_length=16, null=True, unique=True),
        ),
        migrations.RunPython(backfill_slugs, noop_reverse),
        migrations.AlterField(
            model_name='exerciseset',
            name='slug',
            field=models.SlugField(
                default=study.models._generate_set_slug, editable=False, max_length=16, unique=True
            ),
        ),
    ]
