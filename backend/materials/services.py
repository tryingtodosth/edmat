"""Business-logic layer for the materials search/filter/sort overhaul's own "genuine
personalization dimension" — mirrors moderation/services.py's own split (real decision-making logic
lives here, thin request/response glue stays in views.py), not materials/views.py's own
`_filter_materials`/`_sort_materials` helpers (those are plain, mechanical query-building — the same
"a helper function next to the ViewSet, not a services module" shape exercises/views.py's own
`_filter_exercises`/`_annotated_exercises` already establish — so they stay in views.py instead).

`get_recommended_materials` is the one real, honest attempt at "plenty to work on audiences" from
the brief that drove this file: it uses ONLY signals this app's data model already has for real —
which courses/topics a user has actually engaged with (ContentView, Review, Comment, ExerciseSet)
and which materials they've already opened (MaterialView, materials/models.py) — never a fabricated
ML/AI ranking. When none of those signals exist for the requesting visitor (a brand-new account, or
an anonymous guest), it falls back to a plain, honestly non-personalized ordering (featured first,
then best-covered, then most recent) and says so via the `personalized` flag it returns — the same
"real proxy signal, not fake AI, and say so" discipline this project's own sibling documents (the
Random Exercise picker's own `browsingHistoryStore`, the Users-Feed-style "Recommended" scoring in
`2donet`'s own CLAUDE.md Section 2.32) already hold themselves to.
"""

from __future__ import annotations

from config.i18n_utils import request_locale, resolve_translation

from .models import Material, MaterialCoverageVote, MaterialView


def clean_requirement_labels(labels: list) -> list[str]:
    """Trim + drop-blank a raw requirement-label list — the shared first half of what both the
    submission-time `MaterialSubmission.requirements` validator (moderation/serializers.py) and the
    governor-only bulk-replace endpoint (materials/views.py's `requirements` action) need to do
    before a list of labels is fit to store. Kept here, not duplicated in each of those two files,
    for the exact same "one definition, not two independently-drifting copies" reasoning this
    module's own `_vote_weight` docstring already gives.
    """
    return [str(label).strip() for label in labels if str(label).strip()]


def find_duplicate_requirement_label(labels: list[str]) -> str | None:
    """Case-insensitive (after the trimming `clean_requirement_labels` already did) duplicate check
    over an already-cleaned requirement-label list. Returns the first duplicate label encountered
    (in its own original casing, for a readable error message) or `None` if every label is unique.

    Shared by both real write paths for a Material's own requirement list — the governor-only bulk
    replace (materials/views.py) and the submission-time draft list (moderation/serializers.py) — so
    a brand-new submission can't sneak in duplicates any more than an already-published Material's
    own governor-facing edit can. One definition, not two, same reasoning as `clean_requirement_labels`
    above.
    """
    seen: set[str] = set()
    for label in labels:
        key = label.casefold()
        if key in seen:
            return label
        seen.add(key)
    return None


# A verified contributor's vote counts double toward a coverage claim's own net weight — moved here
# from materials/serializers.py (which now imports it back) so the personalization engine and the
# coverage-vote summary share exactly one definition of "how much does this person's vote count,"
# rather than two independently-drifting copies of the same rule.
def _vote_weight(user) -> int:
    return 2 if getattr(getattr(user, 'profile', None), 'is_verified_contributor', False) else 1


def _net_vote_weight(coverage) -> int:
    total = 0
    for vote in coverage.votes.all():
        total += _vote_weight(vote.voter) if vote.value == 1 else -_vote_weight(vote.voter)
    return total


def _best_coverage_level(material) -> int:
    levels = [c.level for c in material.coverage.all()]
    return max(levels) if levels else -1


def resolved_title(material, locale: str) -> str:
    """Same `resolve_translation` "resolve, fall back to original" rule every translatable model in
    this app already uses (config/i18n_utils.py) — used for the alphabetical sort in
    materials/views.py's `_sort_materials`, since a Material's own title only ever exists inside its
    (per-locale) MaterialTranslation rows, never on the Material row itself."""
    t = resolve_translation(material.translations, locale)
    return t.title if t else material.slug


def _materials_queryset():
    return Material.objects.filter(published=True).select_related('course').prefetch_related(
        'translations', 'coverage__votes__voter__profile', 'coverage__topic', 'tags', 'requirements'
    )


