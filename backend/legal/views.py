from django.contrib.contenttypes.models import ContentType
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.services import REPORT_KIND_MODELS, _content_owner, _describe, resolve_report_decision
from notifications.services import notify

from .models import LegalNotice
from .serializers import LegalNoticeCreateSerializer, LegalNoticeResolveSerializer, LegalNoticeSerializer


def _is_staff(user) -> bool:
    return bool(user and user.is_authenticated and user.is_staff)


class LegalNoticeViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """`/api/legal-notices/` — DSA Art. 16 notice-and-action. See `legal/models.py`'s own module
    doc comment for why this is not `issues.Issue` with a fourth kind: most importantly, **nothing
    here is gated by `feature_gate()` or any `FeatureFlag`** — this is a standing legal channel, not
    a product feature, and it stays reachable even if every other moderation-adjacent feature on the
    platform is turned off.

    - POST is open to anyone, guest included, behind its own throttle scope.
    - GET (list/retrieve) shows staff everything; shows an authenticated notifier their own notices
      only; shows a guest or anybody else nothing at all — there is no public listing of legal
      notices the way `issues.Issue` has one for bug reports, since these routinely name specific
      people/content and staying private by default is the safer posture.
    - No PATCH/DELETE here — deciding one is its own `resolve` action below, staff only, and a filed
      notice is a record, same as `Issue` never lets its own reporter edit their words after filing.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'legal_notice'

    def get_throttles(self):
        if self.action != 'create':
            return []
        return super().get_throttles()

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = LegalNotice.objects.all()
        user = self.request.user
        if _is_staff(user):
            return qs
        return qs.filter(reporter=user)

    def get_serializer_class(self):
        if self.action == 'create':
            return LegalNoticeCreateSerializer
        return LegalNoticeSerializer

    def create(self, request, *args, **kwargs):
        serializer = LegalNoticeCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        notice = serializer.save()
        return Response(LegalNoticeSerializer(notice).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAdminUser])
    def resolve(self, request, pk=None):
        """Staff deciding one notice. Two things happen, independently:

        1. If `content_kind`/`content_object_id` resolve to a real row AND the decision is 'acted',
           the underlying content is actually removed via the exact same
           `moderation.services.resolve_report_decision` a routine community report already uses —
           which is what fires the Art. 17 "statement of reasons" notification (`content_removed`,
           carrying `resolve_note`) to the CONTENT'S OWN author/submitter. Left blank, staff have
           handled the content some other way (or it maps onto nothing this app can act on directly)
           and this action only ever records the decision.
        2. The notifier who filed the notice (when they have an account — see the model's own doc
           comment on why an anonymous notifier has no in-app channel to reach today) is told the
           outcome via its own `legal_notice_decided` notification, carrying the identical note —
           the Art. 16(6) half of this, distinct from the Art. 17 half above and owed regardless of
           whether any content was actually touched.
        """
        notice = get_object_or_404(LegalNotice, pk=pk)
        serializer = LegalNoticeResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        notice.status = data['status']
        notice.resolve_note = data['resolve_note']
        notice.content_kind = data['content_kind']
        notice.content_object_id = data['content_object_id']
        notice.resolved_by = request.user
        notice.save(
            update_fields=[
                'status', 'resolve_note', 'content_kind', 'content_object_id', 'resolved_by', 'updated_at'
            ]
        )

        if data['status'] == 'acted' and data['content_kind'] and data['content_object_id']:
            model = REPORT_KIND_MODELS[data['content_kind']]
            resolve_report_decision(
                model, data['content_object_id'], 'remove', resolved_by=request.user, note=data['resolve_note']
            )

        notify(
            notice.reporter,
            'legal_notice_decided',
            actor=request.user,
            target_label=notice.content_url[:150],
            note=notice.resolve_note,
        )
        return Response(LegalNoticeSerializer(notice).data)

    @action(detail=True, methods=['get'], url_path='content-preview', permission_classes=[permissions.IsAdminUser])
    def content_preview(self, request, pk=None):
        """`GET .../content-preview/?content_kind=&content_object_id=` — staff only. Lets a
        moderator see WHO POSTED the content they're about to act on, and what it actually says,
        before (or after) deciding — a real gap this pass closes: `resolve` above already resolves
        `_content_owner(target)` internally to route the Art. 17 notification, but never surfaced
        that identity to the person making the decision. Reuses that exact same helper (and
        `_describe` for the preview text) rather than a second lookup.

        `author_id`/`author_display_name` are genuinely absent — not an error — for content with no
        real owner (742 of the migrated corpus exercises have no `submitted_by` at all); the caller
        renders that as an honest "no author on record", not a blank that looks broken.
        """
        get_object_or_404(LegalNotice, pk=pk)  # the notice itself must be real; its own fields aren't used below
        kind = request.query_params.get('content_kind', '')
        object_id = request.query_params.get('content_object_id', '')
        if kind not in REPORT_KIND_MODELS or not object_id.isdigit():
            return Response(status=status.HTTP_400_BAD_REQUEST)
        model = REPORT_KIND_MODELS[kind]
        target = get_object_or_404(model, pk=int(object_id))
        preview, _exercise_id, _exercise_title = _describe(target, kind)
        owner = _content_owner(target)
        return Response(
            {
                'preview': preview,
                'author_id': owner.id if owner else None,
                'author_display_name': (
                    (getattr(getattr(owner, 'profile', None), 'display_name', '') or owner.username)
                    if owner
                    else ''
                ),
            }
        )

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """The one channel for the DSA Art. 20 "right to contest" this pass actually builds: staff
        and the notice's own notifier (when they have an account) may read and reply here — nobody
        else, 404 otherwise, since a legal notice is never public the way an Issue's own thread can
        be. This is deliberately NOT symmetric with the content author's own side of Art. 20 — see
        root CLAUDE.md §17AW's "left open" note for exactly why (this action never learns who the
        content's author is unless staff resolved `content_kind`/`content_object_id`, and even then
        the author's own appeal path is the pre-existing one `content_removed`'s own notification
        already gives them, not a second mechanism invented here). `content_preview` above now lets
        staff SEE that author before deciding, but still doesn't give the author their own inbound
        channel into this thread.
        """
        notice = get_object_or_404(LegalNotice, pk=pk)
        user = request.user
        is_own = user.is_authenticated and notice.reporter_id is not None and notice.reporter_id == user.id
        if not (_is_staff(user) or is_own):
            return Response(status=status.HTTP_404_NOT_FOUND)
        content_type = ContentType.objects.get_for_model(LegalNotice)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=notice.pk)
            serializer = CommentSerializer(
                qs.prefetch_related('votes'), many=True, context={'request': request}
            )
            return Response(serializer.data)
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != notice.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=notice.pk, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
