# The `concepts` kill switch (the wiki pages for what exercises and materials are ABOUT, their
# per-(audience, locale) articles, revisions and links — CONCEPTS-BRIEF.md) — seeded ON, the same
# safe-default posture every other feature flag ships with.
#
# Seeding it on takes nothing away from anybody: there is no concept on the platform the moment this
# runs, so the flag's only effect on an existing deployment is that the surface exists at all. The
# one read that must keep working with it OFF is the backlink row an exercise or a material page
# fetches (`GET /api/concept-links/?target_type=…`), which answers `[]` rather than 403 — see the
# key's own note in `moderation/models.py`.

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='concepts', defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key='concepts').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0039_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, unseed_flag),
    ]
