"""Turn the thirteen hardcoded `choices` into real rows, with both locales.

The names are lifted from the frontend's own message catalogue rather than from the English labels
that sat in the enum, because those catalogue strings are what people have actually been reading —
seeding from the enum would have quietly changed every Polish label to English the moment the UI
started reading names from the API instead of from `materialType_*`.

Reversible: the rows go away again and `Material.type` keeps whatever slug it holds, which is why
that column was left a slug rather than made a ForeignKey.
"""

from django.db import migrations

# slug -> (English, Polish)
BUILTIN_TYPES = [
    ('script', 'Course script', 'Skrypt'),
    ('exam_collection', 'Exam collection', 'Zbiór egzaminów'),
    ('midterm_collection', 'Midterm collection', 'Zbiór kolokwiów'),
    ('exercise_collection', 'Exercise collection', 'Zbiór zadań'),
    ('formula_sheet', 'Formula sheet', 'Ściąga ze wzorami'),
    ('lecture_slides', 'Lecture slides', 'Slajdy z wykładu'),
    ('solution_guide', 'Solution guide', 'Poradnik rozwiązań'),
    ('syllabus', 'Syllabus', 'Sylabus'),
    ('practice_test', 'Practice test', 'Test próbny'),
    ('recording', 'Recorded lecture', 'Nagranie wykładu'),
    ('textbook_excerpt', 'Textbook excerpt', 'Fragment podręcznika'),
    ('code_dataset', 'Code / dataset', 'Kod / zbiór danych'),
    ('other', 'Other', 'Inne'),
]


def seed(apps, schema_editor):
    MaterialType = apps.get_model('materials', 'MaterialType')
    MaterialTypeTranslation = apps.get_model('materials', 'MaterialTypeTranslation')
    for order, (slug, name_en, name_pl) in enumerate(BUILTIN_TYPES):
        node, _ = MaterialType.objects.get_or_create(
            slug=slug, defaults={'order': order, 'status': 'approved'}
        )
        for locale, name in (('en', name_en), ('pl', name_pl)):
            MaterialTypeTranslation.objects.get_or_create(
                material_type=node, locale=locale, defaults={'name': name}
            )


def unseed(apps, schema_editor):
    MaterialType = apps.get_model('materials', 'MaterialType')
    MaterialType.objects.filter(slug__in=[slug for slug, _, _ in BUILTIN_TYPES]).delete()


class Migration(migrations.Migration):
    dependencies = [('materials', '0012_alter_material_type_materialtype_and_more')]

    operations = [migrations.RunPython(seed, unseed)]
