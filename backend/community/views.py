"""Replying to a review, and an author's own edit/delete of their comment.

Both are the same generic `Comment` every other discussion in this app already uses — a reply to a
review is not a new kind of object, it is a Comment whose GenericForeignKey target happens to be a
Review. That is what makes the thread builder, the reply nesting, the report flow, the auto-hide
rule and the whole frontend `DiscussionThread` come for free here.
"""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from notifications.services import label_for_exercise, notify_comment_reply

from .models import Comment, Review
from .serializers import CommentSerializer


def comment_thread_response(request, target, *, on_created=None):
    """GET returns the thread hanging off `target`; POST appends to it.

    One implementation of a shape this codebase had written out five separate times (an Exercise's
    thread, a Material's, a MaterialCoverage claim's, a Service's, a Course's) before there was a
    sixth, seventh and eighth to write. Those five predate this helper and are deliberately left
    alone — they work and are covered by tests, and rewriting them mid-feature would put regression
    risk on endpoints nobody asked me to touch. New targets go through here.

    The `parent` check is the load-bearing part rather than boilerplate: `CommentSerializer` leaves
    `parent` writable so replies can thread, and without this a client could name a comment
    belonging to an entirely different thread — or a different content type's thread — and have its
    reply silently attach there. It lives here rather than in the serializer's `validate()` because
    `content_type`/`object_id` are never part of the submitted data; this function supplies them.
    """
    content_type = ContentType.objects.get_for_model(target)

    if request.method == 'GET':
        qs = Comment.objects.filter(content_type=content_type, object_id=target.pk)
        return Response(CommentSerializer(qs, many=True).data)

    if not request.user.is_authenticated:
        return Response(status=status.HTTP_401_UNAUTHORIZED)

    serializer = CommentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    parent = serializer.validated_data.get('parent')
    if parent is not None and (
        parent.content_type_id != content_type.id or parent.object_id != target.pk
    ):
        return Response(
            {'parent': ['This reply must belong to the same discussion.']},
            status=status.HTTP_400_BAD_REQUEST,
        )
    serializer.save(content_type=content_type, object_id=target.pk, author=request.user)
    if on_created is not None:
        on_created(serializer.instance)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


def reply_counts_for(reviews) -> dict[int, int]:
    """{review pk: how many comments hang off it}, in one query for the whole page.

    A count has to be on the review itself or the conversation under it is invisible until somebody
    clicks something that looks like it does nothing. Done in bulk rather than as a per-row count
    because a review list is exactly the shape that turns into an N+1 otherwise — the same mistake
    the moderation queue was measured making (CLAUDE.md 17F), cheaper to avoid than to find later.
    """
    reviews = list(reviews)
    if not reviews:
        return {}
    content_type = ContentType.objects.get_for_model(reviews[0])
    rows = (
        Comment.objects.filter(
            content_type=content_type, object_id__in=[r.pk for r in reviews]
        )
        .values('object_id')
        .annotate(total=Count('id'))
    )
    return {row['object_id']: row['total'] for row in rows}


def notify_review_reply(comment, review, *, label: str, exercise=None, material=None):
    """Tell whoever should hear about a new comment under a review.

    A review thread is the one place where the existing `notify_comment_reply` is not enough on its
    own: it notifies the parent COMMENT's author, and a top-level reply to a review has no parent
    comment — so without `root_recipient` the person actually being replied to, the reviewer, would
    never be told. Nested replies keep going to the person being answered, exactly as everywhere
    else. `notify()`'s own actor==recipient guard means replying to your own review is silent.
    """
    return notify_comment_reply(
        comment,
        target_label=label,
        exercise=exercise,
        material=material,
        root_recipient=review.author,
    )


class CommentViewSet(viewsets.GenericViewSet):
    """No list or retrieve of its own — a comment is always read as part of the thread it belongs
    to, through whichever target owns that thread. This exists for the two things the author of a
    comment can do to it afterwards, which had no endpoint at all before: change what it says, and
    take it down.

    Both are **author-only**. A moderator taking something down is a genuinely different act with a
    different record behind it (a Report, a decision, a note) and already has its own path through
    `ReportActionView` — quietly adding a second, unrecorded way for staff to delete other people's
    comments here would make that record incomplete rather than make moderation easier.

    A wrong-author request gets 403, not 404: the comment is public, so pretending it does not exist
    is a lie the caller can disprove by reading the thread it is sitting in. Same reasoning
    `BookingViewSet` already records for the wrong party.
    """

    queryset = Comment.objects.all()
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _own_or_refusal(self, comment):
        """Returns a Response to send back, or None when the caller may proceed."""
        if comment.author_id != self.request.user.pk:
            return Response(
                {'detail': 'You can only change your own comment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if comment.is_removed or comment.auto_hidden_at is not None:
            # 409 rather than 403: nothing is wrong with who is asking, the comment simply is not
            # there to change any more — the same "the world moved" distinction the moderation
            # actions already draw.
            return Response(
                {'detail': 'This comment is no longer available.'},
                status=status.HTTP_409_CONFLICT,
            )
        return None

    def partial_update(self, request, pk=None):
        comment = self.get_object()
        refusal = self._own_or_refusal(comment)
        if refusal is not None:
            return refusal
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response(
                {'body': ['This field may not be blank.']}, status=status.HTTP_400_BAD_REQUEST
            )
        comment.body = body
        # Stamped on every successful edit, and surfaced as `is_edited` — see the model field's own
        # note on why an untraceable edit is the thing being avoided here.
        comment.edited_at = timezone.now()
        comment.save(update_fields=['body', 'edited_at'])
        return Response(CommentSerializer(comment).data)

    def destroy(self, request, pk=None):
        comment = self.get_object()
        refusal = self._own_or_refusal(comment)
        if refusal is not None:
            return refusal
        # A tombstone, never a row delete, even when this comment has no replies today. Two real
        # things point at it: replies (which would lose their place in the tree) and any Report
        # already filed against it (whose GenericForeignKey would dangle, and whose row in the
        # moderation queue would then resolve to nothing). Keeping one rule for both cases means
        # neither has to be checked for.
        comment.is_removed = True
        comment.removed_by_author = True
        comment.save(update_fields=['is_removed', 'removed_by_author'])
        return Response(CommentSerializer(comment).data)


class ReviewViewSet(viewsets.GenericViewSet):
    """Hosts the one thing a Review is a target for. A review itself is still written and read
    through `ExerciseViewSet.reviews` (one per person per exercise, upserted on resubmit) — this
    adds no second way to do that, only somewhere for the conversation under it to live.

    Reviews that a moderator removed or the community auto-hid are excluded, matching
    `ExerciseViewSet.reviews`'s own queryset: a hidden review is not shown, so a thread hanging off
    one should not be reachable either.
    """

    queryset = Review.objects.filter(is_removed=False, auto_hidden_at__isnull=True)
    serializer_class = CommentSerializer
    permission_classes = [permissions.AllowAny]

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        review = self.get_object()
        return comment_thread_response(
            request,
            review,
            on_created=lambda comment: notify_review_reply(
                comment,
                review,
                # The exercise the review is of is the page this conversation is actually on, so
                # the notification gets a real link rather than an unclickable label, and the same
                # per-locale-resolved title every other notification about that exercise carries.
                label=label_for_exercise(review.exercise),
                exercise=review.exercise,
            ),
        )
