from config.routers import NumericPkRouter

from .views import IssueViewSet

router = NumericPkRouter()
router.register('issues', IssueViewSet, basename='issue')

urlpatterns = router.urls
