"""`create_material` — the one function that turns an accepted upload into a real, published row.

Until co-authoring there was exactly one way a `Material` came into existence at runtime: a
moderator approving a `moderation.MaterialSubmission`, in `moderation/views.py`'s
`_apply_material_submission`. That function was never really about submissions, though — the
submission only supplied the values. Everything it did (allocate a slug that does not collide
inside the branch, create the row, create the original-locale translation, turn the draft
`requirements` list and `coverage` dicts into real rows, announce it on the feed) is what "publish
a material for the first time" means, whatever produced the values.

Co-authoring was the second producer, and is now the ONLY one: a `MaterialProject`'s first
accepted version materialises into exactly the same kind of row, with the same slug rule and the
same feed announcement. That is house rule 2 — a rule more than one endpoint needs lives in one
module — so the body lives here, `_apply_material_submission` became a call to it, and when the
submission model was folded into projects (`coauthoring/0003_fold_material_submissions`) that
caller went without this function having to change at all. `coauthoring.services.materialise` is
the one caller left.

**This function is the "published" moment, and it is the only code outside the feed's own tests
that calls `record_activity('material', …)`.** A caller that has already announced its own event
must not call this as well; a caller creating a material nobody has seen yet must not skip it.
There is no flag to turn the announcement off, deliberately: every real creation of a material IS
public at the moment it happens (`published=True` below), which is exactly the condition
`activity/services.record_activity`'s own contract requires.
"""

from django.utils.text import slugify

from .models import Material, MaterialCoverage, MaterialRequirement, MaterialTranslation


def create_material(
    *,
    branch,
    type,
    audience,
    submitted_by,
    locale,
    title,
    description,
    file=None,
    url='',
    body='',
    author='',
    source_url='',
    price_amount=None,
    price_currency='PLN',
    estimated_minutes=None,
    requirements=(),
    coverage=(),
    activity_actor=None,
) -> Material:
    """Builds a real, published `Material` + its original-locale `MaterialTranslation`.

    `file` is a `FieldFile` (or a stored name) that is ALREADY uploaded, validated and scanned —
    assigning it here just copies the reference to the path the bytes are already at. Django's
    `FileField` assignment does not re-upload or re-validate, which is the whole point: approval
    has never re-saved a submitted blob under a second path, and materialising a co-authored
    version must not start either. `None` and `''` both mean "this material is not a file".

    `url` and `body` are the other two shapes a material can take (`Material.clean()` requires at
    least one of the three, not exactly one — see its own docstring for why they coexist). `body`
    is Markdown + literal LaTeX + raw HTML like every other content field here, and is sanitized
    by `Material.save()`, not by this function.

    `requirements` is a list of plain label strings (the draft shape `MaterialProject
    .requirements` stores). `coverage` is a list of
    `{topic_id, level, kind}` dicts — the same shape, with `kind` defaulting to `'covers'` when
    a row predates the covers/requires split. Both become real rows only now, because there was no
    `Material` for them to hang off before this call.

    `submitted_by` is the real, clickable account attribution (`author` beside it is free text —
    the human who wrote the document, who is usually not a platform account at all).
    `activity_actor` is who the feed says did this, defaulting to `submitted_by`; the two differ
    only when somebody publishes on another person's behalf, which is what a co-authored project's
    first publication by a reviewer is.

    `slug` has no equivalent in any caller's payload (unlike `Exercise.number`, which
    `_apply_submission` computes from the branch's own existing rows) — it is generated from the
    title via `slugify`, with a numeric suffix appended only while it collides with an existing
    Material in the same branch (`unique_together = [('branch', 'slug')]`, models.py).

    **The honest limit on that loop, unchanged by this extraction:** it is a check-then-insert, not
    the savepoint-per-attempt retry `backend/CLAUDE.md`'s SQLite rule 3 asks for on a contended
    unique key (which `_apply_submission`'s exercise-number allocation does use). Two materials
    with the same title approved in the same instant would race to the same slug and one would get
    an `IntegrityError`. That has been true of every material ever created here, and the traffic
    that would make it happen — two moderators approving two identically-titled uploads in the
    same branch within one statement of each other — is not traffic this corpus has. It is written
    down rather than quietly inherited, so whoever does see it knows where the fix goes.
    """
    base_slug = slugify(title) or 'material'
    slug = base_slug
    suffix = 1
    while Material.objects.filter(branch=branch, slug=slug).exists():
        suffix += 1
        slug = f'{base_slug}-{suffix}'

    material = Material.objects.create(
        branch=branch,
        slug=slug,
        type=type,
        audience=audience,
        file=file or '',
        # A link-only material has no file and lives at its own URL — see Material.url for why this
        # is not `source_url`, which is next to it and answers a different question.
        url=url,
        body=body,
        published=True,
        submitted_by=submitted_by,
        # Provenance declared at submission time, carried onto the real row. `author` is the free-text
        # human name the uploader gave (a TA/professor, almost never a platform account — that's what
        # `submitted_by` above is), `source_url` is where the file came from.
        author=author,
        source_url=source_url,
        price_amount=price_amount,
        price_currency=price_currency or 'PLN',
        estimated_minutes=estimated_minutes,
    )
    MaterialTranslation.objects.create(
        material=material,
        locale=locale,
        title=title,
        description=description,
    )
    # The caller's own `requirements` (a plain list[str] draft, moderation/models.py's own doc
    # comment) becomes real, ordered MaterialRequirement rows only now — there was no real Material
    # row for them to be a FK to before this point.
    MaterialRequirement.objects.bulk_create(
        MaterialRequirement(material=material, label=label, order=i)
        for i, label in enumerate(requirements or [])
    )
    # Same "no real row to attach to before now" reasoning as `requirements` just above, for the
    # caller's own initial claims — created with `proposed_by=submitted_by`, the same attribution
    # a post-publish `MaterialViewSet.coverage` proposal already gets, not left null.
    #
    # **Each `topic_id` is the CALLER's to have validated**, and this function does not re-check
    # it: `coauthoring.serializers._CatalogueValidationMixin.validate_coverage` is what confirms a
    # project's topics really belong to its branch, and any other producer owes the same check at its own entry
    # point. Stated because it is the one input here that is not inert — a topic from another
    # branch would make a real claim on a real material with nothing downstream to catch it.
    MaterialCoverage.objects.bulk_create(
        MaterialCoverage(
            material=material,
            topic_id=entry['topic_id'],
            level=entry['level'],
            kind=entry.get('kind', 'covers'),
            proposed_by=submitted_by,
        )
        for entry in (coverage or [])
    )
    # Imported inside the function, as the code this moved from already did: `activity` reaches
    # back into `materials.models` (its serializers and its signal wiring both do), so a
    # module-level import here would make the direction between the two apps depend on which one
    # Django happens to load first.
    from activity.services import record_activity

    record_activity(
        'material',
        actor=activity_actor if activity_actor is not None else submitted_by,
        target_label=title,
        material=material,
    )
    return material
