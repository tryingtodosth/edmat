"""Replying to a review, and an author's own edit/delete of their comment.

Both are the same generic `Comment` every other discussion in this app already uses — a reply to a
review is not a new kind of object, it is a Comment whose GenericForeignKey target happens to be a
Review. That is what makes the thread builder, the reply nesting, the report flow, the auto-hide
rule and the whole frontend `DiscussionThread` come for free here.
"""

from django.contrib.contenttypes.models import ContentType
from django.http import Http404
from django.db.models import Count
from django.core.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser

from accounts.minors import hold_for_review, is_minor
from config.audience import MINOR_AUDIENCES

from .attachments import MAX_ATTACHMENTS_PER_COMMENT, attachment_upload_path, process_attachment, used_upload_bytes
from .revisions import apply_comment_edit, hide_revision, seal_revision
from .serializers import CommentAttachmentSerializer, CommentRevisionSerializer, InlineImageSerializer
from .models import CommentAttachment, InlineImage
from .inline_images import process_inline_image, inline_image_upload_path, MAX_ALT_LENGTH
from rest_framework import permissions, status, viewsets
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.services import label_for_exercise, notify_comment_reply

from .models import Comment, CommentRevision, CommentVote, Review, SavedComment
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
        blocks = None
        if request.data.get('blocks'):
            from .serializers import clean_comment_blocks
            from rest_framework.exceptions import ValidationError as DRFValidationError

            try:
                blocks = clean_comment_blocks(request.data.get('blocks'))
            except DRFValidationError as exc:
                return Response({'blocks': exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        if not body and not blocks:
            return Response(
                {'body': ['This field may not be blank.']}, status=status.HTTP_400_BAD_REQUEST
            )
        # Snapshots the PRE-edit body as a CommentRevision before overwriting — see revisions.py.
        # Stamps `edited_at`, surfaced as `is_edited` — see the model field's own note on why an
        # untraceable edit is the thing being avoided here. A notebook's body is derived in save().
        apply_comment_edit(comment, body, blocks=blocks, edited_by=request.user)
        return Response(CommentSerializer(comment, context={'request': request}).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def revisions(self, request, pk=None):
        """GET /api/comments/{id}/revisions/ — every past version of this comment's body, oldest
        first, masked per `CommentRevisionSerializer`. Open to anybody who can read the comment
        itself (history is a narrower question of past states than the tombstone question of
        whether the CURRENT body shows — deleting a comment must not also erase the trail of what
        it used to say, or the tombstone would undercut the very feature meant to catch that).
        Overrides the viewset's own `IsAuthenticated` default, which exists for the author-only
        edit/delete actions, not for reading history."""
        comment = self.get_object()
        qs = comment.revisions.select_related(
            'edited_by__profile', 'hidden_by_moderator', 'sealed_by'
        )
        return Response(CommentRevisionSerializer(qs, many=True, context={'request': request}).data)

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
    @action(detail=True, methods=['post'], url_path='attachments', parser_classes=[MultiPartParser, FormParser])
    def attachments(self, request, pk=None):
        """Add one picture or PDF to your own comment — at most three, within your upload
        allowance. A picture landing on a thread for a minor band, or on a minor's own comment,
        holds the comment for a moderator (accounts/minors.py)."""
        comment = self.get_object()
        if comment.author_id != request.user.pk:
            return Response(status=status.HTTP_403_FORBIDDEN)
        if comment.is_removed:
            return Response({'detail': 'removed'}, status=status.HTTP_409_CONFLICT)
        if comment.attachments.count() >= MAX_ATTACHMENTS_PER_COMMENT:
            return Response({'detail': 'too_many'}, status=status.HTTP_409_CONFLICT)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': ['A file is required.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            kind, content, name, size = process_attachment(upload)
        except ValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'file': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        quota = request.user.profile.material_upload_quota_bytes
        used = used_upload_bytes(request.user)
        if quota and used + size > quota:
            return Response({'detail': 'quota'}, status=status.HTTP_409_CONFLICT)
        row = CommentAttachment(comment=comment, kind=kind, original_name=name, size_bytes=size, order=comment.attachments.count())
        row.file.save(attachment_upload_path(row, name), content, save=True)
        target_audience = getattr(comment.target, 'audience', None)
        if kind == 'image' and (is_minor(request.user) or target_audience in MINOR_AUDIENCES):
            hold_for_review(comment, request.user)
        return Response(CommentAttachmentSerializer(row, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path='attachments/(?P<attachment_id>[^/.]+)')
    def attachment_delete(self, request, pk=None, attachment_id=None):
        comment = self.get_object()
        if not (comment.author_id == request.user.pk or request.user.is_staff):
            return Response(status=status.HTTP_403_FORBIDDEN)
        row = comment.attachments.filter(pk=attachment_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        row.file.delete(save=False)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

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


class CommentRevisionViewSet(viewsets.GenericViewSet):
    """The two moderation-adjacent actions on a single past version of a comment. No list/retrieve
    of its own — a revision is always read as part of `CommentViewSet.revisions`, which is also
    where its masking actually happens; this only ever WRITES the two hide flags.

    `select_related` on every FK `CommentRevisionSerializer` touches, so listing/serializing a
    revision after either action never pays a per-row N+1.
    """

    queryset = CommentRevision.objects.select_related(
        'comment', 'edited_by__profile', 'hidden_by_moderator', 'sealed_by'
    )
    serializer_class = CommentRevisionSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=True, methods=['post'])
    def hide(self, request, pk=None):
        """Staff only. Hides this one past version from ordinary readers — the "a slur, but the
        rest of the comment has positive impact" case. One-way; see revisions.py."""
        if not request.user.is_staff:
            return Response(status=status.HTTP_403_FORBIDDEN)
        revision = self.get_object()
        if revision.sealed_at is not None:
            # Nothing to do — sealing is already the stricter tier, and a hide action here would
            # read as though it were the one that locked this down.
            return Response(status=status.HTTP_409_CONFLICT)
        note = (request.data.get('note') or '').strip()
        revision = hide_revision(revision, moderator=request.user, note=note)
        return Response(CommentRevisionSerializer(revision, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def seal(self, request, pk=None):
        """Superuser only. Locks this one past version away from every API response, permanently
        — the compromised-account/illegal-content case. The body is never deleted; see
        CommentRevision's own docstring for the only two ways it can still be read afterward."""
        if not request.user.is_superuser:
            return Response(status=status.HTTP_403_FORBIDDEN)
        revision = self.get_object()
        note = (request.data.get('note') or '').strip()
        revision = seal_revision(revision, sealed_by=request.user, note=note)
        return Response(CommentRevisionSerializer(revision, context={'request': request}).data)


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


class InlineImageViewSet(viewsets.GenericViewSet):
    """`/api/inline-images/` — a picture that goes INTO the body somebody is writing, rather than
    into a row beneath it (community/inline_images.py says why).

    Shaped like `/api/chem-drawings/`, which solved the same problem first:

    - POST, signed in, throttled, multipart. The response carries the `<img>` to insert.
      Throttled on its own scope because a re-encode is real CPU, and this endpoint accepts bytes
      from anybody with an account.
    - GET by id is public: the picture ends up inside public content, so the row behind it is not
      a secret. (The *list* of what somebody has uploaded is not offered — how much a person has
      drafted is not a public fact, and nothing needs it.)
    - No PUT and no DELETE. A picture inside a published comment must keep resolving; a person who
      wants a different picture inserts a different picture, and one who wants it gone edits the
      comment. The row stays either way, because who uploaded what is part of the trust model
      (house rule 12).

    The upload happens while the comment is still being written, so a picture that is inserted and
    then never posted leaves a row nothing references — exactly as an abandoned chemistry drawing
    already does. It counts against the uploader's storage allowance, which is what stops that
    being a lever; a sweep for unreferenced rows is left open rather than guessed at.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'inline_image'
    serializer_class = InlineImageSerializer
    queryset = InlineImage.objects.select_related('author')
    parser_classes = [MultiPartParser, FormParser]

    def get_throttles(self):
        return super().get_throttles() if self.action == 'create' else []

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.action == 'create' else [permissions.AllowAny()]

    def retrieve(self, request, pk=None):
        row = self.get_object()
        return Response(InlineImageSerializer(row, context={'request': request}).data)

    def create(self, request):
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': ['A file is required.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            content, width, height, name, size = process_inline_image(upload)
        except ValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'file': e.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )
        quota = request.user.profile.material_upload_quota_bytes
        if quota and used_upload_bytes(request.user) + size > quota:
            return Response({'detail': 'quota'}, status=status.HTTP_409_CONFLICT)
        row = InlineImage(
            author=request.user,
            alt=(request.data.get('alt') or '')[:MAX_ALT_LENGTH],
            width=width,
            height=height,
            original_name=name,
            size_bytes=size,
        )
        row.image.save(inline_image_upload_path(row, name), content, save=True)
        return Response(
            InlineImageSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


# --- discussions under the standing pages -------------------------------------------------------
#
# `community/discussions.py` is the rule module and every decision is argued there. These three
# endpoints only ever ASK it (root CLAUDE.md boundary 2), which is why the policy appears in three
# places — the reader's page, the thread itself and the moderator's list — without three chances to
# disagree about it.


class _DiscussionThrottle(ScopedRateThrottle):
    scope = 'about_discussion'


def _location_for(page: str, section: str, *, create: bool):
    """The row for this location, or None.

    `create=False` for every read: a reader opening a thread must not write a row, or a crawler
    would populate the moderation list with every page it walked. The row appears when somebody
    actually writes (`create=True` on POST, and only once that POST has passed every check that
    could refuse it) or when a moderator configures it. `manage.py sweep_discussion_locations`
    clears up the rows that predate that rule, and the well-formed junk keys `PAGE_RE` allows.
    """
    from .models import DiscussionLocation

    if create:
        row, _ = DiscussionLocation.objects.get_or_create(page=page, section=section)
        return row
    return DiscussionLocation.objects.filter(page=page, section=section).first()


def _policy_payload(
    request, page: str, section: str, rows: dict | None = None, flag_enabled=None
) -> dict:
    """The effective policy plus what it means FOR THIS READER.

    `can_post` and `post_block_reason` are both here on purpose (house rule 6): the frontend draws
    a different line for "sign in to reply", "verified contributors only" and "a moderator has
    closed this", and a boolean would make all three the same greyed-out box. `held_for_you` is the
    fourth thing it has to say, and it is not a refusal — somebody allowed to write deserves to
    know before they write that what they write will wait.
    """
    from . import discussions

    policy = discussions.effective_policy(page, section, rows=rows, flag_enabled=flag_enabled)
    reason = discussions.post_block_reason(request.user, policy)
    return {
        **policy,
        'can_post': reason is None,
        'post_block_reason': reason,
        'held_for_you': reason is None and discussions.held_for(request.user, policy),
    }


class DiscussionPolicyView(APIView):
    """`GET /api/discussions/?page=<page>&sections=a,b,c` — one request per PAGE, not per section.

    A manual chapter has up to a dozen sections, and a page that asked per section would fire a
    dozen requests before a reader had clicked anything. So the frontend sends the sections it
    draws and gets one answer per section, plus the page's own.

    `AllowAny`, and it stays answerable when the flag is off: it then reports `is_enabled: false`
    for every section, which is what lets the page draw NO affordance rather than one that fails on
    click (house rule 3).

    The counts are included because the affordance says "3 comments" before anybody opens it — a
    collapsed thread with no count looks like a button that does nothing.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from . import discussions
        from .models import DiscussionLocation

        if 'keys' in request.query_params:
            return self._many(request)

        page = (request.query_params.get('page') or '').strip()
        try:
            discussions.parse_key(page)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if discussions.management_kind(page) and not discussions.can_read_location(
            request.user, page
        ):
            # The same answer `/api/tasks/17/` gives this reader (house rule 4): a thread on a row
            # they may not see does not exist for them, and neither does the row.
            raise Http404

        raw = (request.query_params.get('sections') or '').strip()
        sections = []
        for candidate in raw.split(','):
            candidate = candidate.strip()
            if not candidate:
                continue
            if not discussions.SECTION_RE.match(candidate) or discussions.management_kind(page):
                # A management row and an organisation's page have one thread and no sections
                # (`discussions.parse_key`).
                return Response({'detail': 'section'}, status=status.HTTP_400_BAD_REQUEST)
            if candidate not in sections:
                sections.append(candidate)

        # One query for every row on this page, rather than one per section inside
        # `effective_policy` — which is the N+1 this endpoint exists to avoid.
        rows = {row.section: row for row in DiscussionLocation.objects.filter(page=page)}
        content_type = ContentType.objects.get_for_model(DiscussionLocation)
        counts = dict(
            Comment.objects.filter(
                content_type=content_type,
                object_id__in=[row.pk for row in rows.values()],
                is_removed=False,
                auto_hidden_at__isnull=True,
            )
            .values_list('object_id')
            .annotate(n=Count('id'))
        )

        payload = []
        for section in [''] + sections:
            entry = _policy_payload(request, page, section)
            row = rows.get(section)
            entry['comment_count'] = counts.get(row.pk, 0) if row is not None else 0
            payload.append(entry)
        return Response({'page': page, 'locations': payload})


    #: How many keys one `?keys=` read may ask about. A board is bounded by construction — the
    #: project's own has fewer than fifty rows across its four panels — and a client asking for
    #: more than this is not drawing a page.
    MAX_KEYS = 200

    def _many(self, request):
        """`GET /api/discussions/?keys=tasks/17,plans/3,needs/2` — one request per PANEL.

        The management rows' counterpart of the `page=…&sections=…` form: a board draws dozens of
        rows and each is its own page here, so the frontend sends the keys it is drawing and gets
        one policy per key. A key the reader may not open (a row on a node they cannot see, or a
        row that is gone) is simply absent from the answer — the queryset-filter shape of house
        rule 4, which is the right one for a list; the single-key reads above answer 404.
        """
        from . import discussions
        from .models import DiscussionLocation

        raw = (request.query_params.get('keys') or '').strip()
        keys = []
        for candidate in raw.split(','):
            candidate = candidate.strip()
            if not candidate:
                continue
            try:
                page, section = discussions.parse_key(candidate)
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            key = discussions.location_key(page, section)
            if key not in keys:
                keys.append(key)
        if len(keys) > self.MAX_KEYS:
            return Response({'detail': 'too_many_keys'}, status=status.HTTP_400_BAD_REQUEST)

        pairs = [discussions.parse_key(key) for key in keys]
        pages = sorted({page for page, _section in pairs})
        readable = discussions.readable_pages(request.user, pages)
        flag_enabled = discussions.memoised_flags()

        # One query for every row on every page asked about, one for the counts — not one per key
        # inside `effective_policy`, which is the N+1 this form exists to avoid.
        rows_by_page: dict[str, dict] = {}
        for row in DiscussionLocation.objects.filter(page__in=pages):
            rows_by_page.setdefault(row.page, {})[row.section] = row
        content_type = ContentType.objects.get_for_model(DiscussionLocation)
        counts = dict(
            Comment.objects.filter(
                content_type=content_type,
                object_id__in=[
                    row.pk for rows in rows_by_page.values() for row in rows.values()
                ],
                is_removed=False,
                auto_hidden_at__isnull=True,
            )
            .values_list('object_id')
            .annotate(n=Count('id'))
        )

        payload = []
        for page, section in pairs:
            if page not in readable:
                continue
            rows = rows_by_page.get(page, {})
            entry = _policy_payload(request, page, section, rows=rows, flag_enabled=flag_enabled)
            row = rows.get(section)
            entry['comment_count'] = counts.get(row.pk, 0) if row is not None else 0
            payload.append(entry)
        return Response({'locations': payload})


class DiscussionThreadView(APIView):
    """`GET|POST /api/discussions/thread/` — the comments at one location, read on click.

    Lazy by design, because that is what the owner asked for ("available/drawn on click") and
    because it is also the cheap shape: a manual chapter with twelve collapsed threads loads none
    of them until a reader opens one.

    **GET is open where the location is open, and refuses nothing.** A thread on a location whose
    audience is `staff` is still READABLE by anybody — the audience governs who may *write*. That
    is the same split every other standing page already has: the prose is public, and so is the
    talk about it. A location switched off, or the whole flag off, answers with an empty thread and
    `is_enabled: false` rather than 404, because the page it belongs to very much does exist.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [_DiscussionThrottle]

    def _resolve(self, request, data):
        from . import discussions

        page = (data.get('page') or '').strip()
        section = (data.get('section') or '').strip()
        try:
            parsed_page, parsed_section = discussions.parse_key(
                discussions.location_key(page, section)
            )
        except ValueError as exc:
            return None, None, Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if discussions.management_kind(parsed_page) and not discussions.can_read_location(
            request.user, parsed_page
        ):
            # Read AND write: a stranger must not learn from a 403 that the row exists, and a
            # row that is gone has no thread to write into. The answer its own endpoint gives.
            raise Http404
        return parsed_page, parsed_section, None

    def get_throttles(self):
        # A read is not what the per-IP bound is for; throttling it would break an ordinary reader
        # opening several threads on one chapter. The write is the only expensive act here.
        if self.request.method == 'GET':
            return []
        return super().get_throttles()

    def get(self, request):
        from . import discussions
        from .models import DiscussionLocation

        page, section, error = self._resolve(request, request.query_params)
        if error is not None:
            return error

        payload = _policy_payload(request, page, section)
        row = _location_for(page, section, create=False)
        comments = []
        if row is not None and payload['is_enabled']:
            content_type = ContentType.objects.get_for_model(DiscussionLocation)
            qs = Comment.objects.filter(content_type=content_type, object_id=row.pk)
            visible = discussions.visible_comments(request.user, qs)
            comments = CommentSerializer(
                visible.prefetch_related('votes'), many=True, context={'request': request}
            ).data
        return Response({**payload, 'comments': comments})

    def post(self, request):
        from . import discussions
        from .models import DiscussionLocation
        from .serializers import DiscussionCommentDraftSerializer

        page, section, error = self._resolve(request, request.data)
        if error is not None:
            return error

        policy = discussions.effective_policy(page, section)
        reason = discussions.post_block_reason(request.user, policy)
        if reason is not None:
            # The word, not a bare status — the frontend has a line for each (house rule 6). 403 for
            # all of them rather than 401 for `anonymous`: the request was understood and refused,
            # and a 401 would invite a client to retry with credentials it may not have.
            return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)

        draft = DiscussionCommentDraftSerializer(data=request.data)
        draft.is_valid(raise_exception=True)

        content_type = ContentType.objects.get_for_model(DiscussionLocation)
        # Resolved WITHOUT creating. The row used to be created here, one line above the parent
        # check that needs it — so a reply naming a comment in another thread was refused 400 and
        # still left a `DiscussionLocation` behind, which a moderator then found in the list with
        # no comments under it. A write creates a row only when it succeeds
        # (`discussions.py`, "A row is created by a write that SUCCEEDS"). An absent row is not a
        # special case: there is nothing here yet, so no parent can belong to it.
        row = _location_for(page, section, create=False)

        parent = draft.validated_data.get('parent')
        if parent is not None and (
            row is None
            or parent.content_type_id != content_type.id
            or parent.object_id != row.pk
        ):
            # The check community/CLAUDE.md says every new comment surface must repeat: without it
            # a client can name a comment in an unrelated thread and have its reply attach there.
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Nothing left can refuse this write, so the location may exist now.
        if row is None:
            row = _location_for(page, section, create=True)

        authenticated = bool(request.user and request.user.is_authenticated)
        comment = Comment(
            content_type=content_type,
            object_id=row.pk,
            parent=parent,
            author=request.user if authenticated else None,
            body=draft.validated_data['body'],
        )
        if not authenticated:
            # Read only for a writer with no account — see the draft serializer's own note.
            comment.anon_name = (draft.validated_data.get('anon_name') or '').strip()
            comment.anon_ip_hash = discussions.ip_hash(request)
        comment.save()

        # `community/signals.py` has already held this if its author is a minor. An anonymous
        # comment is held here, because the signal cannot see the policy — and `hold_for_review` is
        # idempotent (it returns False when `auto_hidden_at` is already set), so the two never
        # fight over the same row.
        if discussions.held_for(request.user, policy):
            hold_for_review(comment, comment.author)

        return Response(
            {
                **CommentSerializer(comment, context={'request': request}).data,
                # Said back explicitly rather than left for the client to infer from a blanked
                # body: somebody who just wrote something and sees it empty deserves the sentence
                # that explains why (house rule 10).
                'is_held': comment.auto_hidden_at is not None,
            },
            status=status.HTTP_201_CREATED,
        )


class DiscussionLocationViewSet(viewsets.ModelViewSet):
    """`/api/discussion-locations/` — the moderator's list and the switches on it.

    Staff only, reads included: this is not a surface an ordinary reader has any question about,
    and the list says which locations are carrying held comments, which is moderation information.

    No `destroy`: deleting a location row would silently return it to the module defaults while its
    comments stayed attached to a row that no longer exists. Switching `is_enabled` off is the
    honest way to close a location, and it keeps the record of who closed it (house rule 12).
    """

    from .models import DiscussionLocation as _Model
    from .serializers import DiscussionLocationSerializer as _Serializer

    queryset = _Model.objects.select_related('updated_by__profile').all()
    serializer_class = _Serializer
    permission_classes = [permissions.IsAdminUser]
    http_method_names = ['get', 'post', 'patch', 'put', 'head', 'options']

    def perform_create(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
