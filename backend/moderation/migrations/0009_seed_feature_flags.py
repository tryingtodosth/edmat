"""Seeds the 4 real FeatureFlag rows, all enabled — so a fresh migrate leaves every gated feature
behaving exactly as it did before this model existed, until a moderator deliberately flips one off.
`is_feature_enabled` (moderation/services.py) already fails open if a row is missing, so this
migration isn't load-bearing for correctness, only for the flags actually showing up in the
moderation UI's own toggle list without a separate manual seeding step (unlike seed_demo_users,
which is a deliberate opt-in dev-data command, these 4 rows are real, permanent app configuration
every environment needs, so a migration — not a management command — is the right mechanism)."""

from django.db import migrations


def seed_flags(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    for key in ('tutoring', 'messaging', 'exercise_submissions', 'material_submissions'):
        FeatureFlag.objects.get_or_create(key=key, defaults={'is_enabled': True})


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0008_featureflag'),
    ]

    operations = [
        migrations.RunPython(seed_flags, noop_reverse),
    ]
