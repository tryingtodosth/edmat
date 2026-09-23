"""Who may see, write, publish, decide and unlink — the ONE place, which every view asks.

House rule 2 in its usual shape: each of these answers is needed by at least two call sites (the
list, the detail, an action, a serializer's `can_*` field, the moderation queue), and two copies of
a trust rule is how one of them drifts. `coauthoring/access.py` and `galleries/visibility.py` are
the same module for their apps, and this one is written to their shape deliberately.

House rule 4 is the other half and is why there are pairs of functions for the same question:
`visible_articles` / `visible_concepts` are **queryset filters** (a stranger never sees an article
whose only revision is waiting, and absence is the honest answer as well as the safe one) and
`can_view` / `can_view_article` are **object-level checks** (a filter never runs for an action that
arrives with an id in the URL). They must agree, and the test suite pins them against each other
rather than trusting that they were written on the same day.

The circles, which are the part worth reading twice:

* **Writing** is open to anybody signed in — a concept, an article of your own, or a revision of
  somebody else's article. That is the wiki bet, the same one posts and galleries make: reports and
  the kill switch cover abuse.
* **Publishing without waiting** is staff, a verified contributor, or a governor of one of the
  concept's branches — deliberately the circle `exercises.entries.can_autopublish_entry` grants for
  a brand-new solution entry, applied per branch. **A minor never publishes without waiting**, and
  that is a rule about a person always reading what goes live, not a judgement about the work.
* **Reviewing** is staff, a governor of any of the concept's branches, **and the article's own
  author** — `can_decide_entry_suggestion`'s precedent: folding somebody's words into a text is a
  decision the person who wrote that text should get to make. A concept attached to no branch is
  therefore reviewed by staff and the author alone, which is stated rather than papered over.
"""

from __future__ import annotations

from django.db.models import Exists, OuterRef

from accounts.minors import is_minor
from moderation.services import governed_branch_ids, is_governor_of_course


def _is_authenticated(user) -> bool:
    return bool(user is not None and getattr(user, 'is_authenticated', False))


def _is_verified_contributor(user) -> bool:
    return bool(getattr(getattr(user, 'profile', None), 'is_verified_contributor', False))


# --- the queryset half ------------------------------------------------------------------------


def visible_articles(user):
    """Every article this caller may reach.

    Three admissions, and a hidden article is in none of them: it has a published revision (so it is
    public), or the caller is staff, or the caller has written a revision of it (their own work in
    progress, which they must be able to find again).

    A removed or auto-hidden article is excluded for EVERYBODY including staff, which is deliberate:
    a moderator acts on one through `moderation.REPORT_KIND_MODELS`, which resolves the row directly
    and never through this filter, so widening it here would only make hidden text appear in
    ordinary browse for the one account most likely to be reading the site normally.
    """
    from .models import ConceptArticle, ConceptRevision

    queryset = ConceptArticle.objects.filter(is_removed=False, auto_hidden_at__isnull=True)
    published = ConceptRevision.objects.filter(article=OuterRef('pk'), status='published')
    if not _is_authenticated(user):
        return queryset.filter(Exists(published))
    if user.is_staff:
        return queryset
    mine = ConceptRevision.objects.filter(article=OuterRef('pk'), created_by=user)
    return queryset.filter(Exists(published) | Exists(mine))


def visible_concepts(user):
    """Every concept with at least one article this caller may reach.

    The object-level twin is `can_view`. `Exists` rather than a join plus `distinct()` because the
    join would multiply a concept by its articles and then have to de-duplicate, and this list is
    ordered and sliced — a `distinct()` over an ordered join is exactly where SQLite gets expensive.
    """
    from .models import Concept

    articles = visible_articles(user).filter(concept=OuterRef('pk'))
    return Concept.objects.filter(Exists(articles))


def queue_queryset(branch_ids):
    """Pending revisions for the moderation queue, governor-scoped exactly like every other section.

    `branch_ids is None` means "do not scope" — a global `is_staff` moderator — and a real, possibly
    EMPTY set means a governor who sees only their own branches. Never collapse the two
    (`moderation/CLAUDE.md`): a zero-grant governor must not become indistinguishable from staff.

    A concept attached to NO branch therefore reaches staff only, and that is the honest answer
    rather than a gap: there is no branch whose governor could claim it, so the only people who can
    decide it are staff and the article's own author — who decides it from the article's history
    page, not from this queue.
    """
    from .models import ConceptRevision

    queryset = (
        ConceptRevision.objects.filter(status='pending', article__is_removed=False)
        .select_related('article__concept', 'created_by__profile')
        .prefetch_related('article__concept__branches__translations')
        .order_by('submitted_at', 'id')
    )
    if branch_ids is not None:
        queryset = queryset.filter(article__concept__branches__in=branch_ids).distinct()
    return queryset


# --- the object-level half --------------------------------------------------------------------


def can_view(concept, user) -> bool:
    """Whether this concept is reachable at all — the object-level twin of `visible_concepts`."""
    return any(can_view_article(article, user) for article in concept.articles.all())


def can_view_article(article, user) -> bool:
    """The object-level twin of `visible_articles`, in the same three admissions and the same order.

    Reads `revisions.all()` rather than filtering, so a prefetched article answers without a query —
    which is what lets the detail page render a whole pool in a bounded number of queries.
    """
    if article.is_removed or article.auto_hidden_at is not None:
        return False
    revisions = list(article.revisions.all())
    if any(revision.status == 'published' for revision in revisions):
        return True
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    return any(revision.created_by_id == user.pk for revision in revisions)


