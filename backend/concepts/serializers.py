"""The shapes `/api/concepts/…` answers with, and the one write serializer every editor posts to.

Three things are worth knowing before reading:

* **Every `can_*` field reads `access.py`**, never its own copy of a rule. A button drawn for an
  action the server would refuse is the defect this costs one method call to avoid, and it is the
  reason the detail payload carries `will_publish`, `can_pin`, `can_edit_metadata` and
  `link_block_reason` rather than letting the frontend guess from a role.
* **Uniqueness is checked here, in the serializer.** DRF derives validators from `unique_together`
  but **not** from `Meta.constraints`, and every constraint in this app is a `constraints` entry
  (`backend/CLAUDE.md`) — so nothing relies on DRF to refuse a duplicate. The services claim rows
  with WHERE-anchored updates and answer 409; these serializers refuse what they can see is wrong
  before a request gets that far.
* **Blocks are validated by `blocks.clean_blocks`**, which raises Django's `ValidationError`;
  `ConceptContentSerializer.validate_blocks` re-raises the DRF one so a malformed body is a 400
  with a `blocks` key. Sanitization happens again in `ConceptRevision.save()`, because the API is
  not the only write path (house rule: sanitize in `save()`).
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from config.audience import AUDIENCE_VALUES
from config.i18n_utils import request_locale, resolve_translation

from . import resolve
from .access import (
    can_edit_draft,
    can_pin,
    can_review,
    can_autopublish,
    link_block_reason,
    can_remove_link,
)
from .blocks import clean_blocks, expand_blocks
from .models import (
    LINK_TARGETS,
    MAX_SUMMARY_LENGTH,
    MAX_TITLE_LENGTH,
    Concept,
    ConceptAsset,
)


def _display_name(user) -> str:
    if user is None:
        return ''
    return getattr(getattr(user, 'profile', None), 'display_name', '') or user.username


def _user(context):
    request = context.get('request')
    return getattr(request, 'user', None)


def _branch_names(concept, context) -> list[str]:
    locale = request_locale(context)
    names = []
    for branch in concept.branches.all():
        translation = resolve_translation(branch.translations, locale)
        names.append(translation.name if translation else branch.slug)
    return names


# --- assets ---------------------------------------------------------------------------------------


class ConceptAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ConceptAsset
        fields = ['id', 'kind', 'url', 'original_name', 'size_bytes', 'width', 'height']
        read_only_fields = fields

    def get_url(self, obj) -> str:
        if not obj.file:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url


# --- writing --------------------------------------------------------------------------------------


class ConceptContentSerializer(serializers.Serializer):
    """The body every editor posts: a title, a summary, the blocks and a change note.

    One serializer for all three write shapes (a new concept, a new article, a new revision), with
    the fields that differ layered on below, because the CONTENT is the same thing in all three and
    a second copy of its validation is a second thing to keep correct.
    """

    title = serializers.CharField(max_length=MAX_TITLE_LENGTH)
    summary = serializers.CharField(
        max_length=MAX_SUMMARY_LENGTH, required=False, allow_blank=True, default=''
    )
    blocks = serializers.ListField(required=False, default=list)
    change_note = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=''
    )

    def validate_blocks(self, value):
        try:
            return clean_blocks(value, user=_user(self.context))
        except DjangoValidationError as exc:
            # `message_dict` when the refusal named a field (every one in `blocks.py` does), so the
            # client gets `{'blocks': [...]}` rather than a bare list it has to guess the field for.
            raise serializers.ValidationError(
                exc.message_dict if hasattr(exc, 'message_dict') else {'blocks': exc.messages}
            )


class ConceptCreateSerializer(ConceptContentSerializer):
    """`POST /api/concepts/` — the first article of a brand-new concept, in one request."""

    audience = serializers.ChoiceField(choices=AUDIENCE_VALUES)
    locale = serializers.CharField(max_length=8)
    branches = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False, default=list
    )
    tags = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False, default=list
    )
    submit = serializers.BooleanField(required=False, default=False)

    def validate_branches(self, value):
        from taxonomy.models import Branch

        rows = list(Branch.objects.filter(slug__in=value))
        missing = sorted(set(value) - {row.slug for row in rows})
        if missing:
            raise serializers.ValidationError(f'No such branch: {missing[0]}.')
        return rows

    def validate_tags(self, value):
        """Tags are created on demand, the way `/submit` already creates them: the vocabulary is
        community-grown, and refusing a word nobody has used yet would make a new concept unable to
        say what it is about. A removed tag is deliberately not resurrected."""
        from exercises.models import Tag

        rows = []
        for slug in value:
            slug = slug.strip().lower()
            if not slug:
                continue
            tag, _created = Tag.objects.get_or_create(slug=slug)
            if not tag.is_removed:
                rows.append(tag)
        return rows


class ConceptArticleCreateSerializer(ConceptContentSerializer):
    """`POST /api/concepts/{slug}/articles/` — a new article of an existing concept."""

    audience = serializers.ChoiceField(choices=AUDIENCE_VALUES)
    locale = serializers.CharField(max_length=8)
    submit = serializers.BooleanField(required=False, default=False)


class ConceptRevisionCreateSerializer(ConceptContentSerializer):
    """`POST /api/concept-articles/{id}/revisions/` — a change to an article that exists.

    `based_on` is a bare id rather than a nested object: the client got it from the head it was
    handed, and the stale check (`services.submit_revision`) is what makes it mean anything.
    """

    based_on = serializers.IntegerField(required=False, allow_null=True, default=None)
    submit = serializers.BooleanField(required=False, default=False)


class ConceptDraftUpdateSerializer(ConceptContentSerializer):
    """`PATCH /api/concept-revisions/{id}/` — editing a draft in place. Every field optional,
    because a draft save is usually one field moving."""

    title = serializers.CharField(max_length=MAX_TITLE_LENGTH, required=False)


class ConceptMetadataSerializer(serializers.Serializer):
    """`PATCH /api/concepts/{slug}/` — the branches, and nothing else.

    No slug: it is what `[[…]]` and every shared link resolve against and is immutable through the
    API (CONCEPTS-BRIEF.md §0). No tags either — those go through `/api/tags/{slug}/apply/` with
    `kind='concept'`, the one endpoint every taggable thing on this platform already uses.
    """

    branches = serializers.ListField(child=serializers.CharField(max_length=120), required=False)

    def validate_branches(self, value):
        from taxonomy.models import Branch

        rows = list(Branch.objects.filter(slug__in=value))
        missing = sorted(set(value) - {row.slug for row in rows})
        if missing:
            raise serializers.ValidationError(f'No such branch: {missing[0]}.')
        return rows


# --- reading: revisions ---------------------------------------------------------------------------


class ConceptRevisionSummarySerializer(serializers.Serializer):
    """A line in a history list — everything but the content itself."""

    id = serializers.IntegerField()
    article_id = serializers.IntegerField()
    number = serializers.IntegerField()
    status = serializers.CharField()
    title = serializers.CharField()
    change_note = serializers.CharField()
    created_by_id = serializers.IntegerField()
    created_by_display_name = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    published_at = serializers.DateTimeField()

    def get_created_by_display_name(self, obj) -> str:
        return _display_name(obj.created_by)


class ConceptRevisionSerializer(ConceptRevisionSummarySerializer):
    """One revision in full, with its blocks already expanded for reading.

    `based_on_is_current` is the field a reviewer's decision actually rests on: it says whether this
    revision was written against what is published NOW, so the queue row and the history page can
    show "this is a change to the current text" or "this was written against an older one" without
    either of them re-deriving the comparison.
    """

    concept_id = serializers.IntegerField(source='article.concept_id')
    slug = serializers.CharField(source='article.concept.slug')
    audience = serializers.CharField(source='article.audience')
    locale = serializers.CharField(source='article.locale')
    summary = serializers.CharField()
    blocks = serializers.SerializerMethodField()
    based_on_id = serializers.IntegerField()
    based_on_is_current = serializers.SerializerMethodField()
    updated_at = serializers.DateTimeField()
    submitted_at = serializers.DateTimeField()
    reviewed_by_id = serializers.IntegerField()
    reviewed_by_display_name = serializers.SerializerMethodField()
    reviewed_at = serializers.DateTimeField()
    review_note = serializers.CharField()
    will_publish = serializers.SerializerMethodField()
    can_submit = serializers.SerializerMethodField()
    can_decide = serializers.SerializerMethodField()
    can_withdraw = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    def get_blocks(self, obj):
        return expand_blocks(obj.blocks, request=self.context.get('request'))

    def get_reviewed_by_display_name(self, obj) -> str:
        return _display_name(obj.reviewed_by)

    def _head(self, obj):
        if 'head' not in self.context:
            from .services import head_of

            return head_of(obj.article)
        return self.context['head']

    def get_based_on_is_current(self, obj) -> bool:
        head = self._head(obj)
        return getattr(head, 'pk', None) == obj.based_on_id

    def get_will_publish(self, obj) -> bool:
        return can_autopublish(_user(self.context), obj.article.concept)

    def get_can_submit(self, obj) -> bool:
        return obj.status == 'draft' and can_edit_draft(obj, _user(self.context))

    def get_can_decide(self, obj) -> bool:
        return obj.status == 'pending' and can_review(_user(self.context), obj.article)

    def get_can_withdraw(self, obj) -> bool:
        user = _user(self.context)
        return obj.status == 'pending' and obj.created_by_id == getattr(user, 'pk', None)

    def get_can_delete(self, obj) -> bool:
        return obj.status == 'draft' and can_edit_draft(obj, _user(self.context))


# --- reading: articles ----------------------------------------------------------------------------


class ConceptArticleSummarySerializer(serializers.Serializer):
    """One article as it appears in a pool — enough to choose between two of them."""

    id = serializers.IntegerField()
    audience = serializers.CharField()
    locale = serializers.CharField()
    pinned = serializers.BooleanField()
    title = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField()
    created_by_display_name = serializers.SerializerMethodField()
    head_published_at = serializers.SerializerMethodField()
    revision_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    def _head(self, obj):
        for revision in obj.revisions.all():
            if revision.status == 'published':
                return revision
        return None

    def get_title(self, obj) -> str:
        head = self._head(obj)
        return head.title if head is not None else ''

    def get_summary(self, obj) -> str:
        head = self._head(obj)
        return head.summary if head is not None else ''

    def get_created_by_display_name(self, obj) -> str:
        return _display_name(obj.created_by)

    def get_head_published_at(self, obj):
        head = self._head(obj)
        return head.published_at if head is not None else None

    def get_revision_count(self, obj) -> int:
        """Counted, never stored (house rule 5). Reads `revisions.all()`, so a prefetched article
        pays no query, and the count is of what a READER may see — a draft nobody has submitted is
        not part of the article's history yet."""
        return sum(
            1 for revision in obj.revisions.all() if revision.status in ('published', 'superseded')
        )

    def get_comment_count(self, obj) -> int:
        counts = self.context.get('comment_counts')
        if counts is not None:
            return counts.get(obj.pk, 0)
        from django.contrib.contenttypes.models import ContentType

        from community.models import Comment

        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
            is_removed=False,
        ).count()


