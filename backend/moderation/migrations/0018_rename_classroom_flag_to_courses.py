"""The `classroom` kill switch becomes `courses`, following the app it gates.

A flag whose key names an app that no longer exists is worse than untidy: `feature_gate('courses')`
would find no row at all, and `FeatureFlag` treats a missing row as "off" — so the whole courses
feature would quietly disappear from the API for everyone but staff, with nothing in the logs
saying why.

Renames the existing row rather than creating a second one, so whatever the flag was set to is what
it stays. `get_or_create` afterwards covers the database that never had the old row.
"""

from django.db import migrations


def rename_forward(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    old = FeatureFlag.objects.filter(key='classroom').first()
    if old is not None and not FeatureFlag.objects.filter(key='courses').exists():
        old.key = 'courses'
        old.save(update_fields=['key'])
    else:
        FeatureFlag.objects.filter(key='classroom').delete()
    FeatureFlag.objects.get_or_create(key='courses', defaults={'is_enabled': True})


def rename_backward(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    row = FeatureFlag.objects.filter(key='courses').first()
    if row is not None:
        row.key = 'classroom'
        row.save(update_fields=['key'])


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0017_rename_course_exercisesubmission_branch_and_more'),
    ]

    operations = [
        migrations.RunPython(rename_forward, rename_backward),
    ]
