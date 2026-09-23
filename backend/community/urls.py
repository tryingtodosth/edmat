from django.urls import include, path
from config.routers import NumericPkRouter

from .views import CommentRevisionViewSet, CommentViewSet, InlineImageViewSet, ReviewViewSet

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

urlpatterns = [path('', include(router.urls))]
