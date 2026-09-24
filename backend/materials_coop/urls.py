"""Two URLs, both nested under the material — the id a reader actually has in hand. Plain `path`s
rather than `@action`s on `MaterialViewSet`, so `materials/` keeps its schema and its tests (the
`cloakroom/urls.py` precedent)."""

from django.urls import path

from .views import MaterialCoopCommentsView, MaterialCoopView

urlpatterns = [
    path('materials/<int:material_id>/coop/', MaterialCoopView.as_view(), name='material-coop'),
    path(
        'materials/<int:material_id>/coop/comments/',
        MaterialCoopCommentsView.as_view(),
        name='material-coop-comments',
    ),
]
