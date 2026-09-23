from django.urls import path
from config.routers import NumericPkRouter

from .views import BranchViewSet, DisciplineViewSet, ProposeNodeView

router = NumericPkRouter()
# `/api/courses/` is deliberately NOT registered here any more. It used to serve przedmiot rows;
# it now belongs to the `courses` app, where a course is a kurs somebody actually teaches.
router.register('disciplines', DisciplineViewSet, basename='discipline')
router.register('branches', BranchViewSet, basename='branch')

urlpatterns = router.urls + [
    path('taxonomy/propose/', ProposeNodeView.as_view(), name='taxonomy-propose'),
]
