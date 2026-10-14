"""Every material gets a licence (licensing/, 2026-10-14).

`unknown` when nobody on the site submitted it, OR when its file sits under `materials/` — the
directory only the corpus importer and the Django admin write to. Every site upload reaches a
material through a co-authored version (`material_versions/…`) or the retired submission queue, so
that path is the honest test for "this arrived without anybody choosing a licence". It matters
because the dev database's seven corpus PDFs were later attributed to demo accounts by a seed, and
`submitted_by` alone would have called them user content. Everything else is `edmat-only`.
"""

from django.db import migrations, models



def classify(apps, schema_editor):
    Material = apps.get_model('materials', 'Material')
    Material.objects.update(licence='edmat-only')
    Material.objects.filter(submitted_by__isnull=True).update(licence='unknown')
    Material.objects.filter(file__startswith='materials/').update(licence='unknown')



class Migration(migrations.Migration):

    dependencies = [
        ('materials', '0018_material_body_translation_updated_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='material',
            name='licence',
            field=models.CharField(choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='edmat-only', max_length=20),
        ),
        migrations.RunPython(classify, migrations.RunPython.noop),
    ]
