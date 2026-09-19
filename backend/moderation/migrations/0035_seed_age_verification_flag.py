# The `age_verification` kill switch (the age gate on self-registration, root CLAUDE.md) — seeded
# ON, the same safe-default posture every other feature flag ships with, and here the legally safer
# direction as well: `is_feature_enabled` fails OPEN for a missing row, so a database that somehow
# never ran this migration still ASKS for a year of birth rather than silently dropping the gate.

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='age_verification', defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key='age_verification').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0034_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, unseed_flag),
    ]
