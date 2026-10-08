"""URL conf for `translations`, included from `config/urls.py` under `api/`.

`text-versions/` rather than `translations/`: the word "translation" on this platform already means
`ExerciseTranslation`'s review workflow, and an address is the first thing a reader of the API
sees. What this writes is the versions of a row's text.
"""

from django.urls import path

from .views import TextVersionsView

urlpatterns = [
    path(
        'text-versions/<str:kind>/<int:pk>/',
        TextVersionsView.as_view(),
        name='text-versions-write',
    ),
]
