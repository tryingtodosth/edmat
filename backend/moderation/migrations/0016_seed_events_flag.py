"""Provisions the `events` kill switch, and widens `key`'s own choices to accept it.

`is_enabled=True`, matching the plain kill switches rather than the inverted
`material_uploads_verified_only` row: this one means "the feature is up", and a new feature arriving
switched off would be indistinguishable from a broken one.

Its own migration rather than an edit to 0009's `seed_flags`, for the reason 0011 and 0014 both give
— that one has already run everywhere, and its `get_or_create` never touches a key added afterwards.
The `AlterField` rides along here rather than in a separate migration because the two are one change:
seeding a row whose `key` is not yet a valid choice would leave `makemigrations --check` dirty and
the admin's own dropdown missing the row it had just written.
"""

from django.db import migrations, models


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='events', defaults={'is_enabled': True})


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0015_alter_featureflag_key'),
    ]

    operations = [
        migrations.AlterField(
            model_name='featureflag',
            name='key',
            field=models.CharField(
                choices=[
                    ('tutoring', 'Tutoring/services listings'),
                    ('classroom', 'User-run courses'),
                    ('messaging', 'User-to-user messaging'),
                    ('exercise_submissions', 'New exercise submissions'),
                    ('material_submissions', 'New material uploads'),
                    ('events', 'One-off events'),
                    (
                        'material_uploads_verified_only',
                        'Material uploads: verified contributors only',
                    ),
                ],
                max_length=40,
                unique=True,
            ),
        ),
        migrations.RunPython(seed_flag, noop_reverse),
    ]
