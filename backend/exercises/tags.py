"""Making a tag by asking a question in it, and which tags a reader may see (WP16, 2026-10-15).

The owner, verbatim: **"tag creation is a must"**. Until today a question (`activity.Post` anchored
to a tag, HISTORY §17CO) could only go into a tag that already existed. Now the `/ask` form can name
a new one, and the post-create path (`activity/views.py: PostViewSet.create`) asks THIS module —
one rule, one place (root CLAUDE.md boundary 2) — so a tag never exists without the post that made
it.

**What a new tag looks like.** The same shape as the 860 ASCII slugs that are most of the corpus
(`calka-podwojna`): lower case, Polish letters folded (`ł` → `l`, every accent off), anything that
is not a letter or a digit becomes one hyphen. So "Całka z 1-formy" becomes `calka-z-1-formy`. That
slug IS the tag's whole text — there is no separate display name — which also makes it sanitised by
construction (house rule 8): nothing but `[a-z0-9-]` is ever stored, so there is no markup for
`bleach` to find.

**Near-duplicates are reused, not made.** 162 corpus tags are free text ("całka z 1-formy", next to
an ASCII `calka-z-formy`), so a match compares FOLDED forms on both sides: typing "CAŁKA Z 1-FORMY"
lands in the existing "całka z 1-formy" rather than minting `calka-z-1-formy` beside it. The
frontend's `TagPicker.svelte: fold` is the same function, mirrored (house rule 13) — when the two
disagree the picker offers "create" for a name the server then quietly reuses, which is harmless
but says the wrong thing.

**Who may create** (each refusal is a word, mirrored in `frontend/src/lib/utils/labels.ts:
TAG_REFUSAL_LABELS`, house rule 6):

- a signed-in account (the posts endpoint already refuses a guest; the word exists for any other
  caller);
- NOT a minor: a minor's question is held for a moderator (`accounts/minors.py`), and a tag minted
  by a held question would be a new public name nobody has looked at. A minor may still ask in any
  existing tag, matched the same folded way. Refusing is simpler than a second held thing to
  review, and says plainly what to do instead;
- at most `tag_create` per hour (`settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`), counted only
  when a tag is actually about to be made — reusing an existing one is free;
- the `posts` kill switch covers all of it (asking IS posting). Posts do not go through
  `config/creation.py`'s verification gate — that gate is for founding a course, an event, a
  listing, an organisation or a contest — so neither does this.

**The orphan rule** (`listed_tags`). A tag minted by a question (`Tag.from_question`) is listed —
in `/api/tags/`, the picker, the tag page — only while something a reader may see uses it: an
exercise, a material, a concept, or a post that is neither tombstoned nor auto-hidden nor held. So
a question that is withdrawn by its author, hidden by reports or removed by a moderator takes its
tag's name off the site with it, with no write and nothing to forget to undo: the visibility is
DERIVED, never stored (house rules 5 and 9). It deliberately does NOT set `is_removed`: an author
deleting "I asked in the wrong tag" is no judgement on the name, and auto-hide is not a decision.
A moderator who thinks the NAME is the problem removes the tag itself (the tag report, or the
admin), and a removed tag can never be re-made by spelling it differently — the fold catches it.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable

from django.db import IntegrityError
from django.db.models import Exists, OuterRef, Q, QuerySet

from .models import Tag

#: The longest name somebody may type — the slug column is a SlugField's 50, and a tag is a label,
#: not a sentence.
MAX_TAG_NAME_LENGTH = 50
MIN_SLUG_LENGTH = 2

# ---- refusal words (mirrored in frontend `labels.ts: TAG_REFUSAL_LABELS`, house rule 13) --------
SIGNIN_REQUIRED = 'signin_required'
NAME_EMPTY = 'tag_name_empty'
NAME_TOO_SHORT = 'tag_name_too_short'
NAME_TOO_LONG = 'tag_name_too_long'
NAME_LINK_OR_MARKUP = 'tag_name_link_or_markup'
TAG_REMOVED = 'tag_removed'
MINOR = 'minor_cannot_create_tag'
THROTTLED = 'too_many_new_tags'

REFUSALS = (
    SIGNIN_REQUIRED,
    NAME_EMPTY,
    NAME_TOO_SHORT,
    NAME_TOO_LONG,
    NAME_LINK_OR_MARKUP,
    TAG_REMOVED,
    MINOR,
    THROTTLED,
)

# A link or a piece of markup in a tag name. A tag needs neither, and refusing says so honestly
# instead of folding `evil.example/x` into `evil-example-x` and publishing that. Deliberately broad:
# any `<`, `>`, `&`, `@`, slash or backslash, `://` or a scheme, `www.`, or a dot between two
# letters.
_LINK_OR_MARKUP = re.compile(
    r'[<>&@/\\]|://|\b(?:javascript|data|mailto|https?):|\bwww\.|[^\W\d_]\.[^\W\d_]', re.IGNORECASE
)


def clean_name(name: str) -> str:
    """Trim, collapse every run of whitespace to one space, drop a leading `#`."""
    text = ' '.join(str(name or '').split())
    return text.lstrip('#').strip()


def fold(text: str) -> str:
    """"Całka  Z 1-formy" → "calka-z-1-formy". Mirrored in `TagPicker.svelte: fold` — keep the two
    the same. `ł` first, because it has no decomposition (NFKD leaves it whole, so Django's own
    `slugify` would turn "całka" into "caka")."""
    text = str(text or '').lower().replace('ł', 'l')
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def name_refusal(name: str) -> str | None:
    """Why this name cannot become a tag, or None. Only the shape of the text — not who asks."""
    cleaned = clean_name(name)
    if not cleaned:
        return NAME_EMPTY
    if len(cleaned) > MAX_TAG_NAME_LENGTH:
        return NAME_TOO_LONG
    if _LINK_OR_MARKUP.search(cleaned):
        return NAME_LINK_OR_MARKUP
    slug = fold(cleaned)
    if not slug:
        return NAME_EMPTY
    if len(slug) < MIN_SLUG_LENGTH:
        return NAME_TOO_SHORT
    return None


def matching_tag(name: str) -> Tag | None:
    """The existing tag this name already means, compared folded — or None.

    About a thousand slugs, folded in Python: a fold is not something SQLite can do in a WHERE, the
    call is throttled behind a signed-in post, and a column holding the folded form would be one
    more thing to keep in step. A live tag beats a removed one; among several live ones (the
    corpus has `calka-podwojna` AND "całka podwójna") the one whose slug already IS the fold wins,
    then the oldest."""
    wanted = fold(clean_name(name))
    if not wanted:
        return None
    exact = Tag.objects.filter(slug=wanted).first()
    if exact is not None and not exact.is_removed:
        return exact
    removed: Tag | None = exact
    for tag in Tag.objects.order_by('id'):
        if fold(tag.slug) != wanted:
            continue
        if not tag.is_removed:
            return tag
        removed = removed or tag
    return removed


def creator_refusal(user) -> str | None:
    """Who may mint a new tag. A refusal here never stops somebody REUSING an existing one."""
    from accounts.minors import is_minor

    if not (user and getattr(user, 'is_authenticated', False)):
        return SIGNIN_REQUIRED
    if is_minor(user):
        return MINOR
    return None


def create_tag_from(
    name: str, user, *, allow_create: Callable[[], bool] | None = None
) -> tuple[Tag | None, bool, str | None]:
    """The one path from a name somebody typed to a tag a question can go into.

    Returns `(tag, created, None)` — `created` False when an existing tag already meant this name
    (the UI says "added to the existing tag …") — or `(None, False, '<refusal word>')`.

    `allow_create` is the caller's throttle, asked ONLY when a new row is about to be written, so
    reusing a tag never spends it. The caller runs this inside the same transaction as the post it
    anchors, so a refused or failed post leaves no tag behind."""
    refusal = name_refusal(name)
    if refusal:
        return None, False, refusal
    existing = matching_tag(name)
    if existing is not None:
        if existing.is_removed:
            return None, False, TAG_REMOVED
        return existing, False, None
    refusal = creator_refusal(user)
    if refusal:
        return None, False, refusal
    if allow_create is not None and not allow_create():
        return None, False, THROTTLED
    slug = fold(clean_name(name))[:50].strip('-')
    try:
        tag, created = Tag.objects.get_or_create(
            slug=slug, defaults={'created_by': user, 'from_question': True}
        )
    except IntegrityError:  # two people, the same new name, the same instant
        tag, created = Tag.objects.get(slug=slug), False
    if tag.is_removed:
        return None, False, TAG_REMOVED
    return tag, created, None


def listed_tags(queryset: QuerySet[Tag] | None = None) -> QuerySet[Tag]:
    """The tags a reader may see: not removed, and — for a tag minted by a question — still used by
    something visible. See the module docstring, "The orphan rule"."""
    from activity.models import Post
    from concepts.models import Concept
    from materials.models import Material

    from .models import Exercise

    qs = Tag.objects.all() if queryset is None else queryset
    used = (
        Exists(Exercise.tags.through.objects.filter(tag_id=OuterRef('pk')))
        | Exists(Material.tags.through.objects.filter(tag_id=OuterRef('pk')))
        | Exists(Concept.tags.through.objects.filter(tag_id=OuterRef('pk')))
        | Exists(
            Post.objects.filter(
                tag_id=OuterRef('pk'), is_removed=False, auto_hidden_at__isnull=True
            )
        )
    )
    return qs.filter(is_removed=False).filter(Q(from_question=False) | used)


def merge_tag(source: Tag, target: Tag) -> None:
    """Fold `source` into `target` — the admin's "merge into" (`exercises/admin.py`). Every use
    moves (exercises, materials, concepts, posts, feed rows, follows — a follow of both keeps the
    target's), and `source` is REMOVED rather than deleted, so a report filed against it still
    resolves and its name can never be re-made by folding (house rule 12)."""
    from activity.models import ActivityEvent, Post
    from concepts.models import Concept
    from materials.models import Material

    from .models import Exercise, TagFollow

    if source.pk == target.pk:
        return
    for through in (
        Exercise.tags.through,
        Material.tags.through,
        Concept.tags.through,
        ActivityEvent.tags.through,
    ):
        owner_field = next(
            f.name for f in through._meta.get_fields()
            if getattr(f, 'related_model', None) is not None
            and f.related_model is not Tag
            and f.many_to_one
        )
        already = set(through.objects.filter(tag=target).values_list(f'{owner_field}_id', flat=True))
        rows = through.objects.filter(tag=source)
        rows.exclude(**{f'{owner_field}_id__in': already}).update(tag=target)
        rows.delete()
    Post.objects.filter(tag=source).update(tag=target)
    followers = set(TagFollow.objects.filter(tag=target).values_list('user_id', flat=True))
    TagFollow.objects.filter(tag=source).exclude(user_id__in=followers).update(tag=target)
    TagFollow.objects.filter(tag=source).delete()
    Tag.objects.filter(pk=source.pk).update(is_removed=True)
