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
from rest_framework.views import APIView

from notifications.services import label_for_exercise, notify_comment_reply

from .models import Comment, CommentVote, Review, SavedComment
from .serializers import CommentSerializer, SavedCommentSerializer


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
        return Response(CommentSerializer(qs.prefetch_related('votes'), many=True, context={'request': request}).data)

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

    @action(detail=True, methods=['post', 'delete'])
    def vote(self, request, pk=None):
        """POST `{value: 1|-1}` / DELETE — `/api/comments/{id}/vote/`. One row per voter, upserted
        on POST and removed on DELETE, the same shape as every claim vote in `materials`. Open to
        anybody signed in, on anybody's comment — including your own, which the UI does not offer
        but which is not worth a rule here. A comment that is gone (removed or auto-hidden) cannot
        be voted on: 409, nothing about the request was wrong, the comment is simply not there."""
        comment = self.get_object()
        if comment.is_removed or comment.auto_hidden_at is not None:
            return Response(
                {'detail': 'This comment is no longer available.'},
                status=status.HTTP_409_CONFLICT,
            )
        if request.method == 'DELETE':
            CommentVote.objects.filter(comment=comment, voter=request.user).delete()
        else:
            try:
                value = int(request.data.get('value'))
            except (TypeError, ValueError):
                value = None
            if value not in (1, -1):
                return Response(
                    {'value': ['Must be 1 (up) or -1 (down).']}, status=status.HTTP_400_BAD_REQUEST
                )
            CommentVote.objects.update_or_create(
                comment=comment, voter=request.user, defaults={'value': value}
            )
        return Response(CommentSerializer(comment, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def saved(self, request):
        """Everything this caller has kept. Never anybody else's — the queryset is scoped to
        `request.user` rather than filtered by a permission check, so there is no id to guess at."""
        rows = (
            SavedComment.objects.filter(user=request.user)
            .select_related('comment', 'comment__author', 'comment__author__profile')
        )
        return Response(SavedCommentSerializer(rows, many=True, context={'request': request}).data)

    # `url_path` spelled out, not left to the default. DRF derives `url_name` from the method name
    # with underscores turned into hyphens but leaves `url_path` as the name VERBATIM — so the route
    # would be `/save_for_me/` while `reverse('comment-save-for-me')` resolved happily, meaning the
    # tests passed against a URL no client would ever build. Found by a browser run, not by them.
    @action(detail=True, methods=['post', 'delete'], url_path='save-for-me')
    def save_for_me(self, request, pk=None):
        """Keep this comment, or stop keeping it.

        One endpoint answering to two methods rather than a save/unsave pair, because there is one
        row and it either exists or does not — a client holding a stale "saved" flag cannot get the
        two out of step by calling the wrong one.

        Saving is deliberately allowed on any comment the caller can reach, including one whose
        thread is private to a course they are in: this list is theirs alone and publishes nothing.
        What it will not keep is a comment that is already gone — there is no body left to come back
        to, so saving it would bookmark a placeholder.

        Named `save_for_me` because DRF routes an action on its method name and `save` is
        `ModelSerializer`'s own — the URL is `/api/comments/{id}/save-for-me/`.
        """
        comment = self.get_object()
        if request.method == 'DELETE':
            SavedComment.objects.filter(user=request.user, comment=comment).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        if comment.is_removed or comment.auto_hidden_at is not None:
            return Response(
                {'detail': 'This comment is no longer available.'},
                status=status.HTTP_409_CONFLICT,
            )
        note = (request.data.get('note') or '').strip()[:300]
        row, created = SavedComment.objects.get_or_create(
            user=request.user, comment=comment, defaults={'note': note}
        )
        # Saving something already saved is not an error — it is the same statement made twice, and
        # the honest answer is the row that already says it. A later note replaces an earlier one,
        # since the second is what the person just typed.
        if not created and note:
            row.note = note
            row.save(update_fields=['note'])
        return Response(
            SavedCommentSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


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


class SiteActivityView(APIView):
    """GET /api/activity/ — the homepage Activity tab's feed: the newest public actions across the
    platform, merged newest-first. Deliberately near-placeholder (an explicit owner decision,
    2026-08-27, alongside the solution-pool feature: "make it almost as simple as placeholder — we
    will improve it later"): three sources — newly published exercises, materials, and
    solution/hint entries — derived on read like the per-user activity feed
    (accounts/profile_extras.py's UserActivityView), never stored. Public content only; nothing
    here needs or reads authentication.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from exercises.models import Exercise, SolutionEntry
        from materials.models import Material
        from notifications.services import label_for_exercise, label_for_material

        def display_name(user):
            if user is None:
                return ''
            profile = getattr(user, 'profile', None)
            return profile.display_name if profile and profile.display_name else user.username

        items = []
        for exercise in (
            Exercise.objects.filter(published=True)
            .select_related('submitted_by__profile')
            .prefetch_related('translations')
            .order_by('-created_at')[:15]
        ):
            items.append(
                {
                    'kind': 'exercise',
                    'title': label_for_exercise(exercise),
                    'exercise_id': exercise.pk,
                    'actor_display_name': display_name(exercise.submitted_by),
                    'created_at': exercise.created_at.isoformat(),
                }
            )
        for material in (
            Material.objects.filter(published=True)
            .select_related('submitted_by__profile')
            .prefetch_related('translations')
            .order_by('-created_at')[:15]
        ):
            items.append(
                {
                    'kind': 'material',
                    'title': label_for_material(material),
                    'material_id': material.pk,
                    'actor_display_name': display_name(material.submitted_by),
                    'created_at': material.created_at.isoformat(),
                }
            )
        for entry in (
            # `author__isnull=False`: the migrated corpus originals all carry the migration's own
            # timestamp and no author — "somebody added a solution" is only true of authored rows.
            SolutionEntry.objects.filter(
                status='published', is_removed=False, auto_hidden_at__isnull=True,
                exercise__published=True, author__isnull=False,
            )
            .select_related('exercise', 'author__profile')
            .order_by('-created_at')[:15]
        ):
            items.append(
                {
                    'kind': 'solution_entry',
                    'entry_kind': entry.kind,
                    'title': label_for_exercise(entry.exercise),
                    'exercise_id': entry.exercise_id,
                    'actor_display_name': display_name(entry.author),
                    'created_at': entry.created_at.isoformat(),
                }
            )
        items.sort(key=lambda i: i['created_at'], reverse=True)
        return Response(items[:20])
