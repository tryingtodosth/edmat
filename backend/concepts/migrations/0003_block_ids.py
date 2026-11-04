"""Give every stored concept block an `id` (2026-11-04, `config/blocks.py` point 1).

An id is what a comment on one paragraph of an article points at, and it must be the SAME across an
article's revisions or every comment would detach the moment somebody fixed a typo. Revisions
written before today have no ids to keep, so they are allocated here deterministically from
`(article, position)` — consecutive revisions therefore share an id per position, which is exactly
the pairing `RevisionView` drew before ids existed; nothing anybody could see changes. From now on
the editor sends ids back and `clean_blocks` keeps them, so positions stop mattering.

Reversible as a no-op: an id the old code does not read is harmless to it.
"""

import hashlib

from django.db import migrations


def allocate(apps, schema_editor):
    ConceptRevision = apps.get_model('concepts', 'ConceptRevision')
    for revision in ConceptRevision.objects.all().only('pk', 'article_id', 'blocks').iterator():
        blocks = revision.blocks if isinstance(revision.blocks, list) else []
        changed = False
        seen = set()
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            if block.get('id') and block['id'] not in seen:
                seen.add(block['id'])
                continue
            block['id'] = 'b' + hashlib.sha1(f'{revision.article_id}:{index}'.encode()).hexdigest()[:9]
            seen.add(block['id'])
            changed = True
        if changed:
            # `update()`, not `save()`: a revision is immutable, and its save() re-derives fields
            # this migration has no business touching.
            ConceptRevision.objects.filter(pk=revision.pk).update(blocks=blocks)


class Migration(migrations.Migration):
    dependencies = [('concepts', '0002_licence')]
    operations = [migrations.RunPython(allocate, migrations.RunPython.noop)]
