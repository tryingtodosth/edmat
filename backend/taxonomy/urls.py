from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import BranchViewSet, DisciplineViewSet, ProposeNodeView

router = DefaultRouter()
# `/api/courses/` is deliberately NOT registered here any more. It used to serve przedmiot rows;
# it now belongs to the `courses` app, where a course is a kurs somebody actually teaches.
router.register('disciplines', DisciplineViewSet, basename='discipline')
router.register('branches', BranchViewSet, basename='branch')

urlpatterns = router.urls + [
    path('taxonomy/propose/', ProposeNodeView.as_view(), name='taxonomy-propose'),
]
