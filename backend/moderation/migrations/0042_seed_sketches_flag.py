# The `sketches` kill switch (freehand whiteboard drawings made in a fullscreen Excalidraw canvas
# and embedded in content and comments — sketches/models.py) — seeded ON, the same safe-default
# posture every other plain kill switch ships with.
#
# Seeding it on takes nothing away from anybody: there is no sketch on the platform the moment this
# runs, so the flag's only effect on an existing deployment is that the surface exists at all. Off,
# `/api/sketches/` closes for a non-staff caller and the Sketch button leaves every composer
# (house rule 3 — a kill switch removes the links, not just the pages); pictures already embedded
# in somebody's comment keep rendering, because they are ordinary media files by then.

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key='sketches', defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key='sketches').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('moderation', '0041_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, unseed_flag),
    ]