def can_view_revision(revision, user) -> bool:
    """One revision's own visibility, which is narrower than its article's.

    * `published` / `superseded` — whoever can see the article. This is the history a reader is
      entitled to: what the page used to say, and who changed it.
    * `draft` — its author and staff. An unfinished revision is not an announcement.
    * `pending` / `rejected` / `withdrawn` — its author, plus whoever may decide it. A rejection and
      its note stay readable by the person who was refused, which is house rule 6 applied to a row
      rather than to a response body.
    """
    article = revision.article
    if revision.status in ('published', 'superseded'):
        return can_view_article(article, user)
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if revision.created_by_id == user.pk:
        return True
    if revision.status == 'draft':
        return False
    return can_review(user, article)


def can_autopublish(user, concept) -> bool:
    """May this person's revision go live without waiting for anybody?

    Staff, a verified contributor, or a governor of ANY branch the concept is attached to — the
    circle `exercises.entries.can_autopublish_entry` grants, asked once per branch because a concept
    can sit under several and a governor of one of them is trusted with it.

    **A minor never does**, checked first so it cannot be reached past a verified-contributor flag
    somebody set on a child's account by mistake. It is the same rule co-authoring applies at its
    own boundary: a person always reads what a minor wrote before anybody else does.
    """
    if not _is_authenticated(user):
        return False
    if is_minor(user):
        return False
    if user.is_staff or _is_verified_contributor(user):
        return True
    return any(is_governor_of_course(user, branch) for branch in concept.branches.all())


def can_review(user, article) -> bool:
    """May this person accept or reject a pending revision of this article?

    Staff, a governor of any of the concept's branches, or the article's own author. The third is
    what makes a wiki work at this size: somebody proposes a fix to the paragraph you wrote, and the
    obvious person to read it is you — the same call `exercises.entries.can_decide_entry_suggestion`
    makes for an edit suggestion against a solution entry, and for the same reason it deliberately
    does NOT extend to every verified contributor.
    """
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if article.created_by_id is not None and article.created_by_id == user.pk:
        return True
    return any(
        is_governor_of_course(user, branch) for branch in article.concept.branches.all()
    )


def can_pin(user, concept) -> bool:
    """Choosing which article of a page a reader sees first. Staff or a governor — never an author
    of one of the competing articles, for the obvious reason."""
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    return any(is_governor_of_course(user, branch) for branch in concept.branches.all())


def can_edit_draft(revision, user) -> bool:
    """A draft is its author's until it is submitted. Staff too, because somebody has to be able to
    take an abandoned one out of the way."""
    if not _is_authenticated(user):
        return False
    return user.is_staff or revision.created_by_id == user.pk


def can_edit_metadata(concept, user) -> bool:
    """Which branches a concept is attached to.

    Staff, a governor, **or its creator while nothing under it has been published yet**. The third
    is the window in which the branches are still part of what the creator is proposing; once an
    article is live those branches are what decides who governs the page, and letting the creator
    move it afterwards would be a way to walk a concept out from under its reviewers.
    """
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if any(is_governor_of_course(user, branch) for branch in concept.branches.all()):
        return True
    if concept.created_by_id != user.pk:
        return False
    from .models import ConceptRevision

    return not ConceptRevision.objects.filter(
        article__concept=concept, status='published'
    ).exists()


def link_block_reason(user) -> str | None:
    """Why this person cannot file a link, or None — a reason rather than a boolean (house rule 6).

    `minor` is a rule rather than a judgement, and it is the one that most needs its own sentence: a
    minor may write a whole article, because a person reads it before it goes anywhere. A link is
    the one act here with no review step at all — it appears on somebody else's exercise page the
    instant it is filed — which is exactly why it is the one closed to an account belonging to a
    child.
    """
    if not _is_authenticated(user):
        return 'authentication_required'
    if is_minor(user):
        return 'minor'
    return None


def can_remove_link(link, user) -> bool:
    """Unfiling a link: the person who filed it, staff, or a governor of one of the concept's
    branches.

    **False for a `body` link, for everybody**, because the text is what says it: removing the row
    would leave a `[[slug]]` rendering as a link to a concept that no longer lists it, and the next
    publication would put the row straight back. `services.remove_link` answers `body_origin` so the
    frontend can say which sentence to edit instead.
    """
    if link.origin == 'body':
        return False
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if link.added_by_id is not None and link.added_by_id == user.pk:
        return True
    return any(
        is_governor_of_course(user, branch) for branch in link.concept.branches.all()
    )


def governed_branch_ids_for(user):
    """`moderation.services.governed_branch_ids`, re-exported so the queue section and the views
    read it from this module like everything else. **None for staff, a real (possibly empty) set for
    a governor** — never collapse the two."""
    return governed_branch_ids(user)


__all__ = [
    'visible_articles',
    'visible_concepts',
    'queue_queryset',
    'can_view',
    'can_view_article',
    'can_view_revision',
    'can_autopublish',
    'can_review',
    'can_pin',
    'can_edit_draft',
    'can_edit_metadata',
    'link_block_reason',
    'can_remove_link',
    'governed_branch_ids_for',
]
