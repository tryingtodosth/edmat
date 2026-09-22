# The `coauthoring` kill switch (versions, project teams, proposals on a material —
# COAUTHORING-BRIEF.md) — seeded ON, the same safe-default posture every other feature flag ships
# with.
#
# Seeding it on is safe here in a way it would not be for a flag that gates content: turning this
# one off removes only the collaboration surface, never a material. `Material` stays the published
# projection of its project's current version, so a killed `coauthoring` leaves every listing,
# download and detail page untouched.

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='coauthoring', defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key='coauthoring').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0036_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, unseed_flag),
    ]
