"""Provisions the `classroom` kill switch for the user-run-courses feature.

`is_enabled=True`, matching the four plain kill switches rather than the inverted
`material_uploads_verified_only` row: this one means "the feature is up", and a new feature arriving
switched off would be indistinguishable from a broken one. Its own migration for the same reason
0011 gives — 0009's `seed_flags` has already run, and its `get_or_create` would never touch a key
added afterwards.
"""

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='classroom', defaults={'is_enabled': True})


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0013_materialsubmission_author_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_flag, noop_reverse),
    ]
