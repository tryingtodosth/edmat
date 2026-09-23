from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ConceptArticleViewSet,
    ConceptAssetViewSet,
    ConceptLinkViewSet,
    ConceptRevisionViewSet,
    ConceptViewSet,
)

router = DefaultRouter()
# `lookup_value_regex` on the concepts route: a concept is addressed by SLUG, the way a discipline
# and a branch are, because the slug is what `[[…]]` in somebody's text and every shared link point
# at. The default router pattern would stop at the first dash-free segment.
router.register('concepts', ConceptViewSet, basename='concept')
router.register('concept-articles', ConceptArticleViewSet, basename='concept-article')
router.register('concept-revisions', ConceptRevisionViewSet, basename='concept-revision')
router.register('concept-links', ConceptLinkViewSet, basename='concept-link')
router.register('concept-assets', ConceptAssetViewSet, basename='concept-asset')

urlpatterns = router.urls