class ConceptArticleSerializer(ConceptArticleSummarySerializer):
    """One article in full: its head, the caller's own open revision on it, and what they may do."""

    concept_id = serializers.IntegerField()
    slug = serializers.CharField(source='concept.slug')
    head = serializers.SerializerMethodField()
    my_open = serializers.SerializerMethodField()
    can_review = serializers.SerializerMethodField()
    can_pin = serializers.SerializerMethodField()
    will_publish = serializers.SerializerMethodField()

    def get_head(self, obj):
        head = self._head(obj)
        if head is None:
            return None
        return ConceptRevisionSerializer(
            head, context={**self.context, 'head': head}
        ).data

    def get_my_open(self, obj):
        """The caller's own draft or pending revision on this article, so the editor opens what they
        already started rather than offering to begin again (and then refusing with
        `draft_exists`)."""
        user = _user(self.context)
        if user is None or not user.is_authenticated:
            return None
        for revision in obj.revisions.all():
            if revision.created_by_id == user.pk and revision.status in ('draft', 'pending'):
                return ConceptRevisionSummarySerializer(revision, context=self.context).data
        return None

    def get_can_review(self, obj) -> bool:
        return can_review(_user(self.context), obj)

    def get_can_pin(self, obj) -> bool:
        return can_pin(_user(self.context), obj.concept)

    def get_will_publish(self, obj) -> bool:
        return can_autopublish(_user(self.context), obj.concept)


