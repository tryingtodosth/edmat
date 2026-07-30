"""Seeds the new `material_uploads_verified_only` row as `is_enabled=False` — the restriction
starts OFF everywhere, matching today's existing behavior (any authenticated user may upload a
material submission) exactly, so provisioning this flag never narrows anyone's access until a
moderator deliberately turns it on. Deliberately its own migration, not folded into 0009's
`seed_flags` — that migration already ran (and its own `get_or_create` would silently never touch a
key added after the fact anyway), and this row's own correct default (False) differs from the other
4's (True), so sharing one function would need a per-key default map for no real benefit.
"""

from django.db import migrations


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(
        key='material_uploads_verified_only', defaults={'is_enabled': False}
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0010_alter_featureflag_key'),
    ]

    operations = [
        migrations.RunPython(seed_flag, noop_reverse),
    ]
