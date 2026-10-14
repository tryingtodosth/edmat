"""A project's drafting licence (licensing/, 2026-10-14). A project whose material exists copies
the material's classified licence, so the panel never disagrees with the page; a draft is
`edmat-only` until its author picks."""

from django.db import migrations, models



def copy_from_material(apps, schema_editor):
    MaterialProject = apps.get_model('coauthoring', 'MaterialProject')
    for project in MaterialProject.objects.filter(material__isnull=False).select_related('material'):
        MaterialProject.objects.filter(pk=project.pk).update(licence=project.material.licence)



class Migration(migrations.Migration):

    dependencies = [
        ('materials', '0019_licence'),
        ('coauthoring', '0003_fold_material_submissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='materialproject',
            name='licence',
            field=models.CharField(choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='edmat-only', max_length=20),
        ),
        migrations.RunPython(copy_from_material, migrations.RunPython.noop),
    ]
