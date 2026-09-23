"""`/api/concepts/`, `/api/concept-articles/`, `/api/concept-revisions/`, `/api/concept-links/`,
`/api/concept-assets/`.

Thin on purpose: resolve the object, ask `access.py`, call `services.py`, serialize. Nothing here
decides a rule and nothing here writes a side effect — those two sentences are what keep this app's
trust model readable in two files instead of seven.

**The kill switch.** `concepts` gates every endpoint in this module, staff bypassing as everywhere —
with ONE deliberate carve-out, and it is house rule 3 rather than an exception to it:
`GET /api/concept-links/?target_type=…` answers `[]` instead of 403, because it is read by the chip
row on an exercise's and a material's own page, and a neighbouring page must keep working while
returning nothing for a killed feature.

**404 versus 403.** A concept, article or revision a caller cannot see is not there (`access`'s
queryset half, and an article whose only revision is waiting is simply absent for a stranger). One
they CAN see but may not act on answers 403, because pretending it does not exist would be a lie
they can disprove by reloading the page in front of them. That split is house rule 4, applied per
action rather than per viewset.
"""

from __future__ import annotations

from functools import wraps

from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.views import comment_thread_response
from config.audience import AUDIENCE_VALUES
from config.content_locale import HIDDEN_HEADER, parse_content_locales
from moderation.permissions import feature_gate
from moderation.services import is_feature_enabled

from . import resolve
from .access import (
    can_edit_draft,
    can_edit_metadata,
    can_review,
    can_view_article,
    can_view_revision,
    visible_concepts,
)
from .models import Concept, ConceptArticle, ConceptLink, ConceptRevision
from .serializers import (
    ConceptArticleCreateSerializer,
    ConceptArticleSerializer,
    ConceptAssetSerializer,
    ConceptBacklinkSerializer,
    ConceptCreateSerializer,
    ConceptDetailSerializer,
    ConceptDraftUpdateSerializer,
    ConceptLinkSerializer,
    ConceptListRowSerializer,
    ConceptMetadataSerializer,
    ConceptRevisionCreateSerializer,
    ConceptRevisionSerializer,
    ConceptRevisionSummarySerializer,
)
from .services import (
    Conflict,
    DraftExists,
    Refused,
    Stale,
    add_link,
    create_article,
    create_concept,
    create_revision,
    decide_revision,
    delete_draft,
    links_for_target,
    remove_link,
    save_draft,
    set_pinned,
    store_asset,
    submit_revision,
    withdraw_revision,
)

_ConceptsGate = feature_gate('concepts')

#: A list is bounded by construction (root CLAUDE.md: no global pagination, because every list this
#: frontend calls is small enough to send whole). 60 is a browse page; 200 is the ceiling a client
#: may ask for, so a bad `?limit=` cannot turn this into an export endpoint.
DEFAULT_LIMIT = 60
MAX_LIMIT = 200


def _translates_service_errors(handler):
    """Turn this app's four service exceptions into the four responses the frontend expects.

    One place, because the split is the part that matters and it must not be re-decided per
    endpoint: **409 means the world moved** (already decided, no longer a draft, the head changed,
    you already have a draft) and **400 means the request was refused** by a rule. A `Stale` carries
    the head and a `DraftExists` carries the draft, so the editor shows what landed underneath or
    opens what the person already started — in both cases the refusal IS the navigation.
    """

    @wraps(handler)
    def wrapper(self, request, *args, **kwargs):
        try:
            return handler(self, request, *args, **kwargs)
        except Stale as exc:
            body = {'detail': 'stale'}
            if exc.head is not None:
                body['head'] = ConceptRevisionSummarySerializer(
                    exc.head, context={'request': request}
                ).data
            return Response(body, status=status.HTTP_409_CONFLICT)
        except DraftExists as exc:
            return Response(
                {
                    'detail': 'draft_exists',
                    'draft': ConceptRevisionSummarySerializer(
                        exc.draft, context={'request': request}
                    ).data,
                },
                status=status.HTTP_409_CONFLICT,
            )
        except Conflict as exc:
            return Response({'detail': exc.reason}, status=status.HTTP_409_CONFLICT)
        except Refused as exc:
            return Response({'detail': exc.reason}, status=status.HTTP_400_BAD_REQUEST)
        except LookupError:
            return Response(status=status.HTTP_404_NOT_FOUND)

    return wrapper


