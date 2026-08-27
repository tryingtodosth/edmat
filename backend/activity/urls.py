from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FeedView, PostViewSet

router = DefaultRouter()
router.register('posts', PostViewSet, basename='post')

urlpatterns = [
    # The homepage/`/activity` feed — took over the URL community's placeholder SiteActivityView
    # held (root CLAUDE.md §17AH), now reading the stored ActivityEvent table.
    path('activity/', FeedView.as_view(), name='activity-feed'),
    path('', include(router.urls)),
]