# --- reading: links -------------------------------------------------------------------------------


def _target_title(target, context) -> str:
    """A human name for whatever a link points at, resolved the way that thing's own page resolves
    it — never a slug where a title exists, and never a second, differently-resolved copy."""
    if target is None:
        return ''
    locale = request_locale(context)
    model_name = target._meta.model_name
    if model_name == 'exercise':
        from exercises.serializers import _resolve_exercise_translation

        translation = _resolve_exercise_translation(target, locale)
        return translation.title if translation else f'#{target.number}'
    if model_name == 'material':
        translation = resolve_translation(target.translations, locale)
        return translation.title if translation else target.slug
    if model_name == 'concept':
        for article in target.articles.all():
            for revision in article.revisions.all():
                if revision.status == 'published':
                    return revision.title
        return target.slug
    return str(target)


class ConceptLinkSerializer(serializers.Serializer):
    """One link as the concept's own page shows it."""

    id = serializers.IntegerField()
    relation = serializers.CharField()
    origin = serializers.CharField()
    target_type = serializers.SerializerMethodField()
    target_id = serializers.IntegerField(source='object_id')
    target_title = serializers.SerializerMethodField()
    target_slug = serializers.SerializerMethodField()
    target_audience = serializers.SerializerMethodField()
    added_by_id = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    can_remove = serializers.SerializerMethodField()

    def _type(self, obj) -> str:
        from django.contrib.contenttypes.models import ContentType

        content_type = ContentType.objects.get_for_id(obj.content_type_id)
        return LINK_TARGETS.get((content_type.app_label, content_type.model), '')

    def get_target_type(self, obj) -> str:
        return self._type(obj)

    def get_target_title(self, obj) -> str:
        return _target_title(obj.target, self.context)

    def get_target_slug(self, obj) -> str:
        """A concept target's own slug, so the chip links to `/concepts/<slug>` without a second
        request. Empty for an exercise or a material, which are addressed by numeric id."""
        target = obj.target
        return target.slug if isinstance(target, Concept) else ''

    def get_target_audience(self, obj) -> str:
        target = obj.target
        return getattr(target, 'audience', '') if not isinstance(target, Concept) else ''

    def get_can_remove(self, obj) -> bool:
        return can_remove_link(obj, _user(self.context))


