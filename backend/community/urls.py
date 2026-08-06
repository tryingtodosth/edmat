from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CommentViewSet, ReviewViewSet

router = DefaultRouter()
# `/api/reviews/{id}/comments/` — the thread under one exercise review. Addressed by the review's
# own id rather than nested under the exercise, because a reply belongs to the review, not to the
# exercise it happens to be about.
router.register('reviews', ReviewViewSet, basename='review')
# `/api/comments/{id}/` — PATCH and DELETE only, by the comment's author. Reading a comment still
# happens through the thread it belongs to, so this router entry deliberately exposes no list.
router.register('comments', CommentViewSet, basename='comment')

urlpatterns = [path('', include(router.urls))]
