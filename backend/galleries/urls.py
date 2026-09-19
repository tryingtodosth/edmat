from rest_framework.routers import DefaultRouter

from .views import GalleryImageViewSet, GalleryViewSet

router = DefaultRouter()
router.register('galleries', GalleryViewSet, basename='gallery')
router.register('gallery-images', GalleryImageViewSet, basename='gallery-image')

urlpatterns = router.urls
