"""A concept article's licence (licensing/, 2026-10-14): `edmat-only` for every article a person
wrote here, `unknown` for one with no author (a seed or an import)."""

from django.db import migrations, models



def classify(apps, schema_editor):
    ConceptArticle = apps.get_model('concepts', 'ConceptArticle')
    ConceptArticle.objects.filter(created_by__isnull=True).update(licence='unknown')



class Migration(migrations.Migration):

    dependencies = [
        ('concepts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='conceptarticle',
            name='licence',
            field=models.CharField(choices=[('cc0-1.0', 'CC0 1.0'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('edmat-only', 'EdMat only'), ('unknown', 'Rights not clarified')], db_index=True, default='edmat-only', max_length=20),
        ),
        migrations.RunPython(classify, migrations.RunPython.noop),
    ]
