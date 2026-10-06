from django.urls import include, path
from config.routers import NumericPkRouter

from .views import (
    CommentRevisionViewSet,
    CommentViewSet,
    DiscussionLocationViewSet,
    DiscussionPolicyView,
    DiscussionThreadView,
    InlineImageViewSet,
    ReviewViewSet,
)

router = NumericPkRouter()
# `/api/reviews/{id}/comments/` — the thread under one exercise review. Addressed by the review's
# own id rather than nested under the exercise, because a reply belongs to the review, not to the
# exercise it happens to be about.
router.register('reviews', ReviewViewSet, basename='review')
# `/api/comments/{id}/` — PATCH and DELETE only, by the comment's author. Reading a comment still
# happens through the thread it belongs to, so this router entry deliberately exposes no list.
router.register('comments', CommentViewSet, basename='comment')
# `/api/comment-revisions/{id}/hide|seal/` — moderator/superuser-only actions on one past version
# of a comment. No list/retrieve of its own; a revision is always read via
# `/api/comments/{id}/revisions/`.
router.register('comment-revisions', CommentRevisionViewSet, basename='comment-revision')
# `/api/inline-images/` — POST a picture, get back the `<img>` to put in the body. A picture that
# belongs in the middle of a sentence, not in the attachment row beneath it (inline_images.py).
router.register('inline-images', InlineImageViewSet, basename='inline-image')
# `/api/discussion-locations/` — the moderator's switches for the standing pages' discussions
# (`community/discussions.py`). Staff only, reads included, and no DELETE: closing a location is
# `is_enabled=false`, which keeps the record of who closed it.
router.register('discussion-locations', DiscussionLocationViewSet, basename='discussion-location')

urlpatterns = [
    # One request per PAGE for the policies, and the thread itself only when a reader opens it.
    # Not router routes: neither is addressed by a numeric pk, and a location's key contains a
    # `/` and a `#` — which is a URL fragment and can never appear in a path — so both take the
    # page and section as query parameters or in the body.
    path('discussions/', DiscussionPolicyView.as_view(), name='discussion-policies'),
    path('discussions/thread/', DiscussionThreadView.as_view(), name='discussion-thread'),
    path('', include(router.urls)),
]
