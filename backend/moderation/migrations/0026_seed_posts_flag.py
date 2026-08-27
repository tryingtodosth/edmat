# The `posts` kill switch (activity micro-posts, root CLAUDE.md §17AI) — seeded ON, the same
# safe-default posture every other feature flag ships with.

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='posts', defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key='posts').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0025_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, unseed_flag),
    ]
