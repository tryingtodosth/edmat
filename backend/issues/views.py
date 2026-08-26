from django.contrib.contenttypes.models import ContentType
from django.db.models import Count
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.permissions import feature_gate

from .models import Issue
from .serializers import IssueCreateSerializer, IssueSerializer, IssueStaffUpdateSerializer
from .services import notify_status_change

_IssuesFeatureGate = feature_gate('issues')


def _is_staff(user) -> bool:
    return bool(user and user.is_authenticated and user.is_staff)


class IssueViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """`/api/issues/`.

    - POST is open to anyone, guests included, behind its own throttle scope: a report form that
      needs an account is a report form most problems never reach.
    - GET lists what the reporter allowed to be published; staff additionally see everything
      (`?all=1`), which is their queue. A private issue is a 404 to anybody else — for them it
      does not exist, and saying "there is something here you may not see" would already say more
      than the reporter allowed.
    - PATCH is staff only (status, note, un-publishing). There is no edit path for the reporter's
      own words, and no DELETE: a filed report is a record.
    """

    permission_classes = [_IssuesFeatureGate]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'issue_report'

    def get_throttles(self):
        # Only filing is throttled by the tight scope; reading falls back to the global rates.
        if self.action != 'create':
            return []
        return super().get_throttles()

    def get_queryset(self):
        qs = Issue.objects.select_related('reporter__profile')
        user = self.request.user
        if _is_staff(user) and (
            self.action != 'list' or self.request.query_params.get('all') in ('1', 'true')
        ):
            return qs
        return qs.filter(is_public=True)

    def filter_queryset(self, queryset):
        if self.action != 'list':
            return queryset
        params = self.request.query_params
        status_filter = params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        kind = params.get('kind')
        if kind:
            queryset = queryset.filter(kind=kind)
        return queryset

    def get_serializer_class(self):
        if self.action == 'create':
            return IssueCreateSerializer
        if self.action in ('update', 'partial_update'):
            return IssueStaffUpdateSerializer
        return IssueSerializer

    def _with_comment_counts(self, issues):
        """One query for the whole page rather than a Count join that would multiply rows."""
        ct = ContentType.objects.get_for_model(Issue)
        ids = [i.pk for i in issues]
        counts = dict(
            Comment.objects.filter(content_type=ct, object_id__in=ids, is_removed=False)
            .values_list('object_id')
            .annotate(n=Count('id'))
            .values_list('object_id', 'n')
        )
        for issue in issues:
            issue.comment_count = counts.get(issue.pk, 0)
        return issues

    def list(self, request, *args, **kwargs):
        issues = list(self.filter_queryset(self.get_queryset()))
        serializer = IssueSerializer(
            self._with_comment_counts(issues), many=True, context={'request': request}
        )
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        issue = self.get_object()
        self._with_comment_counts([issue])
        return Response(IssueSerializer(issue, context={'request': request}).data)

    def create(self, request, *args, **kwargs):
        serializer = IssueCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        issue = serializer.save()
        issue.comment_count = 0
        return Response(
            IssueSerializer(issue, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        if not _is_staff(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        issue = self.get_object()
        serializer = IssueStaffUpdateSerializer(issue, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        status_before = issue.status
        serializer.save(status_changed_by=request.user)
        if issue.status != status_before:
            notify_status_change(issue, actor=request.user)
        self._with_comment_counts([issue])
        return Response(IssueSerializer(issue, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """The discussion under a published issue — the same generic Comment every other thread in
        this app uses, so the tree, votes, edit and report flows come for free. Reading follows the
        issue's own visibility (a private issue's thread is staff-only by construction, since
        `get_object` already refuses everybody else); posting needs an account."""
        issue = self.get_object()
        content_type = ContentType.objects.get_for_model(Issue)
        if request.method == 'GET':
            qs = Comment.objects.filter(content_type=content_type, object_id=issue.pk)
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
            parent.content_type_id != content_type.id or parent.object_id != issue.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=issue.pk, author=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
