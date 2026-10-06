# The standing pages' discussion switch (`community/discussions.py`), seeded ON.
#
# On, like `concepts` (0040) and the learning cycle's two (0047), and for the same reason those give:
# there is no discussion location on the platform the moment this runs, so switching it on takes
# nothing away from anybody. What it does is let the per-location switches underneath it mean
# something — with this off, `effective_policy` answers "not enabled" for every location whatever
# its own row says, and the frontend draws nothing.
from django.db import migrations

KEY = 'about_discussions'


def seed(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key=KEY, defaults={'is_enabled': True})


def unseed(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key=KEY).delete()


class Migration(migrations.Migration):
    dependencies = [('moderation', '0047_learning_flags')]
    operations = [migrations.RunPython(seed, unseed)]