class ConceptBacklinkSerializer(serializers.Serializer):
    """A concept pointing AT something — the chip row on an exercise or a material page, and the
    "linked from" list on a concept's own page.

    `title` and `summary` resolve for the caller exactly the way a list row does, so the chip says
    what the reader's own band and language would have called that concept.
    """

    link_id = serializers.IntegerField(source='id')
    concept_id = serializers.IntegerField()
    slug = serializers.CharField(source='concept.slug')
    title = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    relation = serializers.CharField()
    origin = serializers.CharField()

    def _lead(self, obj):
        user = _user(self.context)
        concept = obj.concept
        key, _flags = resolve.resolve_page(
            concept,
            audiences=self.context.get('audiences'),
            locales=self.context.get('locales') or [],
            user=user,
        )
        if key is None:
            return None
        rows = resolve.pool_with_heads(concept, key[0], key[1], user)
        return rows[0][1] if rows else None

    def get_title(self, obj) -> str:
        head = self._lead(obj)
        return head.title if head is not None else obj.concept.slug

    def get_summary(self, obj) -> str:
        head = self._lead(obj)
        return head.summary if head is not None else ''


# --- reading: the concept itself --------------------------------------------------------------------


class ConceptListRowSerializer(serializers.Serializer):
    """One card in `/concepts` and in search.

    `title` and `summary` come from the RESOLVED page's lead article, not from "the first article"
    — a list that named every concept by whichever article happened to be written first would label
    the primary-school card with the university title. `is_fallback` says whether that resolution
    had to compromise, so a card can be marked rather than silently mislabelled.
    """

    id = serializers.IntegerField()
    slug = serializers.CharField()
    title = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    audience = serializers.SerializerMethodField()
    locale = serializers.SerializerMethodField()
    article_count = serializers.SerializerMethodField()
    audiences = serializers.SerializerMethodField()
    locales = serializers.SerializerMethodField()
    branch_ids = serializers.SerializerMethodField()
    branch_names = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    updated_at = serializers.DateTimeField()
    is_fallback = serializers.SerializerMethodField()

    def _resolved(self, obj):
        cache = self.context.setdefault('_resolved', {})
        if obj.pk not in cache:
            user = _user(self.context)
            key, flags = resolve.resolve_page(
                obj,
                audiences=self.context.get('audiences'),
                locales=self.context.get('locales') or [],
                user=user,
            )
            rows = resolve.pool_with_heads(obj, key[0], key[1], user) if key else []
            cache[obj.pk] = (key, flags, rows)
        return cache[obj.pk]

    def get_title(self, obj) -> str:
        _key, _flags, rows = self._resolved(obj)
        return rows[0][1].title if rows else obj.slug

    def get_summary(self, obj) -> str:
        _key, _flags, rows = self._resolved(obj)
        return rows[0][1].summary if rows else ''

    def get_audience(self, obj) -> str:
        key, _flags, _rows = self._resolved(obj)
        return key[0] if key else ''

    def get_locale(self, obj) -> str:
        key, _flags, _rows = self._resolved(obj)
        return key[1] if key else ''

    def _pages(self, obj):
        cache = self.context.setdefault('_pages', {})
        if obj.pk not in cache:
            cache[obj.pk] = resolve.pages(obj, _user(self.context))
        return cache[obj.pk]

    def get_article_count(self, obj) -> int:
        """Every readable article of this concept, across all its pages — counted, never stored
        (house rule 5). It is what the card's "N articles" line says, so it has to mean the same
        thing the page switcher shows."""
        return sum(page['article_count'] for page in self._pages(obj))

    def get_audiences(self, obj) -> list[str]:
        return sorted({page['audience'] for page in self._pages(obj)})

    def get_locales(self, obj) -> list[str]:
        return sorted({page['locale'] for page in self._pages(obj)})

    def get_branch_ids(self, obj) -> list[str]:
        return [branch.slug for branch in obj.branches.all()]

    def get_branch_names(self, obj) -> list[str]:
        return _branch_names(obj, self.context)

    def get_tags(self, obj) -> list[str]:
        return [tag.slug for tag in obj.tags.all()]

    def get_is_fallback(self, obj) -> bool:
        _key, flags, _rows = self._resolved(obj)
        return not (flags['audience_exact'] and flags['locale_exact'])


class ConceptDetailSerializer(serializers.Serializer):
    """`GET /api/concepts/{slug}/` — one concept, resolved for this reader.

    **The detail never narrows** (root CLAUDE.md's content-language rule): `page` is always the best
    answer this reader can be given, with `audience_exact` and `locale_exact` saying how good it is,
    so a shared link always resolves and the page can explain itself in words.
    """

    id = serializers.IntegerField()
    slug = serializers.CharField()
    branch_ids = serializers.SerializerMethodField()
    branch_names = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField()
    created_by_display_name = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    page = serializers.SerializerMethodField()
    pages = serializers.SerializerMethodField()
    links = serializers.SerializerMethodField()
    backlinks = serializers.SerializerMethodField()
    my_open = serializers.SerializerMethodField()
    can_edit_metadata = serializers.SerializerMethodField()
    can_pin = serializers.SerializerMethodField()
    link_block_reason = serializers.SerializerMethodField()
    will_publish = serializers.SerializerMethodField()

    def get_branch_ids(self, obj) -> list[str]:
        return [branch.slug for branch in obj.branches.all()]

    def get_branch_names(self, obj) -> list[str]:
        return _branch_names(obj, self.context)

    def get_tags(self, obj) -> list[str]:
        return [tag.slug for tag in obj.tags.all()]

    def get_created_by_display_name(self, obj) -> str:
        return _display_name(obj.created_by)

    def get_page(self, obj):
        key = self.context.get('page_key')
        flags = self.context.get('page_flags') or {}
        if key is None:
            return None
        user = _user(self.context)
        rows = resolve.pool_with_heads(obj, key[0], key[1], user)
        articles = [article for article, _head in rows]
        chosen = self.context.get('chosen_article') or (articles[0] if articles else None)
        return {
            'audience': key[0],
            'locale': key[1],
            'audience_exact': bool(flags.get('audience_exact')),
            'locale_exact': bool(flags.get('locale_exact')),
            'articles': ConceptArticleSummarySerializer(
                articles, many=True, context=self.context
            ).data,
            'article': ConceptArticleSerializer(chosen, context=self.context).data
            if chosen is not None
            else None,
        }

    def get_pages(self, obj):
        return resolve.pages(obj, _user(self.context))

    def get_links(self, obj):
        return ConceptLinkSerializer(
            obj.links.all().select_related('concept'), many=True, context=self.context
        ).data

    def get_backlinks(self, obj):
        """Who points at THIS concept. Only from concepts the caller may see, so an article still
        waiting for review never announces itself on somebody else's page."""
        from django.contrib.contenttypes.models import ContentType

        from .access import visible_concepts
        from .models import ConceptLink

        rows = (
            ConceptLink.objects.filter(
                content_type=ContentType.objects.get_for_model(Concept), object_id=obj.pk
            )
            .filter(concept__in=visible_concepts(_user(self.context)))
            .select_related('concept')
            .prefetch_related('concept__articles__revisions')
        )
        return ConceptBacklinkSerializer(rows, many=True, context=self.context).data

    def get_my_open(self, obj):
        """Every draft and pending revision this caller has anywhere under this concept — the "you
        were writing something" row. `[]` for anonymous, which is not a special case so much as the
        honest answer."""
        user = _user(self.context)
        if user is None or not user.is_authenticated:
            return []
        from .models import ConceptRevision

        rows = ConceptRevision.objects.filter(
            article__concept=obj, created_by=user, status__in=('draft', 'pending')
        ).select_related('article')
        return [
            {
                'revision_id': row.pk,
                'article_id': row.article_id,
                'audience': row.article.audience,
                'locale': row.article.locale,
                'status': row.status,
                'updated_at': row.updated_at,
            }
            for row in rows
        ]

    def get_can_edit_metadata(self, obj) -> bool:
        from .access import can_edit_metadata

        return can_edit_metadata(obj, _user(self.context))

    def get_can_pin(self, obj) -> bool:
        return can_pin(_user(self.context), obj)

    def get_link_block_reason(self, obj):
        return link_block_reason(_user(self.context))

    def get_will_publish(self, obj) -> bool:
        return can_autopublish(_user(self.context), obj)


# --- the moderation queue ---------------------------------------------------------------------------


class ConceptQueueRowSerializer(serializers.Serializer):
    """One row of the moderation queue's `concept_revisions` section.

    Carries the CURRENT text beside the proposed one, because that is what a reviewer is actually
    deciding between — and `based_on_is_current` so they are told when the two are not comparable
    (the revision was written against an older head, and accepting it will overwrite whatever landed
    since). `is_new_concept` / `is_new_article` say which of the three things this is: a whole new
    idea, a new take on an existing one, or a change to a text that exists.
    """

    id = serializers.IntegerField()
    article_id = serializers.IntegerField()
    concept_id = serializers.IntegerField(source='article.concept_id')
    slug = serializers.CharField(source='article.concept.slug')
    audience = serializers.CharField(source='article.audience')
    locale = serializers.CharField(source='article.locale')
    number = serializers.IntegerField()
    title = serializers.CharField()
    summary = serializers.CharField()
    blocks = serializers.SerializerMethodField()
    change_note = serializers.CharField()
    is_new_concept = serializers.SerializerMethodField()
    is_new_article = serializers.SerializerMethodField()
    based_on_is_current = serializers.SerializerMethodField()
    current = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField()
    created_by_display_name = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    submitted_at = serializers.DateTimeField()
    branch_ids = serializers.SerializerMethodField()
    branch_names = serializers.SerializerMethodField()

    def get_blocks(self, obj):
        return expand_blocks(obj.blocks, request=self.context.get('request'))

    def _head(self, obj):
        from .services import head_of

        return head_of(obj.article)

    def get_is_new_article(self, obj) -> bool:
        return obj.number == 1

    def get_is_new_concept(self, obj) -> bool:
        from .models import ConceptRevision

        if obj.number != 1:
            return False
        return not ConceptRevision.objects.filter(
            article__concept_id=obj.article.concept_id, status__in=('published', 'superseded')
        ).exists()

    def get_based_on_is_current(self, obj) -> bool:
        return getattr(self._head(obj), 'pk', None) == obj.based_on_id

    def get_current(self, obj):
        head = self._head(obj)
        if head is None:
            return None
        return {
            'revision_id': head.pk,
            'title': head.title,
            'blocks': expand_blocks(head.blocks, request=self.context.get('request')),
        }

    def get_created_by_display_name(self, obj) -> str:
        return _display_name(obj.created_by)

    def get_branch_ids(self, obj) -> list[str]:
        return [branch.slug for branch in obj.article.concept.branches.all()]

    def get_branch_names(self, obj) -> list[str]:
        return _branch_names(obj.article.concept, self.context)
