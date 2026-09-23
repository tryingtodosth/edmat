from config.routers import NumericPkRouter

from .views import MessageViewSet

router = NumericPkRouter()
router.register('messages', MessageViewSet, basename='message')

urlpatterns = router.urls