def _requested_audiences(params) -> list[str] | None:
    """`?audience=primary,secondary` as an ordered list, or None for "no preference".

    Its own parser rather than `config.audience.parse_audience_param` because ORDER matters here —
    the first band a reader names is the one they most want, and a set cannot say that. It keeps
    that function's two other rules exactly, though, and both are load-bearing:

    * an unknown value is ignored rather than refused (a browse filter degrades to "show
      everything", the same posture `?near=` takes);
    * **`all` means no narrowing**, because asking for everyone is not a filter. A picker that
      must not be narrowed by the reader's own band sends `?audience=all` and gets the whole list
      (`searchConcepts` on the frontend does exactly this), and a reader who genuinely wants the
      "for everybody" article still gets it: with no preference expressed, `resolve.resolve_page`
      tries `all` FIRST.
    """
    raw = params.get('audience')
    if not raw:
        return None
    wanted = [part.strip() for part in raw.split(',') if part.strip() in AUDIENCE_VALUES]
    if not wanted or 'all' in wanted:
        return None
    return wanted


def _requested_locales(params) -> list[str]:
    """The reader's languages, interface language first. `?lang=` (the detail page's explicit pick)
    beats `?content_locales=` (what `client.ts` appends to every list-shaped GET)."""
    explicit = (params.get('lang') or '').strip().lower()
    if explicit:
        return [explicit]
    return parse_content_locales(params.get('content_locales')) or []


def _list_context(request):
    return {
        'request': request,
        'audiences': _requested_audiences(request.query_params),
        'locales': _requested_locales(request.query_params),
    }


