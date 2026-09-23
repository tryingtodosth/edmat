from config.routers import NumericPkRouter

from .views import GalleryImageViewSet, GalleryViewSet

router = NumericPkRouter()
router.register('galleries', GalleryViewSet, basename='gallery')
router.register('gallery-images', GalleryImageViewSet, basename='gallery-image')

urlpatterns = router.urls