def get_active_course_ids(user) -> set[int]:
    """Real signals, not an invented "my courses" declaration (the brief left that as an OPTIONAL
    addition, not a requirement — not built, see this feature's own "Left open" list): which
    courses has this user actually engaged with, inferred from (a) exercises they've viewed
    (moderation.ContentView), (b) exercises they've reviewed (community.Review), (c) exercises
    they've commented on (community.Comment, via its GenericForeignKey), and (d) exercises sitting
    in an ExerciseSet they own (study.ExerciseSet). Honestly weaker than an explicit declaration
    would be, but every signal here is something the user actually DID, not a guess.
    """
    if user is None or not getattr(user, 'is_authenticated', False):
        return set()

    # Local imports — materials.services deliberately doesn't want a module-level dependency on
    # moderation/community/study/exercises (none of those apps need to know materials exists),
    # matching the same "avoid a real or perceived import cycle" discipline
    # moderation/services.py's own local imports and accounts/serializers.py's
    # `get_is_node_governor` already establish.
    from django.contrib.contenttypes.models import ContentType

    from community.models import Comment, Review
    from exercises.models import Exercise
    from moderation.models import ContentView
    from study.models import ExerciseSet

    course_ids: set[int] = set(
        ContentView.objects.filter(user=user).values_list('exercise__course_id', flat=True)
    )
    course_ids |= set(Review.objects.filter(author=user).values_list('exercise__course_id', flat=True))

    exercise_ct = ContentType.objects.get_for_model(Exercise)
    commented_exercise_ids = Comment.objects.filter(
        author=user, content_type=exercise_ct
    ).values_list('object_id', flat=True)
    course_ids |= set(
        Exercise.objects.filter(pk__in=commented_exercise_ids).values_list('course_id', flat=True)
    )

    set_exercise_ids = ExerciseSet.objects.filter(owner=user).values_list(
        'exercisesetitem__exercise_id', flat=True
    )
    course_ids |= set(
        Exercise.objects.filter(pk__in=set_exercise_ids).values_list('course_id', flat=True)
    )

    course_ids.discard(None)
    return course_ids


def get_engaged_topic_ids(user) -> set[int]:
    """A finer-grained signal than course-level activity: the topics of exercises this user has
    actually VIEWED (moderation.ContentView) — used to prefer a material whose own coverage claims
    overlap what they've actually been reading, not just "any material in the same course."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return set()

    from moderation.models import ContentView
    from taxonomy.models import Topic

    viewed_exercise_ids = ContentView.objects.filter(user=user).values_list('exercise_id', flat=True)
    return set(
        Topic.objects.filter(exercises__id__in=viewed_exercise_ids).values_list('id', flat=True)
    )


def get_recommended_materials(user, limit: int = 12) -> tuple[list[Material], bool]:
    """Returns (materials, personalized). See this module's own header comment for the full
    scoring rationale — kept as a single small function rather than several composable pieces
    because this app's real corpus is small enough (a handful to a few dozen materials) that
    scoring every one of them in Python costs nothing real, the same "small corpus, cheap in
    Python" call MaterialCoverageSerializer.get_vote_summary already makes for its own per-row
    aggregation."""
    active_course_ids = get_active_course_ids(user)
    engaged_topic_ids = get_engaged_topic_ids(user)
    if user is not None and getattr(user, 'is_authenticated', False):
        viewed_material_ids = set(MaterialView.objects.filter(user=user).values_list('material_id', flat=True))
    else:
        viewed_material_ids = set()

    materials = list(_materials_queryset())
    if not materials:
        return [], False

    personalized = bool(active_course_ids or engaged_topic_ids)

    if not personalized:
        # Honest, non-personalized fallback: featured first, then the most confidently-covered
        # material, then the newest upload — a real, defensible default ranking, not a random one,
        # for a visitor this app genuinely has no engagement signal for yet.
        materials.sort(key=lambda m: (not m.featured, -_best_coverage_level(m), -m.created_at.timestamp()))
        return materials[:limit], False

    def score(material) -> float:
        s = 0.0
        if material.course_id in active_course_ids:
            s += 5.0
        rows = list(material.coverage.all())
        overlap_rows = [r for r in rows if r.topic_id in engaged_topic_ids]
        # Up to +5 per topic this material covers deeply (level is 1-100) that the visitor has
        # actually been reading about — a well-covered overlap counts for more than a token one.
        for row in overlap_rows:
            s += row.level / 20.0
        # The community's own verification signal (weighted agree/disagree votes) folds in too,
        # scaled down so it nudges the ranking rather than dominating it outright.
        s += sum(_net_vote_weight(row) for row in rows) * 0.2
        if material.pk in viewed_material_ids:
            # Deprioritize, don't exclude — an already-opened material can still be worth
            # resurfacing (e.g. right before an exam), it just shouldn't crowd out something new.
            s *= 0.4
        if material.featured:
            s += 1.0
        return s

    materials.sort(key=score, reverse=True)
    return materials[:limit], True