class ConceptViewSet(viewsets.GenericViewSet):
    """The concept itself: browsing, creating, reading one, its articles and its links."""

    permission_classes = [_ConceptsGate]
    serializer_class = ConceptDetailSerializer
    lookup_field = 'slug'
    # A slug carries dashes and digits; the router's default `[^/.]+` already allows those, and this
    # spells it out so a future change to the default cannot silently break `[[some-concept]]`.
    lookup_value_regex = '[-a-zA-Z0-9_]+'
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        perms = [_ConceptsGate()]
        if self.request.method not in permissions.SAFE_METHODS:
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_throttles(self):
        """Scope the tight budgets to the WRITE half of each action and nothing else.

        Set here rather than as a class attribute (the shape `coauthoring` and the retired material
        submission endpoint both use): a ViewSet's actions are not all the same request, and reading
        a concept's links is an ordinary cheap GET that should keep the loose global `user` budget
        while filing one is worth bounding. `ScopedRateThrottle` treats a falsy scope as "not
        scoped".
        """
        writing = self.request.method not in permissions.SAFE_METHODS
        scope = None
        if writing:
            if self.action in ('create', 'articles'):
                scope = 'concept_revision'
            elif self.action == 'links':
                scope = 'concept_link'
        self.throttle_scope = scope
        return super().get_throttles()

    def get_queryset(self):
        return (
            visible_concepts(self.request.user)
            .select_related('created_by__profile')
            .prefetch_related(
                'branches__translations',
                'tags',
                'articles__revisions__created_by__profile',
                'articles__created_by__profile',
            )
        )

    def _concept(self, slug):
        return self.get_queryset().filter(slug=slug).first()

    # --- list ------------------------------------------------------------------------------------

    def list(self, request):
        """`?q=` `?branch=` `?tag=` `?letter=` `?sort=` `?audience=` `?content_locales=` `?limit=`.

        The content-language rule in its list form (root CLAUDE.md): the list shows only concepts
        with a PUBLISHED article in one of the reader's languages, and says how many it left out in
        `X-EdMat-Hidden-Languages`. Written out here rather than through
        `config.content_locale.apply_content_locale_filter`, because that helper's `published_only`
        expects the status to live on the same row as the locale — here the locale is on the article
        and the status is on its revision, which is one hop further and the one shape that helper
        cannot express.
        """
        queryset = self.get_queryset()
        params = request.query_params

        branch = (params.get('branch') or '').strip()
        if branch:
            queryset = queryset.filter(branches__slug=branch)
        tag = (params.get('tag') or '').strip()
        if tag:
            queryset = queryset.filter(tags__slug=tag)
        letter = (params.get('letter') or '').strip().lower()[:1]
        if letter:
            queryset = queryset.filter(slug__startswith=letter)

        query = (params.get('q') or '').strip()
        if query:
            queryset = queryset.filter(
                Q(slug__icontains=query)
                | Q(
                    articles__revisions__status='published',
                )
                & (
                    Q(articles__revisions__title__icontains=query)
                    | Q(articles__revisions__summary__icontains=query)
                    | Q(articles__revisions__search_text__icontains=query)
                )
            )

        wanted_audiences = _requested_audiences(params)
        if wanted_audiences:
            # `all` always passes, because it is the one value that means "for everybody" — the same
            # rule `config.audience.apply_audience_filter` applies one table over.
            queryset = queryset.filter(
                articles__audience__in=list(wanted_audiences) + ['all'],
                articles__revisions__status='published',
            )

        queryset = queryset.distinct()

        hidden = 0
        wanted_locales = parse_content_locales(params.get('content_locales'))
        if wanted_locales:
            before = queryset.count()
            queryset = queryset.filter(
                articles__locale__in=wanted_locales, articles__revisions__status='published'
            ).distinct()
            hidden = max(0, before - queryset.count())

        try:
            limit = min(int(params.get('limit') or DEFAULT_LIMIT), MAX_LIMIT)
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT
        limit = max(1, limit)

        sort = params.get('sort') or 'updated'
        # `slug` is the database's best stand-in for the title — a slug IS the first title, reduced
        # — and the real ordering by resolved title happens in Python below, because the title lives
        # on a revision of whichever article this reader resolves to and no single column holds it.
        queryset = queryset.order_by('slug' if sort == 'title' else '-updated_at', 'slug')

        rows = list(queryset[:limit])
        data = ConceptListRowSerializer(rows, many=True, context=_list_context(request)).data
        if sort == 'title':
            data = sorted(data, key=lambda row: (row['title'] or row['slug']).lower())

        response = Response(data)
        response[HIDDEN_HEADER] = str(hidden)
        return response

    # --- create / retrieve / patch ----------------------------------------------------------------

    @_translates_service_errors
    def create(self, request):
        """Start a concept: the row, its first article and revision 1 — as a draft, or sent.

        One request, because a client that crashed between two would have left a concept with no
        article, which nothing can see and nobody can delete. `submit: true` says the person pressed
        the button that means "and send it", and `services.submit_revision` is what decides whether
        that publishes outright or queues — the same function every other submit path calls, so the
        two cannot drift about who skips review.
        """
        payload = ConceptCreateSerializer(data=request.data, context={'request': request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        concept, _article, _revision = create_concept(
            request.user,
            title=data['title'],
            summary=data.get('summary', ''),
            blocks=data.get('blocks') or [],
            audience=data['audience'],
            locale=data['locale'],
            branches=data.get('branches') or [],
            tags=data.get('tags') or [],
            submit=data.get('submit', False),
            request=request,
        )
        concept = self._concept(concept.slug) or concept
        return Response(self._detail(concept, request), status=status.HTTP_201_CREATED)

    def retrieve(self, request, slug=None):
        concept = self._concept(slug)
        if concept is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(self._detail(concept, request))

    def _detail(self, concept, request):
        """The detail payload, with the page resolved once and handed to the serializer.

        Resolved HERE rather than inside the serializer because `?article=` can override which
        article of the page is shown in full, and that is a request-level decision — the serializer
        should render what it is given rather than re-read the query string.
        """
        user = request.user
        key, flags = resolve.resolve_page(
            concept,
            audiences=_requested_audiences(request.query_params),
            locales=_requested_locales(request.query_params),
            user=user,
        )
        chosen = None
        if key is not None:
            articles = resolve.pool(concept, key[0], key[1], user)
            wanted = (request.query_params.get('article') or '').strip()
            if wanted.isdigit():
                # An explicit pick may name an article on ANOTHER page — a reader following a link
                # to somebody's `primary` article while their own band is `university`. Honour it and
                # move the page with it, rather than showing the switcher one page and the body
                # another.
                for article in concept.articles.all():
                    if str(article.pk) == wanted and can_view_article(article, user):
                        chosen = article
                        break
                if chosen is not None and (chosen.audience, chosen.locale) != key:
                    key = (chosen.audience, chosen.locale)
                    flags = {
                        'audience_exact': True,
                        'locale_exact': True,
                    }
            if chosen is None and articles:
                chosen = articles[0]
        context = {
            'request': request,
            'audiences': _requested_audiences(request.query_params),
            'locales': _requested_locales(request.query_params),
            'page_key': key,
            'page_flags': flags,
            'chosen_article': chosen,
        }
        return ConceptDetailSerializer(concept, context=context).data

    def partial_update(self, request, slug=None):
        """The branches, and nothing else — `access.can_edit_metadata` says who."""
        concept = self._concept(slug)
        if concept is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_edit_metadata(concept, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payload = ConceptMetadataSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if 'branches' in payload.validated_data:
            concept.branches.set(payload.validated_data['branches'])
            from telemetry.audit import record_audit

            if request.user.is_authenticated:
                record_audit(
                    request,
                    action='content_edit',
                    target_type='concept',
                    target_id=concept.pk,
                    summary=f'Changed the branches of "{concept.slug}"',
                    detail={'branches': [b.slug for b in payload.validated_data['branches']]},
                )
        concept = self._concept(slug) or concept
        return Response(self._detail(concept, request))

    # --- articles ----------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def articles(self, request, slug=None):
        """GET every article of this concept the caller may see, across all its pages; POST a new
        one.

        Deliberately not refused when an article for that `(audience, locale)` already exists:
        articles for one page are peers, and "somebody already wrote one" is the most ordinary
        reason to want to write your own (CONCEPTS-BRIEF.md §0).
        """
        concept = self._concept(slug)
        if concept is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            rows = [a for a in concept.articles.all() if can_view_article(a, request.user)]
            from .serializers import ConceptArticleSummarySerializer

            return Response(
                ConceptArticleSummarySerializer(
                    rows, many=True, context={'request': request}
                ).data
            )

        payload = ConceptArticleCreateSerializer(data=request.data, context={'request': request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        article, _revision = create_article(
            concept,
            request.user,
            audience=data['audience'],
            locale=data['locale'],
            title=data['title'],
            summary=data.get('summary', ''),
            blocks=data.get('blocks') or [],
            change_note=data.get('change_note', ''),
            submit=data.get('submit', False),
            request=request,
        )
        article.refresh_from_db()
        return Response(
            ConceptArticleSerializer(article, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # --- links ---------------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def links(self, request, slug=None):
        """GET `{links, backlinks}` for this concept; POST a new manual link.

        Both halves are also embedded in the detail payload — this endpoint exists so the links
        panel can refresh itself after an add or a remove without re-fetching the whole page.
        """
        concept = self._concept(slug)
        if concept is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            return Response(self._links_payload(concept, request))

        link = add_link(
            concept,
            request.user,
            target_type=(request.data.get('target_type') or '').strip(),
            target_id=request.data.get('target_id'),
            relation=(request.data.get('relation') or 'related').strip(),
            request=request,
        )
        return Response(
            ConceptLinkSerializer(link, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def _links_payload(self, concept, request):
        from django.contrib.contenttypes.models import ContentType

        context = _list_context(request)
        backlinks = (
            ConceptLink.objects.filter(
                content_type=ContentType.objects.get_for_model(Concept), object_id=concept.pk
            )
            .filter(concept__in=visible_concepts(request.user))
            .select_related('concept')
            .prefetch_related('concept__articles__revisions')
        )
        return {
            'links': ConceptLinkSerializer(
                concept.links.all(), many=True, context=context
            ).data,
            'backlinks': ConceptBacklinkSerializer(backlinks, many=True, context=context).data,
        }


class ConceptArticleViewSet(viewsets.GenericViewSet):
    """One article: reading it, pinning it, its revisions, and the talk about it."""

    # Numeric ids only. Without this the router's default `[^/.]+` hands the ORM whatever is in the
    # URL and a malformed id — `/api/concept-articles/undefined/`, which a frontend bug really did
    # send during a browser run — comes back as a 500 from deep inside the queryset instead of the
    # 404 it is. A thing that cannot exist is not found; it is never a server error.
    lookup_value_regex = '[0-9]+'
    permission_classes = [_ConceptsGate]
    serializer_class = ConceptArticleSerializer
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        perms = [_ConceptsGate()]
        if self.request.method not in permissions.SAFE_METHODS:
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_throttles(self):
        writing = self.request.method not in permissions.SAFE_METHODS
        self.throttle_scope = 'concept_revision' if (writing and self.action == 'revisions') else None
        return super().get_throttles()

    def get_queryset(self):
        return ConceptArticle.objects.select_related(
            'concept', 'created_by__profile'
        ).prefetch_related(
            'revisions__created_by__profile', 'concept__branches', 'concept__tags'
        )

    def _article(self, pk):
        """The article, or None — the caller turns None into a 404.

        Not 403: an article whose only revision is somebody's draft is not a thing this caller can
        know exists, and saying "forbidden" would confirm that it does.
        """
        article = self.get_queryset().filter(pk=pk).first()
        if article is None or not can_view_article(article, self.request.user):
            return None
        return article

    def retrieve(self, request, pk=None):
        article = self._article(pk)
        if article is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(ConceptArticleSerializer(article, context={'request': request}).data)

    @_translates_service_errors
    def partial_update(self, request, pk=None):
        """`{pinned: bool}` — which article of a page a reader sees first. Staff or a governor."""
        article = self._article(pk)
        if article is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if 'pinned' not in request.data:
            return Response({'pinned': ['Required.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            article = set_pinned(article, request.user, bool(request.data['pinned']), request=request)
        except Refused as exc:
            if exc.reason == 'not_allowed':
                return Response(status=status.HTTP_403_FORBIDDEN)
            raise
        return Response(ConceptArticleSerializer(article, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def revisions(self, request, pk=None):
        """GET the history this caller may see, newest first; POST a change.

        The GET answers per row through `can_view_revision` rather than one blanket rule, because
        the four private statuses have different audiences: a draft is its author's, a pending one
        is its author's and its reviewers'.
        """
        article = self._article(pk)
        if article is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            rows = [r for r in article.revisions.all() if can_view_revision(r, request.user)]
            rows.sort(key=lambda r: r.number, reverse=True)
            return Response(
                ConceptRevisionSerializer(rows, many=True, context={'request': request}).data
            )

        payload = ConceptRevisionCreateSerializer(data=request.data, context={'request': request})
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        based_on = None
        if data.get('based_on'):
            based_on = ConceptRevision.objects.filter(
                pk=data['based_on'], article=article
            ).first()
            if based_on is None:
                return Response(
                    {'based_on': ['No such revision of this article.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        revision = create_revision(
            article,
            request.user,
            title=data['title'],
            summary=data.get('summary', ''),
            blocks=data.get('blocks') or [],
            change_note=data.get('change_note', ''),
            based_on=based_on,
            submit=data.get('submit', False),
            request=request,
        )
        return Response(
            ConceptRevisionSerializer(revision, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """The talk about one article — `community.Comment` through the shared helper, whose
        same-thread `parent` check is the load-bearing part.

        A public thread (`conceptArticle` is deliberately NOT in `PRIVATE_TARGET_TYPES`): an article
        a reader can see is a page anybody can open, which is the test that table applies.
        """
        article = self._article(pk)
        if article is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return comment_thread_response(request, article)


class ConceptRevisionViewSet(viewsets.GenericViewSet):
    """One revision: reading it, editing a draft, sending it, deciding it, taking it back."""

    # Numeric ids only. Without this the router's default `[^/.]+` hands the ORM whatever is in the
    # URL and a malformed id — `/api/concept-articles/undefined/`, which a frontend bug really did
    # send during a browser run — comes back as a 500 from deep inside the queryset instead of the
    # 404 it is. A thing that cannot exist is not found; it is never a server error.
    lookup_value_regex = '[0-9]+'
    permission_classes = [_ConceptsGate]
    serializer_class = ConceptRevisionSerializer
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        perms = [_ConceptsGate()]
        if self.request.method not in permissions.SAFE_METHODS:
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_throttles(self):
        self.throttle_scope = (
            'concept_revision' if self.request.method not in permissions.SAFE_METHODS else None
        )
        return super().get_throttles()

    def get_queryset(self):
        return ConceptRevision.objects.select_related(
            'article__concept', 'created_by__profile', 'reviewed_by__profile'
        ).prefetch_related('article__revisions', 'article__concept__branches')

    def _revision(self, pk):
        revision = self.get_queryset().filter(pk=pk).first()
        if revision is None or not can_view_revision(revision, self.request.user):
            return None
        return revision

    def retrieve(self, request, pk=None):
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(ConceptRevisionSerializer(revision, context={'request': request}).data)

    @_translates_service_errors
    def partial_update(self, request, pk=None):
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_edit_draft(revision, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payload = ConceptDraftUpdateSerializer(data=request.data, context={'request': request}, partial=True)
        payload.is_valid(raise_exception=True)
        revision = save_draft(revision, dict(payload.validated_data))
        return Response(ConceptRevisionSerializer(revision, context={'request': request}).data)

    @_translates_service_errors
    def destroy(self, request, pk=None):
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_edit_draft(revision, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        delete_draft(revision, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def submit(self, request, pk=None):
        """Send a draft. Answers 200 with the revision either way and the caller reads its `status`:
        `published` when this person publishes outright, `pending` when it went to the queue. Two
        outcomes of one button, and only the server knows which one this person gets."""
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_edit_draft(revision, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        revision = submit_revision(revision, request.user, request=request)
        return Response(ConceptRevisionSerializer(revision, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def decide(self, request, pk=None):
        """Accept or reject. `{decision: 'accept'|'reject', note?}`.

        The deciding circle is `access.can_review`: staff, a governor of one of the concept's
        branches, or the article's own author. The moderation queue's own Concepts tab calls THIS
        endpoint rather than a new `_KIND_MODELS` kind, for the reason `moderation/CLAUDE.md`
        records about solution entries and material versions — one decision path, one claim, one
        notification sequence to keep correct.
        """
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_review(request.user, revision.article):
            return Response(status=status.HTTP_403_FORBIDDEN)
        revision = decide_revision(
            revision,
            request.user,
            (request.data.get('decision') or '').strip(),
            request.data.get('note') or '',
            request=request,
        )
        return Response(ConceptRevisionSerializer(revision, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def withdraw(self, request, pk=None):
        revision = self._revision(pk)
        if revision is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        revision = withdraw_revision(revision, request.user)
        return Response(ConceptRevisionSerializer(revision, context={'request': request}).data)


class ConceptLinkViewSet(viewsets.GenericViewSet):
    """`GET /api/concept-links/?target_type=&target_id=` and `DELETE /api/concept-links/{id}/`.

    **The list is the one read in this app that survives the kill switch**, answering `[]` rather
    than 403 while `concepts` is off. That is house rule 3 rather than an exception to it: this
    endpoint is called by the chip row on an exercise's and a material's page, and a neighbouring
    endpoint must keep working — returning nothing for the killed feature — instead of failing
    somewhere less useful.
    """

    # Numeric ids only. Without this the router's default `[^/.]+` hands the ORM whatever is in the
    # URL and a malformed id — `/api/concept-articles/undefined/`, which a frontend bug really did
    # send during a browser run — comes back as a 500 from deep inside the queryset instead of the
    # 404 it is. A thing that cannot exist is not found; it is never a server error.
    lookup_value_regex = '[0-9]+'
    serializer_class = ConceptBacklinkSerializer
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        if self.action == 'list':
            return [permissions.AllowAny()]
        return [_ConceptsGate(), permissions.IsAuthenticated()]

    def get_throttles(self):
        self.throttle_scope = 'concept_link' if self.action == 'destroy' else None
        return super().get_throttles()

    def get_queryset(self):
        return ConceptLink.objects.select_related('concept')

    def list(self, request):
        target_type = (request.query_params.get('target_type') or '').strip()
        target_id = request.query_params.get('target_id')
        if not is_feature_enabled('concepts') and not (
            request.user.is_authenticated and request.user.is_staff
        ):
            return Response([])
        rows = links_for_target(target_type, target_id, request.user)
        return Response(
            ConceptBacklinkSerializer(rows, many=True, context=_list_context(request)).data
        )

    @_translates_service_errors
    def destroy(self, request, pk=None):
        link = self.get_queryset().filter(pk=pk).first()
        if link is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            remove_link(link, request.user, request=request)
        except Refused as exc:
            if exc.reason == 'not_allowed':
                return Response(status=status.HTTP_403_FORBIDDEN)
            raise
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConceptAssetViewSet(viewsets.GenericViewSet):
    """`POST /api/concept-assets/` — one picture or PDF for a block.

    Multipart, and the only endpoint in this app that is. There is deliberately no DELETE and no
    list: a block inside a published revision must keep resolving (the `InlineImage` /
    `ChemDrawing` reasoning), and an asset is reached by the id the uploader was handed.
    """

    permission_classes = [_ConceptsGate, permissions.IsAuthenticated]
    serializer_class = ConceptAssetSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'concept_asset'

    def get_queryset(self):
        from .models import ConceptAsset

        return ConceptAsset.objects.none()

    def create(self, request):
        from django.core.exceptions import ValidationError as DjangoValidationError

        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': ['A file is required.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            asset = store_asset(request.user, upload)
        except DjangoValidationError as exc:
            return Response(
                exc.message_dict if hasattr(exc, 'message_dict') else {'file': exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Refused as exc:
            # `quota` rather than a 413: the request itself was well-formed and the right size, and
            # what refused it is an account-level allowance a moderator can raise. The frontend has
            # its own sentence for this one (house rule 6).
            return Response({'detail': exc.reason}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            ConceptAssetSerializer(asset, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )
