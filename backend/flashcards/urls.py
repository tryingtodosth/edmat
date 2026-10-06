"""URL conf for `flashcards` (prompts/02-flashcards.md §API). Included from `config/urls.py` under
`api/` by the prep commit; step A registers its viewsets HERE and nowhere else, so no other app's
`urls.py` moves (prompts/README.md §5 rule 1).

The two plain paths are this app's own, for the same reason `needs/urls.py` records: a nested route
under `nodes/` and a personal summary under `flashcards/` belong to whoever owns the rows, not to
`courses`, `events` or `config`.
"""

from django.urls import path

from config.routers import NumericPkRouter

from .views import (
    CardViewSet,
    DeckPlacementViewSet,
    DeckViewSet,
    DueView,
    NodeDecksView,
)

router = NumericPkRouter()
router.register('decks', DeckViewSet, basename='deck')
router.register('cards', CardViewSet, basename='card')
router.register('deck-placements', DeckPlacementViewSet, basename='deck-placement')

urlpatterns = router.urls + [
    path('nodes/<str:kind>/<int:pk>/decks/', NodeDecksView.as_view(), name='node-decks'),
    path('flashcards/due/', DueView.as_view(), name='flashcards-due'),
]
